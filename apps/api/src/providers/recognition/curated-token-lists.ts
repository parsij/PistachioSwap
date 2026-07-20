import { normalizeAddress } from '../../lib/address.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import { getTrustWalletLogoUrl } from '../token-logos.js'

export type CuratedRecognition = {
    pancakeSwap: boolean
    trustWallet: boolean
    officialAsset: OfficialAsset | null
}

export type OfficialAsset = Readonly<{
    chainId: number
    address: `0x${string}`
    name: string
    symbol: string
    decimals: number
    issuer: string
    recognitionStatus: 'established'
    verifiedContract: true
    officialAsset: true
    coinGeckoId: string
    officialWebsite: string
    logoURI: string
    logoCandidates: readonly string[]
}>

export const OFFICIAL_ASSETS: readonly OfficialAsset[] = Object.freeze([
    ...[
        {
            address: '0x4200000000000000000000000000000000000006',
            name: 'Wrapped Ether', symbol: 'WETH', decimals: 18,
            issuer: 'Optimism', coinGeckoId: 'weth', officialWebsite: 'https://www.optimism.io/',
        },
        {
            address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
            name: 'USD Coin', symbol: 'USDC', decimals: 6,
            issuer: 'Circle', coinGeckoId: 'usd-coin', officialWebsite: 'https://www.circle.com/usdc',
        },
        {
            address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
            name: 'Tether USD', symbol: 'USDT', decimals: 6,
            issuer: 'Tether', coinGeckoId: 'tether', officialWebsite: 'https://tether.to/',
        },
        {
            address: '0x4200000000000000000000000000000000000042',
            name: 'Optimism', symbol: 'OP', decimals: 18,
            issuer: 'Optimism', coinGeckoId: 'optimism', officialWebsite: 'https://www.optimism.io/',
        },
        {
            address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
            name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18,
            issuer: 'Sky', coinGeckoId: 'dai', officialWebsite: 'https://sky.money/',
        },
        {
            address: '0x68f180fcce6836688e9084f035309e29bf0a2095',
            name: 'Wrapped Bitcoin', symbol: 'WBTC', decimals: 8,
            issuer: 'Wrapped Bitcoin', coinGeckoId: 'wrapped-bitcoin', officialWebsite: 'https://wbtc.network/',
        },
    ].map((asset) => Object.freeze({
        chainId: 10,
        ...asset,
        address: asset.address as `0x${string}`,
        recognitionStatus: 'established' as const,
        verifiedContract: true as const,
        officialAsset: true as const,
        logoURI: getTrustWalletLogoUrl(10, asset.address)!,
        logoCandidates: Object.freeze([
            getTrustWalletLogoUrl(10, asset.address)!,
            '/icons/token-fallback.svg',
        ]),
    })),
    Object.freeze({
        chainId: 56,
        address: '0x21caef8a43163eea865baee23b9c2e327696a3bf',
        name: 'Tether Gold',
        symbol: 'XAUt',
        decimals: 6,
        issuer: 'Tether',
        recognitionStatus: 'established',
        verifiedContract: true,
        officialAsset: true,
        coinGeckoId: 'tether-gold',
        officialWebsite: 'https://gold.tether.to/',
        logoURI: '/icons/tether-gold.png',
        logoCandidates: Object.freeze([
            '/icons/tether-gold.png',
            'https://raw.githubusercontent.com/trustwallet/assets/master/' +
                'blockchains/smartchain/assets/' +
                '0x21cAef8A43163Eea865baeE23b9C2E327696A3bf/logo.png',
        ]),
    }),
])

export function getOfficialAssetsForChain(chainId: number) {
    return OFFICIAL_ASSETS.filter((asset) => asset.chainId === Number(chainId))
}

const OFFICIAL_ASSET_BY_ID = new Map(
    OFFICIAL_ASSETS.map((asset) => [`${asset.chainId}:${asset.address}`, asset]),
)

export function getOfficialAsset(chainId: number, address: unknown) {
    const normalized = normalizeAddress(address)
    return normalized
        ? OFFICIAL_ASSET_BY_ID.get(`${Number(chainId)}:${normalized}`) ?? null
        : null
}

function officialRecognition(asset: OfficialAsset): CuratedRecognition {
    return {
        pancakeSwap: false,
        trustWallet: false,
        officialAsset: asset,
    }
}

function createRecognitionSeed() {
    return new Map(
        OFFICIAL_ASSETS.filter((asset) => asset.chainId === 56)
            .map((asset) => [asset.address, officialRecognition(asset)]),
    )
}

type CacheEntry = {
    expiresAt: number
    values: Map<string, CuratedRecognition>
}

const LIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const LIST_URLS = [
    {
        source: 'pancakeSwap' as const,
        url: 'https://tokens.pancakeswap.finance/pancakeswap-default.json',
    },
    {
        source: 'pancakeSwap' as const,
        url: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
    },
    {
        source: 'trustWallet' as const,
        url: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/tokenlist.json',
    },
    {
        source: 'trustWallet' as const,
        url: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/tokenlist-extended.json',
    },
]

let cache: CacheEntry | null = null
let pending: Promise<Map<string, CuratedRecognition>> | null = null

export function mergeCuratedTokenList(
    target: Map<string, CuratedRecognition>,
    payload: unknown,
    source: keyof CuratedRecognition,
) {
    const values = Array.isArray(payload)
        ? payload
        : isRecord(payload) && Array.isArray(payload.tokens)
          ? payload.tokens
          : []
    for (const value of values) {
        if (!isRecord(value)) continue
        if (value.chainId !== undefined && Number(value.chainId) !== 56) continue
        const address = normalizeAddress(value.address)
        if (!address) continue
        const current = target.get(address) ?? {
            pancakeSwap: false,
            trustWallet: false,
            officialAsset: getOfficialAsset(56, address),
        }
        target.set(address, { ...current, [source]: true })
    }
}

async function refresh(signal?: AbortSignal) {
    const values = createRecognitionSeed()
    const results = await Promise.allSettled(LIST_URLS.map(async (entry) => {
        const payload = await fetchJson(new URL(entry.url), {
            signal,
            timeoutMs: 10_000,
            retries: 1,
            dedupeKey: `curated-token-list:${entry.url}`,
        })
        mergeCuratedTokenList(values, payload, entry.source)
    }))
    if (results.every((result) => result.status === 'rejected')) {
        return cache?.values ?? values
    }
    cache = { values, expiresAt: Date.now() + LIST_CACHE_TTL_MS }
    return values
}

export async function getCuratedBscRecognition(
    addresses: string[],
    signal?: AbortSignal,
) {
    const now = Date.now()
    let values = cache?.expiresAt && cache.expiresAt > now
        ? cache.values
        : null
    if (!values) {
        pending ??= refresh(signal).finally(() => {
            pending = null
        })
        values = await pending
    }

    const result = new Map<string, CuratedRecognition>()
    for (const value of addresses) {
        const address = normalizeAddress(value)
        const recognition = address
            ? values.get(address) ?? (() => {
                  const officialAsset = getOfficialAsset(56, address)
                  return officialAsset ? officialRecognition(officialAsset) : null
              })()
            : null
        if (address && recognition) result.set(address, recognition)
    }
    return result
}

export function clearCuratedRecognitionCacheForTest() {
    cache = null
    pending = null
}
