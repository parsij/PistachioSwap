import { getApiConfig } from '../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import {
    isRecord,
    validateRemoteImageUrl,
} from '../../lib/http.js'
import { geckoTerminalRequest } from './geckoterminal-client.js'
import { tokenDiscoveryContext } from '../../token-discovery/context.js'

export type DiscoveredTokenCandidate = {
    address: string
    name: string | null
    symbol: string | null
    decimals: number | null
    imageUrl: string | null
    priceUSD: string | null
    coinGeckoId: string | null
    imageSource: 'geckoterminal'
}

export type CandidateDiscoveryResult = {
    candidates: DiscoveredTokenCandidate[]
    pagesCompleted: number
    partial: boolean
}

function sleep(milliseconds: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds)
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer)
                reject(signal.reason)
            },
            { once: true },
        )
    })
}

function addressFromRelationship(
    value: unknown,
    expectedNetwork: string,
) {
    if (!isRecord(value) || !isRecord(value.data)) return null
    const id = value.data.id
    if (typeof id !== 'string') return null
    if (!id.toLowerCase().startsWith(`${expectedNetwork.toLowerCase()}_`)) {
        return null
    }
    const match = id.match(/0x[a-fA-F0-9]{40}$/)
    return normalizeAddress(match?.[0])
}

function normalizedText(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized && normalized.length <= maximum
        ? normalized
        : null
}

function normalizedDecimals(value: unknown) {
    if (typeof value !== 'number' && typeof value !== 'string') return null
    const decimals = Number(value)
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
        ? decimals
        : null
}

function normalizedPrice(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return null
    const price = Number(value)
    return Number.isFinite(price) && price >= 0 ? value.trim() : null
}

function includedTokenMetadata(payload: Record<string, unknown>) {
    const tokens = new Map<
        string,
        Omit<DiscoveredTokenCandidate, 'address' | 'priceUSD'>
    >()

    if (!Array.isArray(payload.included)) return tokens

    for (const item of payload.included) {
        if (!isRecord(item) || !isRecord(item.attributes)) continue
        const address = normalizeAddress(item.attributes.address)
        if (!address) continue

        tokens.set(address, {
            name: normalizedText(item.attributes.name, 120),
            symbol: normalizedText(item.attributes.symbol, 32),
            decimals: normalizedDecimals(item.attributes.decimals),
            imageUrl: validateRemoteImageUrl(item.attributes.image_url),
            coinGeckoId: normalizedText(
                item.attributes.coingecko_coin_id,
                160,
            ),
            imageSource: 'geckoterminal',
        })
    }

    return tokens
}

export function extractPoolTokenCandidates(
    payload: unknown,
    network = 'bsc',
): DiscoveredTokenCandidate[] {
    if (!isRecord(payload) || !Array.isArray(payload.data)) return []
    const included = includedTokenMetadata(payload)
    const candidates = new Map<string, DiscoveredTokenCandidate>()

    for (const pool of payload.data) {
        if (!isRecord(pool) || !isRecord(pool.relationships)) continue
        const attributes = isRecord(pool.attributes)
            ? pool.attributes
            : {}
        const sides = [
            {
                address: addressFromRelationship(
                    pool.relationships.base_token,
                    network,
                ),
                priceUSD: normalizedPrice(
                    attributes.base_token_price_usd,
                ),
            },
            {
                address: addressFromRelationship(
                    pool.relationships.quote_token,
                    network,
                ),
                priceUSD: normalizedPrice(
                    attributes.quote_token_price_usd,
                ),
            },
        ]

        for (const side of sides) {
            if (!side.address) continue
            const metadata = included.get(side.address)
            const existing = candidates.get(side.address)

            candidates.set(side.address, {
                address: side.address,
                name: existing?.name ?? metadata?.name ?? null,
                symbol: existing?.symbol ?? metadata?.symbol ?? null,
                decimals:
                    existing?.decimals ?? metadata?.decimals ?? null,
                imageUrl:
                    existing?.imageUrl ?? metadata?.imageUrl ?? null,
                priceUSD: existing?.priceUSD ?? side.priceUSD,
                coinGeckoId:
                    existing?.coinGeckoId ?? metadata?.coinGeckoId ?? null,
                imageSource: 'geckoterminal',
            })
        }
    }

    return [...candidates.values()]
}

export function extractPoolTokenAddresses(payload: unknown) {
    return extractPoolTokenCandidates(payload).map(
        (candidate) => candidate.address,
    )
}

export async function discoverTopPoolTokens({
    chainId = 56,
    minimumCandidates,
    signal,
}: {
    chainId?: number
    minimumCandidates?: number
    signal?: AbortSignal
} = {}): Promise<CandidateDiscoveryResult> {
    const apiConfig = getApiConfig()
    const config = apiConfig.geckoTerminal
    const context = tokenDiscoveryContext(chainId)
    if (!context.chain.capabilities.geckoTerminal) {
        return { candidates: [], pagesCompleted: 0, partial: true }
    }
    const network = context.chain.providers.geckoTerminalNetwork
    const target = Math.min(
        minimumCandidates ?? apiConfig.market.candidateLimit,
        apiConfig.market.candidateLimit,
    )
    const candidates = new Map<string, DiscoveredTokenCandidate>()
    let pagesCompleted = 0
    let partial = false

    for (let page = 1; page <= config.maxPages; page += 1) {
        let payload: unknown

        try {
            payload = await geckoTerminalRequest(
                `/networks/${encodeURIComponent(network)}/pools` +
                    `?include=base_token,quote_token&sort=h24_volume_usd_desc&page=${page}`,
                signal,
                page === 1 ? 2 : 0,
            )
        } catch (error) {
            if (candidates.size === 0) throw error

            // A later page must not discard usable candidates from earlier
            // pages. The next catalog refresh can fill the remaining slots.
            partial = true
            break
        }

        pagesCompleted += 1

        for (const candidate of extractPoolTokenCandidates(
            payload,
            network,
        )) {
            if (candidate.address === NATIVE_TOKEN_ADDRESS) continue

            const existing = candidates.get(candidate.address)
            candidates.set(candidate.address, {
                address: candidate.address,
                name: existing?.name ?? candidate.name,
                symbol: existing?.symbol ?? candidate.symbol,
                decimals: existing?.decimals ?? candidate.decimals,
                imageUrl: existing?.imageUrl ?? candidate.imageUrl,
                priceUSD: existing?.priceUSD ?? candidate.priceUSD,
                coinGeckoId:
                    existing?.coinGeckoId ?? candidate.coinGeckoId,
                imageSource: 'geckoterminal',
            })
        }

        if (candidates.size >= target) break
        if (page < config.maxPages && config.pageDelayMs > 0) {
            await sleep(config.pageDelayMs, signal)
        }
    }

    return {
        candidates: [...candidates.values()].slice(0, target),
        pagesCompleted,
        partial,
    }
}
