import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import type { Pool } from 'pg'

import { getPool } from '../db/client.js'
import { normalizeAddress } from '../lib/address.js'

const DEFAULT_SDN_URL = 'https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml'
const DEFAULT_CONSOLIDATED_URL = 'https://sanctionslistservice.ofac.treas.gov/api/download/consolidated.xml'
const DEFAULT_REFRESH_MS = 15 * 60 * 1_000
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const DEFAULT_SCREEN_CACHE_MS = 5 * 60 * 1_000
const MAX_OFAC_BYTES = 96 * 1024 * 1024
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i
const COUNTRY_CODE = /^[A-Z]{2}$/
const REGION_CODE = /^[A-Z0-9-]{1,16}$/

export type ComplianceDecision = 'allow' | 'block' | 'unavailable'

export type ComplianceScreenInput = {
    walletAddress: string
    chainId?: number | null
    action: string
    countryCode?: string | null
    regionCode?: string | null
    clientIp?: string | null
    persist?: boolean
    transactionHash?: string | null
    useExternalProvider?: boolean
}

export type ComplianceScreenResult = {
    decision: ComplianceDecision
    allowed: boolean
    reasonCode: string
    checkedAt: string
    expiresAt: string
    listVersion: string | null
}

type OfacSnapshot = {
    addresses: ReadonlySet<string>
    version: string
    refreshedAt: number
}

type TrmCacheValue = {
    sanctioned: boolean
    expiresAt: number
}

export class ComplianceError extends Error {
    readonly code: string
    readonly statusCode: number

    constructor(code: string, message: string, statusCode = 403) {
        super(message)
        this.name = 'ComplianceError'
        this.code = code
        this.statusCode = statusCode
    }
}

function boolEnv(name: string, fallback: boolean) {
    const raw = process.env[name]?.trim().toLowerCase()
    if (!raw) return fallback
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error(`${name} must be true or false.`)
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
    const raw = process.env[name]?.trim()
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`)
    }
    return value
}

function csvSet(name: string, fallback: string) {
    return new Set((process.env[name]?.trim() || fallback)
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean))
}

function config() {
    return {
        enabled: boolEnv('COMPLIANCE_ENABLED', true),
        failClosed: boolEnv('COMPLIANCE_FAIL_CLOSED', true),
        trustCloudflareGeo: boolEnv('COMPLIANCE_TRUST_CLOUDFLARE_GEO', true),
        sdnUrl: process.env.OFAC_SDN_URL?.trim() || DEFAULT_SDN_URL,
        consolidatedUrl: process.env.OFAC_CONSOLIDATED_URL?.trim() || DEFAULT_CONSOLIDATED_URL,
        refreshMs: integerEnv('OFAC_REFRESH_INTERVAL_MS', DEFAULT_REFRESH_MS, 60_000, 24 * 60 * 60 * 1_000),
        maxAgeMs: integerEnv('OFAC_MAX_LIST_AGE_MS', DEFAULT_MAX_AGE_MS, 5 * 60 * 1_000, 7 * 24 * 60 * 60 * 1_000),
        screenCacheMs: integerEnv('COMPLIANCE_SCREEN_CACHE_MS', DEFAULT_SCREEN_CACHE_MS, 10_000, 60 * 60 * 1_000),
        blockedCountries: csvSet('COMPLIANCE_BLOCKED_COUNTRY_CODES', 'CU,IR,KP'),
        blockedRegions: csvSet('COMPLIANCE_BLOCKED_REGION_CODES', ''),
        trmEnabled: boolEnv('TRM_SANCTIONS_ENABLED', false),
        trmAuthorization: process.env.TRM_SANCTIONS_AUTHORIZATION?.trim() || '',
        trmUrl: process.env.TRM_SANCTIONS_URL?.trim() || 'https://api.trmlabs.com/public/v1/sanctions/screening',
    }
}

function decodeXml(value: string) {
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
}

/** Extract EVM addresses from OFAC legacy XML <id> records.
 * OFAC states that legacy SDN.xml/consolidated.xml contain the same core list data
 * as its advanced XML products. Only exact 20-byte EVM identifiers are accepted.
 */
export function extractOfacEvmAddresses(xml: string) {
    const addresses = new Set<string>()
    const blocks = xml.matchAll(/<id>([\s\S]*?)<\/id>/giu)
    for (const match of blocks) {
        const block = match[1] ?? ''
        const type = /<idType>([\s\S]*?)<\/idType>/iu.exec(block)?.[1]
        const number = /<idNumber>([\s\S]*?)<\/idNumber>/iu.exec(block)?.[1]
        if (!type || !number) continue
        if (!decodeXml(type).trim().toLowerCase().startsWith('digital currency address')) continue
        const candidate = decodeXml(number).trim().toLowerCase()
        if (EVM_ADDRESS.test(candidate)) addresses.add(candidate)
    }
    return addresses
}

async function boundedText(response: Response) {
    if (!response.ok) throw new Error(`OFAC list download failed with HTTP ${response.status}.`)
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_OFAC_BYTES) {
        throw new Error('OFAC list response exceeded the configured safety limit.')
    }
    if (!response.body) return ''
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            total += value.byteLength
            if (total > MAX_OFAC_BYTES) {
                await reader.cancel().catch(() => undefined)
                throw new Error('OFAC list response exceeded the configured safety limit.')
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        reader.releaseLock()
    }
    return Buffer.concat(chunks, total).toString('utf8')
}

async function downloadOfacXml(url: string) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    timeout.unref()
    try {
        const response = await fetch(url, {
            headers: {
                accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
                'user-agent': 'PistachioSwap-OFAC-Screener/1.0 compliance@pistachioswap.com',
            },
            redirect: 'follow',
            signal: controller.signal,
        })
        return await boundedText(response)
    } finally {
        clearTimeout(timeout)
    }
}

function normalizedCountry(value: string | null | undefined) {
    const country = value?.trim().toUpperCase() ?? ''
    return COUNTRY_CODE.test(country) ? country : null
}

function normalizedRegion(value: string | null | undefined) {
    const region = value?.trim().toUpperCase() ?? ''
    return REGION_CODE.test(region) ? region : null
}

function publicResult(
    decision: ComplianceDecision,
    reasonCode: string,
    listVersion: string | null,
    ttlMs: number,
): ComplianceScreenResult {
    const now = Date.now()
    return {
        decision,
        allowed: decision === 'allow',
        reasonCode,
        checkedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlMs).toISOString(),
        listVersion,
    }
}

export function createComplianceService(database: Pool = getPool()) {
    let snapshot: OfacSnapshot | null = null
    let refreshPromise: Promise<OfacSnapshot> | null = null
    const trmCache = new Map<string, TrmCacheValue>()

    async function refreshOfacSnapshot() {
        if (refreshPromise) return refreshPromise
        refreshPromise = (async () => {
            const cfg = config()
            const [sdnXml, consolidatedXml] = await Promise.all([
                downloadOfacXml(cfg.sdnUrl),
                downloadOfacXml(cfg.consolidatedUrl),
            ])
            const addresses = extractOfacEvmAddresses(sdnXml)
            for (const address of extractOfacEvmAddresses(consolidatedXml)) addresses.add(address)
            if (addresses.size === 0) throw new Error('OFAC list contained no EVM digital-currency identifiers.')
            const version = createHash('sha256')
                .update(sdnXml)
                .update('\n--PISTACHIO-CONSOLIDATED--\n')
                .update(consolidatedXml)
                .digest('hex')
            snapshot = { addresses, version, refreshedAt: Date.now() }
            return snapshot
        })().finally(() => {
            refreshPromise = null
        })
        return refreshPromise
    }

    async function currentSnapshot() {
        const cfg = config()
        if (!snapshot || Date.now() - snapshot.refreshedAt >= cfg.refreshMs) {
            try {
                await refreshOfacSnapshot()
            } catch (error) {
                if (!snapshot || Date.now() - snapshot.refreshedAt > cfg.maxAgeMs) throw error
            }
        }
        if (!snapshot || Date.now() - snapshot.refreshedAt > cfg.maxAgeMs) {
            throw new Error('OFAC sanctions data is unavailable or too old.')
        }
        return snapshot
    }

    async function trmSanctioned(walletAddress: string) {
        const cfg = config()
        if (!cfg.trmEnabled) return false
        if (!cfg.trmAuthorization) {
            throw new Error('TRM_SANCTIONS_AUTHORIZATION is required when TRM sanctions screening is enabled.')
        }
        const cached = trmCache.get(walletAddress)
        if (cached && cached.expiresAt > Date.now()) return cached.sanctioned
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5_000)
        timeout.unref()
        try {
            const response = await fetch(cfg.trmUrl, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    authorization: cfg.trmAuthorization,
                    'content-type': 'application/json',
                    'user-agent': 'PistachioSwap/1.0',
                },
                body: JSON.stringify([{ address: walletAddress }]),
                signal: controller.signal,
            })
            if (!response.ok) throw new Error(`TRM sanctions screening failed with HTTP ${response.status}.`)
            const body = await response.json() as Array<{ address?: unknown; isSanctioned?: unknown }>
            const record = Array.isArray(body) ? body[0] : null
            if (!record || typeof record.isSanctioned !== 'boolean') {
                throw new Error('TRM sanctions screening returned an invalid response.')
            }
            trmCache.set(walletAddress, {
                sanctioned: record.isSanctioned,
                expiresAt: Date.now() + cfg.screenCacheMs,
            })
            return record.isSanctioned
        } finally {
            clearTimeout(timeout)
        }
    }

    async function persistResult(
        input: ComplianceScreenInput,
        result: ComplianceScreenResult,
        reasonCode: string,
        listVersion: string | null,
    ) {
        const countryCode = normalizedCountry(input.countryCode)
        const regionCode = normalizedRegion(input.regionCode)
        const txHash = typeof input.transactionHash === 'string' && /^0x[0-9a-f]{64}$/i.test(input.transactionHash)
            ? input.transactionHash.toLowerCase()
            : null
        const inserted = await database.query<{ id: string }>(
            `INSERT INTO compliance_checks
                (wallet_address,chain_id,action,decision,reason_code,country_code,region_code,list_version,transaction_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING id`,
            [
                input.walletAddress.toLowerCase(),
                input.chainId ?? null,
                input.action.slice(0, 80),
                result.decision,
                reasonCode,
                countryCode,
                regionCode,
                listVersion,
                txHash,
            ],
        )
        if (result.decision === 'block') {
            const rawIp = input.clientIp && isIP(input.clientIp) ? input.clientIp : null
            await database.query(
                `INSERT INTO compliance_cases
                    (check_id,wallet_address,country_code,region_code,client_ip,reason_code,evidence)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
                [
                    inserted.rows[0]?.id,
                    input.walletAddress.toLowerCase(),
                    countryCode,
                    regionCode,
                    rawIp,
                    reasonCode,
                    JSON.stringify({
                        listVersion,
                        chainId: input.chainId ?? null,
                        action: input.action.slice(0, 80),
                        transactionHash: txHash,
                    }),
                ],
            )
        }
    }

    async function screen(input: ComplianceScreenInput): Promise<ComplianceScreenResult> {
        const cfg = config()
        const wallet = normalizeAddress(input.walletAddress)
        if (!wallet) throw new ComplianceError('COMPLIANCE_INVALID_WALLET', 'A valid wallet address is required.', 400)
        const normalizedInput = { ...input, walletAddress: wallet }
        if (!cfg.enabled) return publicResult('allow', 'COMPLIANCE_DISABLED', null, cfg.screenCacheMs)

        const country = cfg.trustCloudflareGeo ? normalizedCountry(input.countryCode) : null
        const region = cfg.trustCloudflareGeo ? normalizedRegion(input.regionCode) : null
        const regionKey = country && region ? `${country}:${region}` : null
        if (country && cfg.blockedCountries.has(country)) {
            const result = publicResult('block', 'JURISDICTION_RESTRICTED', snapshot?.version ?? null, cfg.screenCacheMs)
            await persistResult(normalizedInput, result, result.reasonCode, result.listVersion)
            return result
        }
        if (regionKey && cfg.blockedRegions.has(regionKey)) {
            const result = publicResult('block', 'JURISDICTION_RESTRICTED', snapshot?.version ?? null, cfg.screenCacheMs)
            await persistResult(normalizedInput, result, result.reasonCode, result.listVersion)
            return result
        }

        let list: OfacSnapshot
        try {
            list = await currentSnapshot()
        } catch {
            const result = publicResult(
                cfg.failClosed ? 'unavailable' : 'allow',
                'SANCTIONS_SCREENING_UNAVAILABLE',
                snapshot?.version ?? null,
                30_000,
            )
            if (input.persist) await persistResult(normalizedInput, result, result.reasonCode, result.listVersion)
            return result
        }

        if (list.addresses.has(wallet.toLowerCase())) {
            const result = publicResult('block', 'OFAC_ADDRESS_MATCH', list.version, cfg.screenCacheMs)
            await persistResult(normalizedInput, result, result.reasonCode, list.version)
            return result
        }

        if (input.useExternalProvider !== false && cfg.trmEnabled) {
            try {
                if (await trmSanctioned(wallet.toLowerCase())) {
                    const result = publicResult('block', 'SANCTIONS_PROVIDER_MATCH', list.version, cfg.screenCacheMs)
                    await persistResult(normalizedInput, result, result.reasonCode, list.version)
                    return result
                }
            } catch {
                const result = publicResult(
                    cfg.failClosed ? 'unavailable' : 'allow',
                    'SANCTIONS_PROVIDER_UNAVAILABLE',
                    list.version,
                    30_000,
                )
                if (input.persist) await persistResult(normalizedInput, result, result.reasonCode, list.version)
                return result
            }
        }

        const result = publicResult('allow', 'CLEAR', list.version, cfg.screenCacheMs)
        if (input.persist) await persistResult(normalizedInput, result, result.reasonCode, list.version)
        return result
    }

    async function enforce(input: ComplianceScreenInput) {
        const result = await screen(input)
        if (result.decision === 'block') {
            throw new ComplianceError(
                'COMPLIANCE_RESTRICTED',
                'PistachioSwap cannot provide transaction services for this request.',
                403,
            )
        }
        if (result.decision === 'unavailable') {
            throw new ComplianceError(
                'COMPLIANCE_UNAVAILABLE',
                'Compliance screening is temporarily unavailable. Please try again later.',
                503,
            )
        }
        return result
    }

    return {
        screen,
        enforce,
        refreshOfacSnapshot,
        status() {
            return {
                enabled: config().enabled,
                listVersion: snapshot?.version ?? null,
                refreshedAt: snapshot ? new Date(snapshot.refreshedAt).toISOString() : null,
                addressCount: snapshot?.addresses.size ?? 0,
            }
        },
    }
}

let singleton: ReturnType<typeof createComplianceService> | null = null

export function getComplianceService() {
    singleton ??= createComplianceService()
    return singleton
}

export function complianceRequestGeo(headers: Record<string, unknown>) {
    const country = typeof headers['cf-ipcountry'] === 'string'
        ? headers['cf-ipcountry']
        : null
    const region = typeof headers['cf-region-code'] === 'string'
        ? headers['cf-region-code']
        : null
    return {
        countryCode: normalizedCountry(country),
        regionCode: normalizedRegion(region),
    }
}
