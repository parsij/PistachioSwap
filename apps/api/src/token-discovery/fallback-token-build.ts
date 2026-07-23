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

function validMetadata(value: TokenMetadata | null | undefined) {
    const name = typeof value?.name === 'string' ? value.name.trim() : ''
    const symbol = typeof value?.symbol === 'string' ? value.symbol.trim() : ''
    return value &&
        normalizeAddress(value.address) !== null &&
        name.length > 0 &&
        name.length <= 120 &&
        symbol.length > 0 &&
        symbol.length <= 32 &&
        Number.isInteger(value.decimals) &&
        value.decimals >= 0 &&
        value.decimals <= 255
        ? { ...value, name, symbol, address: normalizeAddress(value.address)! }
        : null
}

function assertNoMetadataConflict(values: Array<{
    source: string
    name: string
    symbol: string
    decimals: number
    address: string
}>) {
    const [first] = values
    if (!first) throw new Error('No valid metadata source found.')
    for (const next of values.slice(1)) {
        if (next.address !== first.address || next.decimals !== first.decimals) {
            throw new Error(
                `Fallback metadata conflict for ${first.address}: ` +
                    `${first.source} != ${next.source}`,
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
            const sourceValues = [
                official ? {
                    source: 'curated-token-list',
                    chainId: official.chainId,
                    address: official.address,
                    name: official.name,
                    symbol: official.symbol,
                    decimals: official.decimals,
                } : null,
                validMetadata(metadata.get(address))
                    ? { ...validMetadata(metadata.get(address))!, source: 'alchemy-metadata' }
                    : null,
                Number.isInteger(decimals.get(address))
                    ? {
                          source: 'rpc-decimals',
                          address,
                          name: official?.name ?? metadata.get(address)?.name ?? '',
                          symbol: official?.symbol ?? metadata.get(address)?.symbol ?? '',
                          decimals: decimals.get(address)!,
                      }
                    : null,
            ].filter((value): value is {
                source: string
                address: string
                name: string
                symbol: string
                decimals: number
            } => value !== null && Boolean(value.name.trim()) && Boolean(value.symbol.trim()))
            assertNoMetadataConflict(sourceValues)
            const [chosen] = sourceValues
            if (normalizeAddress(chosen.address) !== address) {
                throw new Error(`Metadata identity mismatch for ${chain.chainId}:${address}`)
            }
            const logoCandidates = getTokenLogoEntries({
                chainId: chain.chainId,
                address,
                curatedImages: official?.logoCandidates,
                alchemyImage: metadata.get(address)?.logoURI,
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
    }
    const chains = ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => {
        const input = addressData.parsed.get(chain.chainId)?.addresses ?? []
        const generated = byChain.get(chain.chainId) ?? []
        if (input.length > FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN) {
            errors.push(`${chain.chainId} exceeds 100 fallback input addresses.`)
        }
        for (const address of input) {
            if (!generated.some((record) => record.address === address)) {
                errors.push(`${chain.chainId}:${address} is missing from generated catalog.`)
            }
        }
        return {
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
        }
    })
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
