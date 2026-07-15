import { getApiConfig } from '../../config.js'
import {
    createTokenId,
    normalizeAddress,
} from '../../lib/address.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import { NATIVE_BNB_TOKEN } from '../../lib/native-token.js'
import { marketCatalogService } from '../../modules/market-tokens.js'
import { getCoinGeckoTokensBatch } from '../coingecko/token-data.js'
import { fetchTokenMarkets } from '../dexscreener/token-markets.js'
import { moralisWalletTokenService } from '../moralis/wallet-token-spam.js'
import { getCuratedBscRecognition } from '../recognition/curated-token-lists.js'
import {
    subscribeTokenSecurityAssessments,
    tokenSecurityService,
} from '../security/token-security.js'
import type { TokenSecurityAssessment } from '../security/types.js'
import { getTokenDecimalsBatch } from '../token-decimals.js'
import { alchemyRpc, alchemyRpcBatch } from './alchemy-client.js'
import { getTokenMetadataBatch } from './token-metadata.js'
import { getNativeBnbPrice, getTokenPrices } from './token-prices.js'

export type WalletToken = {
    classificationVersion: 3
    id: string
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string | null
    logoCandidates: string[]
    rawBalance: string
    formattedBalance: string
    balance: string
    priceUSD: string | null
    trustedPriceUSD: string | null
    marketPriceUSD: string | null
    valueUSD: string | null
    priceConfidence: 'trusted' | 'market' | 'untrusted' | 'unknown'
    coinGeckoId: string | null
    liquidityUsd: number
    isNative: boolean
    recognitionStatus: 'established' | 'recognized' | 'unverified'
    recognitionReasons: string[]
    verificationStatus: 'established' | 'recognized' | 'unverified'
    verificationReasons: string[]
    spamStatus: 'clean' | 'possible-spam' | 'unknown'
    possibleSpam: boolean | null
    verifiedContract: boolean | null
    spamReasons: string[]
    visibility: 'primary' | 'unverified' | 'hidden'
    visibilityReasons: string[]
    securityStatus: 'trusted' | 'low' | 'caution' | 'high' | 'blocked' | 'unknown'
    securityScore: number | null
    securityReasons: string[]
    securityProviders: {
        honeypot: {
            available: boolean
            checkedAt: string | null
            risk: string | null
            riskLevel: number | null
            isHoneypot: boolean | null
        }
        goPlus: {
            available: boolean
            checkedAt: string | null
            isHoneypot: boolean | null
        }
    }
}

type CacheEntry = {
    expiresAt: number
    tokens: WalletToken[]
}

type BalancePage = {
    balances: Map<string, bigint>
    nativeBalance: bigint | null
    pageCount: number
}

const MAX_BALANCE_PAGES = 50
const LEGACY_PAGE_SIZE = 100
export const WALLET_TOKEN_CLASSIFICATION_VERSION = 3 as const
const cache = new Map<string, CacheEntry>()

function walletCacheKey(
    chainId: number,
    walletAddress: string,
    includeZero: boolean,
) {
    return `v${WALLET_TOKEN_CLASSIFICATION_VERSION}:${chainId}:${walletAddress}:${includeZero}`
}

export function isCurrentWalletTokenRecord(value: unknown): value is WalletToken {
    if (!isRecord(value)) return false
    return value.classificationVersion === WALLET_TOKEN_CLASSIFICATION_VERSION &&
        ['established', 'recognized', 'unverified'].includes(String(value.recognitionStatus)) &&
        ['clean', 'possible-spam', 'unknown'].includes(String(value.spamStatus)) &&
        (value.possibleSpam === null || typeof value.possibleSpam === 'boolean') &&
        (value.verifiedContract === null || typeof value.verifiedContract === 'boolean') &&
        ['primary', 'unverified', 'hidden'].includes(String(value.visibility)) &&
        ['trusted', 'market', 'untrusted', 'unknown'].includes(String(value.priceConfidence))
}

function invalidateWalletTokenCacheForAddress(address: string) {
    for (const [key, entry] of cache) {
        if (entry.tokens.some((token) => token.address === address)) cache.delete(key)
    }
}

subscribeTokenSecurityAssessments((address) => {
    invalidateWalletTokenCacheForAddress(address)
})

export function clearWalletTokenCacheForTest() {
    cache.clear()
}

export function setWalletTokenCacheForTest({
    chainId,
    walletAddress,
    includeZero = false,
    tokens,
}: {
    chainId: number
    walletAddress: string
    includeZero?: boolean
    tokens: unknown[]
}) {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) throw new Error('Invalid wallet address.')
    cache.set(walletCacheKey(chainId, wallet, includeZero), {
        tokens: tokens as WalletToken[],
        expiresAt: Number.POSITIVE_INFINITY,
    })
}

export function formatTokenUnits(value: bigint, decimals: number) {
    if (decimals === 0) return value.toString()
    const scale = 10n ** BigInt(decimals)
    const whole = value / scale
    const fraction = (value % scale)
        .toString()
        .padStart(decimals, '0')
        .replace(/0+$/, '')

    return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function multiplyDecimal(left: string, right: string) {
    const [leftWhole, leftFraction = ''] = left.split('.')
    const [rightWhole, rightFraction = ''] = right.split('.')
    const scale = leftFraction.length + rightFraction.length
    const product =
        BigInt(`${leftWhole}${leftFraction}`) *
        BigInt(`${rightWhole}${rightFraction}`)
    return formatTokenUnits(product, scale)
}

function validPrice(value: string | null | undefined) {
    return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
        ? value
        : null
}

export function resolveWalletTokenPrice({
    freshMarketPrice,
    alchemyPrice,
    coinGeckoPrice,
    moralisPrice,
    dexScreenerPrice,
}: {
    freshMarketPrice?: string | null
    alchemyPrice?: string | null
    coinGeckoPrice?: string | null
    moralisPrice?: string | null
    dexScreenerPrice?: string | null
}) {
    return validPrice(freshMarketPrice) ??
        validPrice(alchemyPrice) ??
        validPrice(coinGeckoPrice) ??
        validPrice(moralisPrice) ??
        validPrice(dexScreenerPrice)
}

function resolveWalletTokenPricing(input: Parameters<typeof resolveWalletTokenPrice>[0]) {
    const sources = [
        ['catalog', input.freshMarketPrice],
        ['alchemy', input.alchemyPrice],
        ['coingecko', input.coinGeckoPrice],
        ['moralis', input.moralisPrice],
        ['dexscreener', input.dexScreenerPrice],
    ] as const
    for (const [source, value] of sources) {
        const priceUSD = validPrice(value)
        if (priceUSD !== null) return { priceUSD, source }
    }
    return { priceUSD: null, source: null }
}

export function resolveNativeBnbWalletPrice({
    nativePrice,
    wrappedNativePrice,
}: {
    nativePrice?: string | null
    wrappedNativePrice?: string | null
}) {
    return validPrice(nativePrice) ?? validPrice(wrappedNativePrice)
}

function compareDecimal(left: string | null, right: string | null) {
    const normalize = (value: string | null) => {
        const [whole = '0', fraction = ''] = (value ?? '0').split('.')
        return {
            whole: whole.replace(/^0+(?=\d)/, ''),
            fraction: fraction.replace(/0+$/, ''),
        }
    }
    const a = normalize(left)
    const b = normalize(right)
    if (a.whole.length !== b.whole.length) {
        return a.whole.length > b.whole.length ? 1 : -1
    }
    if (a.whole !== b.whole) return a.whole > b.whole ? 1 : -1
    const length = Math.max(a.fraction.length, b.fraction.length)
    const af = a.fraction.padEnd(length, '0')
    const bf = b.fraction.padEnd(length, '0')
    return af === bf ? 0 : af > bf ? 1 : -1
}

function rawBalance(value: unknown) {
    if (typeof value !== 'string' || !/^0x[a-fA-F0-9]+$/.test(value)) {
        return null
    }
    return BigInt(value)
}

export function suspiciousMetadata(name: string, symbol: string) {
    return /(https?:|www\.|\.(?:com|net|org|io|xyz)\b|t\.me|telegram|@[a-z0-9_]+|\bclaim\b|\bvisit\b|\breward\b|\bairdrop\b|\bvoucher\b|\bbonus\b|\bfree\b)/i.test(
        `${name} ${symbol}`,
    )
}

type WalletVisibilityInput = {
    isNative?: boolean
    established?: boolean
    exactRecognition?: boolean
    moralisVerified?: boolean
    pancakeSwapRecognized?: boolean
    trustWalletRecognized?: boolean
    trustedLocalMetadata?: boolean
    allowlisted?: boolean
    blocklisted?: boolean
    suspiciousIndicators?: string[]
    possibleSpam?: boolean | null
    securityStatus?: WalletToken['securityStatus']
}

export function classifyWalletTokenVisibility({
    isNative = false,
    established = false,
    exactRecognition = false,
    moralisVerified = false,
    pancakeSwapRecognized = false,
    trustWalletRecognized = false,
    trustedLocalMetadata = false,
    allowlisted = false,
    blocklisted = false,
    suspiciousIndicators = [],
    possibleSpam = null,
    securityStatus = 'unknown',
}: WalletVisibilityInput): Pick<WalletToken, 'visibility' | 'visibilityReasons'> {
    if (isNative) {
        return { visibility: 'primary', visibilityReasons: ['native-bnb'] }
    }
    if (blocklisted) {
        return { visibility: 'hidden', visibilityReasons: ['manual-blocklist'] }
    }
    if (securityStatus === 'blocked') {
        return { visibility: 'hidden', visibilityReasons: ['security-blocked'] }
    }
    if (securityStatus === 'high') {
        return { visibility: 'hidden', visibilityReasons: ['security-high'] }
    }
    if (possibleSpam === true) {
        return { visibility: 'hidden', visibilityReasons: ['moralis-possible-spam'] }
    }

    const primaryReasons = [
        ...(allowlisted ? ['manual-allowlist'] : []),
        ...(established ? ['established-catalog'] : []),
        ...(exactRecognition ? ['coingecko-exact-contract'] : []),
        ...(moralisVerified ? ['moralis-verified-contract'] : []),
        ...(pancakeSwapRecognized ? ['pancakeswap-curated-list'] : []),
        ...(trustWalletRecognized ? ['trustwallet-reviewed-asset'] : []),
        ...(trustedLocalMetadata ? ['trusted-local-metadata'] : []),
    ]
    if (primaryReasons.length > 0) {
        return { visibility: 'primary', visibilityReasons: primaryReasons }
    }

    return {
        visibility: 'unverified',
        visibilityReasons: [...new Set([
            'unverified-contract',
            ...suspiciousIndicators,
        ])],
    }
}

export function walletTokenVisibility(input: WalletVisibilityInput) {
    return classifyWalletTokenVisibility(input).visibility
}

export function fallbackTokenMetadata(address: string) {
    const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`
    return {
        name: `Token ${shortAddress}`,
        symbol: shortAddress,
        logoURI: '/icons/token-fallback.svg',
    }
}

export function createNativeWalletToken(
    rawBalance: bigint,
    priceUSD: string | null,
): WalletToken {
    const formattedBalance = formatTokenUnits(rawBalance, 18)
    return {
        ...NATIVE_BNB_TOKEN,
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        rawBalance: rawBalance.toString(),
        formattedBalance,
        balance: formattedBalance,
        priceUSD,
        trustedPriceUSD: priceUSD,
        marketPriceUSD: null,
        valueUSD: priceUSD ? multiplyDecimal(formattedBalance, priceUSD) : null,
        priceConfidence: priceUSD ? 'trusted' : 'unknown',
        coinGeckoId: NATIVE_BNB_TOKEN.coinGeckoId,
        liquidityUsd: 0,
        isNative: true,
        recognitionStatus: 'established',
        recognitionReasons: ['native-bnb'],
        spamStatus: 'clean',
        possibleSpam: false,
        verifiedContract: null,
        spamReasons: ['native-bnb'],
        securityStatus: 'trusted',
        securityScore: null,
        securityReasons: ['native-bnb'],
        securityProviders: {
            honeypot: {
                available: false,
                checkedAt: null,
                risk: null,
                riskLevel: null,
                isHoneypot: null,
            },
            goPlus: {
                available: false,
                checkedAt: null,
                isHoneypot: null,
            },
        },
        visibility: 'primary',
        visibilityReasons: ['native-bnb'],
    }
}

export function sortWalletTokens(tokens: WalletToken[]) {
    const verificationRank = { established: 0, recognized: 1, unverified: 2 }
    const visibilityRank = { primary: 0, unverified: 1, hidden: 2 }
    return tokens.sort((left, right) => {
        if (left.visibility !== right.visibility) {
            return visibilityRank[left.visibility] - visibilityRank[right.visibility]
        }
        const value = compareDecimal(right.valueUSD, left.valueUSD)
        if (value !== 0) return value
        const verification =
            verificationRank[left.verificationStatus] -
            verificationRank[right.verificationStatus]
        if (verification !== 0) return verification
        return left.name.localeCompare(right.name)
    })
}

function securityPresentation(
    assessment: TokenSecurityAssessment | null,
    recognized: boolean,
    blocklisted: boolean,
) {
    const status = blocklisted
        ? 'blocked' as const
        : assessment?.securityStatus === 'blocked' || assessment?.securityStatus === 'high' ||
            assessment?.securityStatus === 'caution'
          ? assessment.securityStatus
          : recognized
            ? 'trusted' as const
            : assessment?.securityStatus ?? 'unknown'
    return {
        securityStatus: status,
        securityScore: assessment?.securityScore ?? null,
        securityReasons: [...new Set([
            ...(blocklisted ? ['manual-blocklist'] : []),
            ...(assessment?.securityReasons ?? (!recognized ? ['security-provider-unavailable'] : [])),
        ])],
        securityProviders: {
            honeypot: {
                available: assessment?.honeypot.available ?? false,
                checkedAt: assessment?.honeypot.checkedAt ?? null,
                risk: assessment?.honeypot.risk ?? null,
                riskLevel: assessment?.honeypot.riskLevel ?? null,
                isHoneypot: assessment?.honeypot.isHoneypot ?? null,
            },
            goPlus: {
                available: assessment?.goPlus.available ?? false,
                checkedAt: assessment?.goPlus.checkedAt ?? null,
                isHoneypot: assessment?.goPlus.isHoneypot ?? null,
            },
        },
    }
}

export async function getAlchemyTokenBalancesPaginated({
    walletAddress,
    signal,
    rpc = alchemyRpc,
}: {
    walletAddress: string
    signal?: AbortSignal
    rpc?: typeof alchemyRpc
}): Promise<BalancePage> {
    const balances = new Map<string, bigint>()
    let pageKey: string | null = null
    let pageCount = 0

    do {
        if (pageCount >= MAX_BALANCE_PAGES) break
        const response = await rpc(
            {
                id: `erc20-${pageCount}`,
                jsonrpc: '2.0',
                method: 'alchemy_getTokenBalances',
                params: [
                    walletAddress,
                    'erc20',
                    {
                        maxCount: LEGACY_PAGE_SIZE,
                        ...(pageKey ? { pageKey } : {}),
                    },
                ],
            },
            signal,
        )
        pageCount += 1

        const items = isRecord(response) && Array.isArray(response.tokenBalances)
            ? response.tokenBalances
            : []
        for (const item of items) {
            if (!isRecord(item)) continue
            const address = normalizeAddress(item.contractAddress)
            const balance = rawBalance(item.tokenBalance)
            if (address && balance !== null) balances.set(address, balance)
        }
        pageKey = isRecord(response) && typeof response.pageKey === 'string'
            ? response.pageKey
            : null
    } while (pageKey)

    return { balances, nativeBalance: null, pageCount }
}

export async function getPortfolioTokenBalances({
    walletAddress,
    signal,
}: {
    walletAddress: string
    signal?: AbortSignal
}): Promise<BalancePage> {
    const config = getApiConfig().alchemy
    if (!config.apiKey) throw new Error('Alchemy Portfolio API is not configured.')

    const balances = new Map<string, bigint>()
    let nativeBalance: bigint | null = null
    let pageKey: string | null = null
    let pageCount = 0

    do {
        if (pageCount >= MAX_BALANCE_PAGES) break
        const url = new URL(
            `https://api.g.alchemy.com/data/v1/${encodeURIComponent(config.apiKey)}/assets/tokens/balances/by-address`,
        )
        const payload = await fetchJson(url, {
            method: 'POST',
            body: {
                addresses: [
                    { address: walletAddress, networks: [config.network] },
                ],
                includeNativeTokens: true,
                includeErc20Tokens: true,
                ...(pageKey ? { pageKey } : {}),
            },
            signal,
            timeoutMs: getApiConfig().requestTimeoutMs,
            retries: 1,
        })
        pageCount += 1
        const data = isRecord(payload) && isRecord(payload.data)
            ? payload.data
            : null
        const items = data && Array.isArray(data.tokens) ? data.tokens : []

        for (const item of items) {
            if (!isRecord(item) || item.network !== config.network) continue
            const balance = rawBalance(item.tokenBalance)
            if (balance === null) continue
            if (item.tokenAddress === null) {
                nativeBalance = balance
                continue
            }
            const address = normalizeAddress(item.tokenAddress)
            if (address) balances.set(address, balance)
        }
        pageKey = data && typeof data.pageKey === 'string'
            ? data.pageKey
            : null
    } while (pageKey)

    return { balances, nativeBalance, pageCount }
}

async function getAllBalances(wallet: string, signal?: AbortSignal) {
    try {
        return await getPortfolioTokenBalances({
            walletAddress: wallet,
            signal,
        })
    } catch {
        return getAlchemyTokenBalancesPaginated({
            walletAddress: wallet,
            signal,
        })
    }
}

export async function getWalletTokens({
    chainId,
    walletAddress,
    includeZero = false,
    signal,
}: {
    chainId: number
    walletAddress: string
    includeZero?: boolean
    signal?: AbortSignal
}): Promise<WalletToken[]> {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) throw new Error('Invalid wallet address.')

    const cacheKey = walletCacheKey(chainId, wallet, includeZero)
    const cached = cache.get(cacheKey)
    if (
        cached &&
        cached.expiresAt > Date.now() &&
        cached.tokens.every(isCurrentWalletTokenRecord)
    ) return cached.tokens
    if (cached) cache.delete(cacheKey)

    const catalogRequest = marketCatalogService.getCatalog()
        .then(({ catalog }) => ({
            tokens: catalog.tokens,
            priceFresh: Date.now() - catalog.generatedAt <= 60_000,
        }))
        .catch(() => ({ tokens: [], priceFresh: false }))
    const [balancePage, nativeResult, catalogResult, moralisResult] = await Promise.all([
        getAllBalances(wallet, signal),
        alchemyRpc(
            {
                id: 'native',
                jsonrpc: '2.0',
                method: 'eth_getBalance',
                params: [wallet, 'latest'],
            },
            signal,
        ).catch(() => null),
        catalogRequest,
        moralisWalletTokenService.getWalletTokens(wallet, signal),
    ])
    const nativeFromRpc = rawBalance(nativeResult)
    const nativeBalance = nativeFromRpc ?? balancePage.nativeBalance
    const balances = new Map(
        [...balancePage.balances].filter(([, value]) => includeZero || value > 0n),
    )
    const addresses = [...balances.keys()]
    const config = getApiConfig()
    const wrappedNativeAddress = config.market.wrappedNativeAddress
    const priceAddresses = [...new Set([...addresses, wrappedNativeAddress])]
    const metadata = await getTokenMetadataBatch({
        chainId,
        addresses,
        signal,
    }).catch(() => new Map())
    const missingMetadata = addresses.filter((address) => !metadata.get(address))

    const [
        decimalsResult,
        alchemyPrices,
        nativePrice,
        recognizedResult,
        marketResult,
        curatedResult,
    ] =
        await Promise.allSettled([
            getTokenDecimalsBatch({ addresses: missingMetadata, signal }),
            getTokenPrices({ addresses: priceAddresses, signal }),
            getNativeBnbPrice(signal),
            getCoinGeckoTokensBatch(priceAddresses, signal),
            fetchTokenMarkets(priceAddresses, signal),
            getCuratedBscRecognition(addresses, signal),
        ])
    const decimals = decimalsResult.status === 'fulfilled'
        ? decimalsResult.value
        : new Map<string, number | null>()
    const prices = alchemyPrices.status === 'fulfilled'
        ? alchemyPrices.value
        : new Map<string, string>()
    const recognized = recognizedResult.status === 'fulfilled'
        ? recognizedResult.value.tokens
        : new Map()
    const markets = marketResult.status === 'fulfilled'
        ? marketResult.value.markets
        : new Map()
    const curated = curatedResult.status === 'fulfilled'
        ? curatedResult.value
        : new Map()
    const catalog = new Map(
        catalogResult.tokens.map((token) => [token.address, token]),
    )
    const tokens: WalletToken[] = []

    if (nativeBalance !== null && (includeZero || nativeBalance > 0n)) {
        const directPrice = nativePrice.status === 'fulfilled'
            ? nativePrice.value
            : null
        const wrapped = catalog.get(wrappedNativeAddress)
        const wrappedPrice =
            (catalogResult.priceFresh ? wrapped?.priceUSD : null) ??
            prices.get(wrappedNativeAddress) ??
            recognized.get(wrappedNativeAddress)?.priceUSD ??
            markets.get(wrappedNativeAddress)?.priceUSD ??
            null
        const price = resolveNativeBnbWalletPrice({
            nativePrice: directPrice,
            wrappedNativePrice: wrappedPrice,
        })
        tokens.push(createNativeWalletToken(nativeBalance, price))
    }

    for (const [address, balance] of balances) {
        const exactMetadata = metadata.get(address)
        const coinGecko = recognized.get(address)
        const moralis = moralisResult.tokens.get(address)
        const curatedRecognition = curated.get(address)
        const market = markets.get(address)
        const catalogToken = catalog.get(address)
        const tokenDecimals =
            catalogToken?.decimals ?? coinGecko?.decimals ??
            moralis?.decimals ??
            exactMetadata?.decimals ?? decimals.get(address) ?? 18
        const fallback = fallbackTokenMetadata(address)
        const name = catalogToken?.name ?? coinGecko?.name ??
            moralis?.name ??
            exactMetadata?.name ?? market?.name ?? fallback.name
        const symbol = catalogToken?.symbol ?? coinGecko?.symbol ??
            moralis?.symbol ??
            exactMetadata?.symbol ?? market?.symbol ?? fallback.symbol
        const formattedBalance = formatTokenUnits(balance, tokenDecimals)
        const pricing = resolveWalletTokenPricing({
            freshMarketPrice:
                catalogResult.priceFresh ? catalogToken?.priceUSD : null,
            alchemyPrice: prices.get(address),
            coinGeckoPrice: coinGecko?.priceUSD,
            moralisPrice: moralis?.priceUSD,
            dexScreenerPrice: market?.priceUSD,
        })
        const exactRecognition = Boolean(coinGecko)
        const moralisVerified = moralis?.verifiedContract === true
        const pancakeSwapRecognized = curatedRecognition?.pancakeSwap === true
        const trustWalletRecognized = curatedRecognition?.trustWallet === true
        const established = Boolean(catalogToken)
        const allowlisted = config.walletTokens.allowlist.has(address)
        const blocklisted = config.walletTokens.blocklist.has(address)
        const trustedLocalMetadata = allowlisted
        const recognitionReasons = [
            ...(established ? ['established-catalog'] : []),
            ...(exactRecognition ? ['coingecko-exact-contract'] : []),
            ...(allowlisted ? ['manual-allowlist'] : []),
            ...(moralisVerified ? ['moralis-verified-contract'] : []),
            ...(pancakeSwapRecognized ? ['pancakeswap-curated-list'] : []),
            ...(trustWalletRecognized ? ['trustwallet-reviewed-asset'] : []),
        ]
        const recognitionStatus = established
            ? 'established'
            : recognitionReasons.length > 0
              ? 'recognized'
              : 'unverified'
        const possibleSpam = moralis?.possibleSpam ?? null
        const spamStatus = possibleSpam === true
            ? 'possible-spam' as const
            : possibleSpam === false
              ? 'clean' as const
              : 'unknown' as const
        const spamReasons = possibleSpam === true
            ? ['moralis-possible-spam']
            : possibleSpam === false
              ? ['moralis-clean']
              : ['moralis-spam-unknown']
        const security = securityPresentation(
            tokenSecurityService.getCachedAndRefresh(address),
            recognitionStatus !== 'unverified',
            blocklisted,
        )
        const suspiciousIndicators = [
            ...((market?.liquidityUsd ?? 0) < config.walletTokens.meaningfulLiquidityUsd
                ? ['low-liquidity'] : []),
            ...(pricing.priceUSD !== null && recognitionStatus === 'unverified'
                ? ['untrusted-market-price'] : []),
            ...(name.length > 120 || symbol.length > 32
                ? ['malformed-metadata']
                : []),
        ]
        const classification = classifyWalletTokenVisibility({
            established,
            exactRecognition,
            moralisVerified,
            pancakeSwapRecognized,
            trustWalletRecognized,
            trustedLocalMetadata,
            allowlisted,
            blocklisted,
            suspiciousIndicators,
            possibleSpam,
            securityStatus: security.securityStatus,
        })
        const recognizedIdentity = recognitionStatus !== 'unverified'
        const trustedPriceUSD = recognizedIdentity && possibleSpam !== true
            ? pricing.priceUSD
            : null
        const marketPriceUSD = trustedPriceUSD ? null : pricing.priceUSD
        const priceConfidence = trustedPriceUSD
            ? 'trusted' as const
            : pricing.priceUSD === null
              ? 'unknown' as const
              : ['moralis', 'dexscreener'].includes(String(pricing.source))
                ? 'market' as const
                : 'untrusted' as const
        const logoCandidates = [
            catalogToken?.logoURI,
            coinGecko?.imageUrl,
            moralis?.logoURI,
            exactMetadata?.logoURI,
            '/icons/token-fallback.svg',
        ].filter((value, index, values): value is string =>
            typeof value === 'string' && values.indexOf(value) === index,
        )

        tokens.push({
            classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
            id: createTokenId(chainId, address),
            chainId,
            address,
            name,
            symbol,
            decimals: tokenDecimals,
            logoURI: logoCandidates[0] ?? null,
            logoCandidates,
            rawBalance: balance.toString(),
            formattedBalance,
            balance: formattedBalance,
            priceUSD: pricing.priceUSD,
            trustedPriceUSD,
            marketPriceUSD,
            valueUSD: trustedPriceUSD
                ? multiplyDecimal(formattedBalance, trustedPriceUSD)
                : null,
            priceConfidence,
            coinGeckoId: coinGecko?.coinGeckoId ?? null,
            liquidityUsd: market?.liquidityUsd ?? 0,
            isNative: false,
            recognitionStatus,
            recognitionReasons,
            spamStatus,
            possibleSpam,
            verifiedContract: moralis?.verifiedContract ?? null,
            spamReasons,
            verificationStatus: recognitionStatus,
            verificationReasons: [
                ...recognitionReasons,
                ...(exactMetadata ? ['onchain-metadata'] : ['fallback-metadata']),
            ],
            ...security,
            visibility: classification.visibility,
            visibilityReasons: classification.visibilityReasons,
        })
    }

    sortWalletTokens(tokens)
    cache.set(cacheKey, {
        tokens,
        expiresAt: Date.now() + getApiConfig().alchemy.walletTtlMs,
    })
    return tokens
}

export { alchemyRpcBatch }
