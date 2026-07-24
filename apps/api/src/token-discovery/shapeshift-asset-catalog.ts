import { constants, readFile, rename, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../lib/address.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from './registry.js'
import { loadFallbackTokenCatalog } from './fallback-token-catalog.js'

export const SHAPESHIFT_ASSET_CATALOG_SCHEMA_VERSION = 1
export const DEFAULT_SHAPESHIFT_ASSET_REF =
    '0b8eb75cf56fd4de1cbd2b93350a932dffaf9eab'
export const DEFAULT_SHAPESHIFT_ASSET_PUBLIC_BASE_URL =
    `https://raw.githubusercontent.com/shapeshift/web/${DEFAULT_SHAPESHIFT_ASSET_REF}/public`
export const DEFAULT_SHAPESHIFT_ASSET_DATA_URL =
    `${DEFAULT_SHAPESHIFT_ASSET_PUBLIC_BASE_URL}/generated/generatedAssetData.json`

export const SHAPESHIFT_ASSET_CATALOG_PATH = fileURLToPath(
    new URL('../../data/shapeshift-asset-catalog.v1.json', import.meta.url),
)

function defaultCatalogPath() {
    return process.env.SHAPESHIFT_ASSET_CATALOG_PATH?.trim() ||
        SHAPESHIFT_ASSET_CATALOG_PATH
}

const ACTIVE_CHAIN_IDS = new Set(ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => chain.chainId))
const EVM_NATIVE_PATTERN = /^eip155:(\d+)\/slip44:60$/u
const EVM_ERC20_PATTERN = /^eip155:(\d+)\/erc20:(0x[a-fA-F0-9]{40})$/u
const GENERIC_ICON_MARKERS = [
    '/fallback.png',
    '/fallback.svg',
    '/token-fallback.svg',
    'unknown-token',
]

export type ShapeShiftCatalogToken = {
    assetId: string
    chainId: number
    address: string
    isNative: boolean
    name: string
    symbol: string
    decimals: number
    icon: string
    source: 'shapeshift'
}

export type ShapeShiftAssetCatalog = {
    schemaVersion: 1
    generatedAt: string
    source: {
        name: 'shapeshift'
        ref: string
        url: string
    }
    byId: Record<string, ShapeShiftCatalogToken>
    ids: string[]
    chains: Record<string, { count: number }>
}

export type ShapeShiftSyncDiagnostics = {
    imported: Record<number, number>
    excluded: Record<string, number>
}

type UpstreamPayload = {
    byId?: Record<string, unknown>
    ids?: unknown[]
}

let cachedCatalog: {
    path: string
    catalog: ShapeShiftAssetCatalog | null
    source: 'shapeshift-local' | 'legacy-fallback'
} | null = null

function increment(map: Record<string, number>, key: string) {
    map[key] = (map[key] ?? 0) + 1
}

function isGenericIcon(url: string) {
    const normalized = url.toLowerCase()
    return GENERIC_ICON_MARKERS.some((marker) => normalized.includes(marker))
}

function normalizeIcon(value: unknown, publicBaseUrl: string) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text || text.startsWith('data:') || isGenericIcon(text)) return null
    if (text.startsWith('/')) {
        const base = publicBaseUrl.replace(/\/+$/u, '')
        return `${base}${text}`
    }
    try {
        const url = new URL(text)
        if (url.protocol !== 'https:') return null
        return url.toString()
    } catch {
        return null
    }
}

function boundedText(value: unknown, max: number) {
    const text = typeof value === 'string' ? value.trim() : ''
    return text && text.length <= max ? text : null
}

function normalizeUpstreamAsset(
    assetId: string,
    value: unknown,
    publicBaseUrl: string,
    excluded: Record<string, number>,
): ShapeShiftCatalogToken | null {
    if (typeof value !== 'object' || value === null) {
        increment(excluded, 'malformed-asset')
        return null
    }
    const record = value as Record<string, unknown>
    const nativeMatch = EVM_NATIVE_PATTERN.exec(assetId)
    const erc20Match = EVM_ERC20_PATTERN.exec(assetId)
    if (!nativeMatch && !erc20Match) {
        increment(excluded, 'unsupported-asset-type')
        return null
    }

    const chainId = Number(nativeMatch?.[1] ?? erc20Match?.[1])
    if (!ACTIVE_CHAIN_IDS.has(chainId)) {
        increment(excluded, 'inactive-or-unsupported-chain')
        return null
    }

    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active) {
        increment(excluded, 'inactive-or-unsupported-chain')
        return null
    }

    const address = nativeMatch
        ? NATIVE_TOKEN_ADDRESS
        : normalizeAddress(erc20Match?.[2])
    const name = boundedText(record.name, 120)
    const symbol = boundedText(record.symbol, 32)
    const decimals = Number(record.precision)
    const icon = normalizeIcon(record.icon, publicBaseUrl)
    if (!address || !name || !symbol || !Number.isInteger(decimals) ||
        decimals < 0 || decimals > 255 || !icon) {
        increment(excluded, 'invalid-metadata')
        return null
    }

    return {
        assetId,
        chainId,
        address,
        isNative: Boolean(nativeMatch),
        name,
        symbol,
        decimals,
        icon,
        source: 'shapeshift',
    }
}

export function validateShapeShiftAssetCatalog(value: unknown): ShapeShiftAssetCatalog {
    if (typeof value !== 'object' || value === null) {
        throw new Error('ShapeShift asset catalog must be an object.')
    }
    const payload = value as Partial<ShapeShiftAssetCatalog>
    if (payload.schemaVersion !== SHAPESHIFT_ASSET_CATALOG_SCHEMA_VERSION ||
        Number.isNaN(Date.parse(String(payload.generatedAt))) ||
        payload.source?.name !== 'shapeshift' ||
        typeof payload.source.ref !== 'string' ||
        typeof payload.source.url !== 'string' ||
        typeof payload.byId !== 'object' ||
        payload.byId === null ||
        !Array.isArray(payload.ids) ||
        typeof payload.chains !== 'object' ||
        payload.chains === null) {
        throw new Error('ShapeShift asset catalog has invalid top-level metadata.')
    }

    const seen = new Set<string>()
    const byId: Record<string, ShapeShiftCatalogToken> = {}
    const chains: Record<string, { count: number }> = {}
    for (const [index, assetId] of payload.ids.entries()) {
        if (typeof assetId !== 'string' || !assetId) {
            throw new Error(`ShapeShift asset catalog id ${index} is invalid.`)
        }
        const token = payload.byId[assetId]
        if (typeof token !== 'object' || token === null) {
            throw new Error(`ShapeShift asset catalog token ${assetId} is missing.`)
        }
        const record = token as ShapeShiftCatalogToken
        const chain = getTokenDiscoveryChain(Number(record.chainId))
        const maybeAddress = record.isNative
            ? NATIVE_TOKEN_ADDRESS
            : normalizeAddress(record.address)
        if (!maybeAddress) {
            throw new Error(`ShapeShift asset catalog token ${assetId} is invalid.`)
        }
        const normalizedAddress: string = maybeAddress
        const identity = createTokenId(Number(record.chainId), normalizedAddress)
        if (!chain?.active || seen.has(identity) ||
            record.assetId !== assetId ||
            record.source !== 'shapeshift' ||
            typeof record.name !== 'string' || !record.name.trim() ||
            typeof record.symbol !== 'string' || !record.symbol.trim() ||
            !Number.isInteger(record.decimals) || record.decimals < 0 ||
            record.decimals > 255 ||
            typeof record.icon !== 'string' ||
            !/^https:\/\//u.test(record.icon) ||
            isGenericIcon(record.icon)) {
            throw new Error(`ShapeShift asset catalog token ${assetId} is invalid.`)
        }
        seen.add(identity)
        byId[assetId] = {
            ...record,
            chainId: chain.chainId,
            address: normalizedAddress,
            isNative: record.isNative === true,
        }
        chains[String(chain.chainId)] = {
            count: (chains[String(chain.chainId)]?.count ?? 0) + 1,
        }
    }
    return {
        schemaVersion: 1,
        generatedAt: new Date(String(payload.generatedAt)).toISOString(),
        source: {
            name: 'shapeshift',
            ref: payload.source.ref,
            url: payload.source.url,
        },
        byId,
        ids: [...payload.ids],
        chains,
    }
}

export function normalizeShapeShiftAssetData(
    upstream: unknown,
    {
        ref,
        url,
        publicBaseUrl,
        generatedAt = new Date().toISOString(),
    }: {
        ref: string
        url: string
        publicBaseUrl: string
        generatedAt?: string
    },
): { catalog: ShapeShiftAssetCatalog; diagnostics: ShapeShiftSyncDiagnostics } {
    const payload = upstream as UpstreamPayload
    if (typeof payload !== 'object' || payload === null ||
        typeof payload.byId !== 'object' || payload.byId === null ||
        !Array.isArray(payload.ids)) {
        throw new Error('ShapeShift generatedAssetData.json must contain byId and ids.')
    }
    const byId: Record<string, ShapeShiftCatalogToken> = {}
    const ids: string[] = []
    const identities = new Set<string>()
    const excluded: Record<string, number> = {}
    const imported: Record<number, number> = {}

    for (const rawId of payload.ids) {
        const assetId = typeof rawId === 'string' ? rawId : ''
        const token = assetId
            ? normalizeUpstreamAsset(assetId, payload.byId[assetId], publicBaseUrl, excluded)
            : null
        if (!token) continue
        const identity = createTokenId(token.chainId, token.address)
        if (identities.has(identity)) {
            increment(excluded, 'duplicate-identity')
            continue
        }
        identities.add(identity)
        ids.push(token.assetId)
        byId[token.assetId] = token
        imported[token.chainId] = (imported[token.chainId] ?? 0) + 1
    }

    const chains = Object.fromEntries(
        Object.entries(imported).map(([chainId, count]) => [chainId, { count }]),
    )
    const catalog = validateShapeShiftAssetCatalog({
        schemaVersion: 1,
        generatedAt,
        source: { name: 'shapeshift', ref, url },
        byId,
        ids,
        chains,
    })
    return { catalog, diagnostics: { imported, excluded } }
}

export async function syncShapeShiftAssetCatalog({
    path = defaultCatalogPath(),
    ref = process.env.SHAPESHIFT_ASSET_REF?.trim() || DEFAULT_SHAPESHIFT_ASSET_REF,
    url,
    publicBaseUrl,
    fetchImpl = fetch,
}: {
    path?: string
    ref?: string
    url?: string
    publicBaseUrl?: string
    fetchImpl?: typeof fetch
} = {}) {
    const resolvedPublicBaseUrl = publicBaseUrl ??
        (process.env.SHAPESHIFT_ASSET_PUBLIC_BASE_URL?.trim() ||
        `https://raw.githubusercontent.com/shapeshift/web/${ref}/public`)
    const resolvedUrl = url ??
        (process.env.SHAPESHIFT_ASSET_DATA_URL?.trim() ||
        `${resolvedPublicBaseUrl.replace(/\/+$/u, '')}/generated/generatedAssetData.json`)
    const response = await fetchImpl(resolvedUrl, {
        headers: { accept: 'application/json' },
    })
    if (!response.ok) {
        throw new Error(`ShapeShift asset fetch failed with HTTP ${response.status}.`)
    }
    const upstream = await response.json()
    const { catalog, diagnostics } = normalizeShapeShiftAssetData(upstream, {
        ref,
        url: resolvedUrl,
        publicBaseUrl: resolvedPublicBaseUrl,
    })
    if (catalog.ids.length === 0) {
        throw new Error('ShapeShift asset sync produced an empty catalog.')
    }
    const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`)
    validateShapeShiftAssetCatalog(JSON.parse(await readFile(tempPath, 'utf8')))
    await rename(tempPath, path)
    cachedCatalog = { path, catalog, source: 'shapeshift-local' }
    return { catalog, diagnostics, path }
}

async function fileExists(path: string) {
    try {
        await access(path, constants.R_OK)
        return true
    } catch {
        return false
    }
}

export async function loadShapeShiftAssetCatalog({
    path = defaultCatalogPath(),
}: { path?: string } = {}) {
    if (cachedCatalog?.path === path) return cachedCatalog
    if (await fileExists(path)) {
        try {
            const catalog = validateShapeShiftAssetCatalog(JSON.parse(await readFile(path, 'utf8')))
            cachedCatalog = { path, catalog, source: 'shapeshift-local' }
            return cachedCatalog
        } catch {
            // Fall through to the legacy fallback catalog without failing startup.
        }
    }
    await loadFallbackTokenCatalog().catch(() => null)
    cachedCatalog = { path, catalog: null, source: 'legacy-fallback' }
    return cachedCatalog
}

export async function auditShapeShiftAssetCatalog({
    path = defaultCatalogPath(),
}: { path?: string } = {}) {
    const catalog = validateShapeShiftAssetCatalog(JSON.parse(await readFile(path, 'utf8')))
    const failures: string[] = []
    for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
        if (!catalog.chains[String(chain.chainId)]) continue
        const native = catalog.ids.some((id) => {
            const token = catalog.byId[id]
            return token.chainId === chain.chainId && token.isNative
        })
        if (!native) failures.push(`chain ${chain.chainId} has no native asset`)
    }
    if (failures.length > 0) {
        throw new Error(failures.join('; '))
    }
    return catalog
}

export function resetShapeShiftAssetCatalogCacheForTest() {
    cachedCatalog = null
}
