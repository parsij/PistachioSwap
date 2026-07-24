import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPublicClient, http, type PublicClient } from 'viem'

import { normalizeAddress } from '../lib/address.js'
import {
    getTokenMetadataBatch,
    type TokenMetadata,
} from '../providers/alchemy/token-metadata.js'
import { getTokenDecimalsBatch } from '../providers/token-decimals.js'
import {
    getOfficialAsset,
} from '../providers/recognition/curated-token-lists.js'
import { getTokenLogoEntries } from '../providers/token-logos.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    UNCHAINED_EVM_COINSTACKS_BY_CHAIN_ID,
    getTokenDiscoveryChain,
} from './registry.js'
import {
    FALLBACK_TOKEN_ADDRESS_DIRECTORY,
    FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN,
    readFallbackTokenAddressDirectory,
} from './fallback-token-addresses.js'
import {
    FALLBACK_TOKEN_CATALOG_PATH,
    type FallbackTokenCatalogRecord,
    validateFallbackTokenCatalogRecords,
} from './fallback-token-catalog.js'
import { getServerRpcUrl } from './context.js'

export const FALLBACK_TOKEN_ICON_DIRECTORY = fileURLToPath(
    new URL('../../../../public/token-icons/fallback', import.meta.url),
)
const PUBLIC_ASSET_DIRECTORY = fileURLToPath(
    new URL('../../../../public', import.meta.url),
)

const FALLBACK_LOGO_URI = '/icons/token-fallback.svg'
const MAX_ICON_BYTES = 512 * 1024

type BuildOptions = {
    chains?: number[]
    dryRun?: boolean
    forceIcons?: boolean
    addressDirectory?: string
    catalogPath?: string
    iconDirectory?: string
    now?: () => Date
    fetchMetadata?: typeof getTokenMetadataBatch
    fetchDecimals?: typeof getTokenDecimalsBatch
    fetchImpl?: typeof fetch
    getBytecode?: (chainId: number, address: string) => Promise<string | null>
    writeFileAtomic?: (path: string, contents: string) => Promise<void>
}

type MetadataEvidence = {
    source: string
    name: string
    symbol: string
    decimals: number | null
    address: string
}

function selectedChains(ids?: number[]) {
    if (!ids || ids.length === 0) return [...ACTIVE_TOKEN_DISCOVERY_CHAINS]
    const requested = new Set(ids)
    for (const id of requested) {
        if (!getTokenDiscoveryChain(id)?.active) {
            throw new Error(`Unsupported fallback token chain: ${id}`)
        }
    }
    return ACTIVE_TOKEN_DISCOVERY_CHAINS.filter((chain) =>
        requested.has(chain.chainId))
}

function validDecimals(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255
}

function validMetadata(value: TokenMetadata | null | undefined) {
    const name = typeof value?.name === 'string' ? value.name.trim() : ''
    const symbol = typeof value?.symbol === 'string' ? value.symbol.trim() : ''
    const address = normalizeAddress(value?.address)
    return value && address &&
        name.length > 0 && name.length <= 120 &&
        symbol.length > 0 && symbol.length <= 32
        ? {
              ...value,
              name,
              symbol,
              address,
              decimals: validDecimals(value.decimals) ? value.decimals : null,
          }
        : null
}

function resolveFallbackMetadata(values: MetadataEvidence[]) {
    const [first] = values
    if (!first) throw new Error('No valid metadata source found.')
    for (const next of values.slice(1)) {
        if (next.address !== first.address) {
            throw new Error(
                `Fallback metadata conflict for ${first.address}: ` +
                    `${first.source} != ${next.source}`,
            )
        }
        if (first.decimals !== null && next.decimals !== null &&
            first.decimals !== next.decimals) {
            throw new Error(
                `Fallback metadata conflict for ${first.address}: ` +
                    `${first.source} decimals ${first.decimals} != ` +
                    `${next.source} decimals ${next.decimals}`,
            )
        }
        if (
            next.symbol.toLowerCase() !== first.symbol.toLowerCase() ||
            next.name.toLowerCase() !== first.name.toLowerCase()
        ) {
            throw new Error(
                `Fallback metadata name/symbol conflict for ${first.address}: ` +
                    `${first.source}=${first.symbol}/${first.name}, ` +
                    `${next.source}=${next.symbol}/${next.name}`,
            )
        }
    }
    const decimals = values
        .map((value) => value.decimals)
        .find((value): value is number => value !== null) ?? null
    if (decimals === null) {
        throw new Error(
            `Fallback metadata for ${first.address} is missing valid decimals.`,
        )
    }
    return {
        ...first,
        decimals,
    }
}

async function defaultGetBytecode(chainId: number, address: string) {
    const url = getServerRpcUrl(chainId)
    if (!url) return null
    const client = createPublicClient({ transport: http(String(url)) }) as PublicClient
    return await client.getBytecode({ address: address as `0x${string}` }) ?? null
}

function extensionForContentType(value: string | null) {
    const contentType = String(value ?? '').split(';')[0].trim().toLowerCase()
    if (contentType === 'image/png') return 'png'
    if (contentType === 'image/jpeg') return 'jpg'
    if (contentType === 'image/webp') return 'webp'
    if (contentType === 'image/svg+xml') return 'svg'
    return null
}

function sanitizeSvg(text: string) {
    if (/<script[\s>]/i.test(text) || /\son[a-z]+\s*=/i.test(text) ||
        /javascript:/i.test(text) || /<foreignObject[\s>]/i.test(text)) {
        throw new Error('SVG icon contains active content.')
    }
    return text
}

async function atomicWrite(path: string, contents: string) {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
}

async function iconExists(path: string) {
    try {
        const value = await stat(path)
        return value.isFile() && value.size > 0 && value.size <= MAX_ICON_BYTES
    } catch {
        return false
    }
}

function localFallbackIconPath({
    iconDirectory,
    chainId,
    logoURI,
}: {
    iconDirectory: string
    chainId: number
    logoURI: string
}) {
    if (logoURI.startsWith('/icons/')) {
        const fileName = logoURI.split('/').at(-1)
        return fileName ? join(PUBLIC_ASSET_DIRECTORY, 'icons', fileName) : null
    }
    if (!logoURI.startsWith(`/token-icons/fallback/${chainId}/`)) return null
    const fileName = logoURI.split('/').at(-1)
    return fileName ? join(iconDirectory, String(chainId), fileName) : null
}

async function storeApprovedIcon({
    chainId,
    address,
    candidates,
    fetchImpl,
    iconDirectory,
    force,
}: {
    chainId: number
    address: string
    candidates: Array<{ url: string; source: string }>
    fetchImpl: typeof fetch
    iconDirectory: string
    force: boolean
}) {
    for (const candidate of candidates) {
        if (!candidate.url || candidate.url === FALLBACK_LOGO_URI) continue
        if (candidate.url.startsWith('/')) {
            const path = localFallbackIconPath({
                iconDirectory,
                chainId,
                logoURI: candidate.url,
            })
            if (path && !await iconExists(path)) continue
            return {
                logoURI: candidate.url,
                logoCandidates: [candidate.url, FALLBACK_LOGO_URI],
                iconSource: candidate.source,
            }
        }
        const response = await fetchImpl(candidate.url)
        const extension = extensionForContentType(response.headers.get('content-type'))
        if (!response.ok || !extension) continue
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length > MAX_ICON_BYTES) {
            throw new Error(`Icon for ${chainId}:${address} exceeds 512 KB.`)
        }
        const textStart = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8')
        if (/^\s*</.test(textStart) && extension !== 'svg') {
            throw new Error(`Icon for ${chainId}:${address} is not a raster image.`)
        }
        const directory = join(iconDirectory, String(chainId))
        const path = join(directory, `${address}.${extension}`)
        const uri = `/token-icons/fallback/${chainId}/${address}.${extension}`
        if (!force && await iconExists(path)) {
            return { logoURI: uri, logoCandidates: [uri, FALLBACK_LOGO_URI], iconSource: candidate.source }
        }
        await mkdir(directory, { recursive: true })
        const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
        if (extension === 'svg') {
            await writeFile(temporaryPath, sanitizeSvg(bytes.toString('utf8')), {
                encoding: 'utf8',
                mode: 0o600,
            })
        } else {
            await writeFile(temporaryPath, bytes, { mode: 0o600 })
        }
        await rename(temporaryPath, path)
        return { logoURI: uri, logoCandidates: [uri, FALLBACK_LOGO_URI], iconSource: candidate.source }
    }
    return {
        logoURI: FALLBACK_LOGO_URI,
        logoCandidates: [FALLBACK_LOGO_URI],
        iconSource: null,
    }
}

export async function buildFallbackTokenCatalog(options: BuildOptions = {}) {
    const chains = selectedChains(options.chains)
    const addressDirectory = options.addressDirectory ?? FALLBACK_TOKEN_ADDRESS_DIRECTORY
    const catalogPath = options.catalogPath ?? FALLBACK_TOKEN_CATALOG_PATH
    const iconDirectory = options.iconDirectory ?? FALLBACK_TOKEN_ICON_DIRECTORY
    const addressData = await readFallbackTokenAddressDirectory(addressDirectory)
    const errors = [...addressData.errors]
    const selected = chains.map((chain) => ({
        chain,
        addresses: addressData.parsed.get(chain.chainId)?.addresses ?? [],
    }))

    if (errors.length > 0) {
        throw new Error(errors.join('\n'))
    }

    if (options.dryRun) {
        return {
            dryRun: true,
            chains: selected.map(({ chain, addresses }) => ({
                chainId: chain.chainId,
                name: chain.name,
                count: addresses.length,
            })),
            records: [] as FallbackTokenCatalogRecord[],
        }
    }

    const generatedAt = (options.now?.() ?? new Date()).toISOString()
    const fetchMetadata = options.fetchMetadata ?? getTokenMetadataBatch
    const fetchDecimals = options.fetchDecimals ?? getTokenDecimalsBatch
    const fetchImpl = options.fetchImpl ?? fetch
    const getBytecode = options.getBytecode ?? defaultGetBytecode
    const writeFileAtomic = options.writeFileAtomic ?? atomicWrite
    const records: FallbackTokenCatalogRecord[] = []

    for (const { chain, addresses } of selected) {
        for (const address of addresses) {
            const bytecode = await getBytecode(chain.chainId, address)
            if (bytecode !== null && (!bytecode || bytecode === '0x')) {
                throw new Error(`No contract bytecode for ${chain.chainId}:${address}`)
            }
        }
        const metadata = await fetchMetadata({ chainId: chain.chainId, addresses })
        const decimals = await fetchDecimals({ chainId: chain.chainId, addresses })
        for (const address of addresses) {
            const official = getOfficialAsset(chain.chainId, address)
            const alchemy = validMetadata(metadata.get(address))
            const rpcDecimals = decimals.get(address)
            const sourceValues: MetadataEvidence[] = []
            if (official) {
                sourceValues.push({
                    source: 'curated-token-list',
                    address: official.address,
                    name: official.name,
                    symbol: official.symbol,
                    decimals: official.decimals,
                })
            }
            if (alchemy) {
                sourceValues.push({ ...alchemy, source: 'alchemy-metadata' })
            }
            if (validDecimals(rpcDecimals)) {
                const name = official?.name ?? alchemy?.name ?? ''
                const symbol = official?.symbol ?? alchemy?.symbol ?? ''
                if (name.trim() && symbol.trim()) {
                    sourceValues.push({
                        source: 'rpc-decimals',
                        address,
                        name,
                        symbol,
                        decimals: rpcDecimals,
                    })
                }
            }
            const chosen = resolveFallbackMetadata(sourceValues)
            if (normalizeAddress(chosen.address) !== address) {
                throw new Error(`Metadata identity mismatch for ${chain.chainId}:${address}`)
            }
            const logoCandidates = getTokenLogoEntries({
                chainId: chain.chainId,
                address,
                curatedImages: official?.logoCandidates,
                alchemyImage: alchemy?.logoURI,
            }).filter((entry) => entry.source !== 'alchemy' || official !== null)
            const icon = await storeApprovedIcon({
                chainId: chain.chainId,
                address,
                candidates: logoCandidates,
                fetchImpl,
                iconDirectory,
                force: options.forceIcons === true,
            })
            records.push({
                chainId: chain.chainId,
                address,
                name: chosen.name.trim(),
                symbol: chosen.symbol.trim(),
                decimals: chosen.decimals,
                logoURI: icon.logoURI,
                logoCandidates: icon.logoCandidates,
                coinGeckoId: official?.coinGeckoId ?? null,
                metadataSources: sourceValues.map((value) => value.source),
                iconSource: icon.iconSource,
                generatedAt,
                catalogSource: 'static-fallback',
                directoryStatus: 'listed',
            })
        }
    }

    if (records.length === 0) {
        throw new Error('Refusing to write an empty fallback token catalog.')
    }
    for (const record of records) {
        if (record.logoURI === FALLBACK_LOGO_URI || record.iconSource === null) {
            throw new Error(`${record.chainId}:${record.address} has no trusted local icon.`)
        }
        const iconPath = localFallbackIconPath({
            iconDirectory,
            chainId: record.chainId,
            logoURI: record.logoURI,
        })
        if (!iconPath || !await iconExists(iconPath)) {
            throw new Error(`${record.chainId}:${record.address} local icon is missing or invalid.`)
        }
    }
    validateFallbackTokenCatalogRecords(records)
    await writeFileAtomic(catalogPath, `${JSON.stringify(records, null, 2)}\n`)
    return {
        dryRun: false,
        chains: selected.map(({ chain, addresses }) => ({
            chainId: chain.chainId,
            name: chain.name,
            count: addresses.length,
        })),
        records,
    }
}

export async function auditFallbackTokenCatalog(options: {
    addressDirectory?: string
    catalogPath?: string
    iconDirectory?: string
} = {}) {
    const addressDirectory = options.addressDirectory ?? FALLBACK_TOKEN_ADDRESS_DIRECTORY
    const catalogPath = options.catalogPath ?? FALLBACK_TOKEN_CATALOG_PATH
    const iconDirectory = options.iconDirectory ?? FALLBACK_TOKEN_ICON_DIRECTORY
    const addressData = await readFallbackTokenAddressDirectory(addressDirectory)
    const errors = [...addressData.errors]
    let records: FallbackTokenCatalogRecord[] = []
    try {
        records = validateFallbackTokenCatalogRecords(
            JSON.parse(await readFile(catalogPath, 'utf8')),
        )
    } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Generated catalog is invalid.')
    }
    const byChain = new Map<number, FallbackTokenCatalogRecord[]>()
    for (const record of records) {
        byChain.set(record.chainId, [...(byChain.get(record.chainId) ?? []), record])
        if (record.logoURI === FALLBACK_LOGO_URI || record.iconSource === null) {
            errors.push(`${record.chainId}:${record.address} has no trusted local icon.`)
            continue
        }
        const iconPath = localFallbackIconPath({
            iconDirectory,
            chainId: record.chainId,
            logoURI: record.logoURI,
        })
        if (!iconPath || !await iconExists(iconPath)) {
            errors.push(`${record.chainId}:${record.address} local icon is missing or invalid.`)
        }
    }
    const chains = []
    for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
        const input = addressData.parsed.get(chain.chainId)?.addresses ?? []
        const generated = byChain.get(chain.chainId) ?? []
        if (!chain.native.symbol || !chain.native.coinGeckoId) {
            errors.push(`${chain.chainId} is missing native token metadata.`)
        }
        if (generated.length === 0) {
            errors.push(`${chain.chainId} has no generated fallback tokens.`)
        }
        const unchained = UNCHAINED_EVM_COINSTACKS_BY_CHAIN_ID[chain.chainId] ?? null
        if (unchained) {
            const expected = `http://127.0.0.1:${unchained.localPort}`
            const raw = process.env.UNCHAINED_HTTP_URLS_JSON?.trim()
            if (raw) {
                try {
                    const parsed = JSON.parse(raw) as Record<string, unknown>
                    if (parsed[String(chain.chainId)] !== expected) {
                        errors.push(`${chain.chainId} Unchained endpoint example should be ${expected}.`)
                    }
                } catch {
                    errors.push('UNCHAINED_HTTP_URLS_JSON is not valid JSON.')
                }
            }
        }
        if (input.length > FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN) {
            errors.push(`${chain.chainId} exceeds 100 fallback input addresses.`)
        }
        for (const address of input) {
            if (!generated.some((record) => record.address === address)) {
                errors.push(`${chain.chainId}:${address} is missing from generated catalog.`)
            }
        }
        chains.push({
            chainId: chain.chainId,
            name: chain.name,
            inputCount: input.length,
            generatedCount: generated.length,
            native: 'registry',
            wrappedNative: input.includes(chain.wrappedNative.address)
                ? 'listed-and-deduplicated-at-runtime'
                : 'registry',
            symbols: generated.map((record) => record.symbol),
            addresses: generated.map((record) => record.address),
            localIcons: generated.map((record) => {
                if (!record.logoURI.startsWith('/token-icons/fallback/')) {
                    return { address: record.address, status: 'fallback-or-reviewed-local' }
                }
                const localPath = join(
                    iconDirectory,
                    String(record.chainId),
                    `${record.address}${extname(record.logoURI)}`,
                )
                return { address: record.address, status: localPath }
            }),
        })
    }
    return { chains, errors }
}

export function parseFallbackTokenBuildArgs(argv: string[]) {
    const options: { chains?: number[]; dryRun?: boolean; forceIcons?: boolean } = {}
    for (const arg of argv) {
        if (arg === '--') continue
        if (arg === '--dry-run') options.dryRun = true
        else if (arg === '--force-icons') options.forceIcons = true
        else if (arg.startsWith('--chains=')) {
            options.chains = [...new Set(arg.slice('--chains='.length)
                .split(',')
                .map((value) => Number(value.trim()))
                .filter((value) => Number.isSafeInteger(value) && value > 0))]
        } else if (arg.trim()) {
            throw new Error(`Unsupported fallback token build argument: ${arg}`)
        }
    }
    if (options.chains) selectedChains(options.chains)
    return options
}
