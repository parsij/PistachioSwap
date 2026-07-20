import {
    getApiConfig,
    getWalletTokenAddressPolicy,
} from '../../config.js'
import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../../lib/address.js'
import { isRecord } from '../../lib/http.js'
import { setBoundedCacheEntry } from '../../lib/bounded-cache.js'
import { NATIVE_BNB_TOKEN } from '../../lib/native-token.js'
import {
    canonicalTokenAddress,
    requireActiveTokenDiscoveryChain,
} from '../../token-discovery/registry.js'
import { marketCatalogService } from '../../modules/market-tokens.js'
import { getCoinGeckoTokensBatch } from '../coingecko/token-data.js'
import { fetchTokenMarkets } from '../dexscreener/token-markets.js'
import { moralisWalletTokenService } from '../moralis/wallet-token-spam.js'
import {
    getCuratedBscRecognition,
    getOfficialAsset,
} from '../recognition/curated-token-lists.js'
import {
    subscribeTokenSecurityAssessments,
    tokenSecurityService,
} from '../security/token-security.js'
import type { TokenSecurityAssessment } from '../security/types.js'
import { getTokenDecimalsBatch } from '../token-decimals.js'
import { alchemyRpc, alchemyRpcBatch } from './alchemy-client.js'
import {
    getTokenMetadataBatch,
    type TokenMetadata,
} from './token-metadata.js'
import { getNativeBnbPrice, getTokenPrices } from './token-prices.js'

export type WalletToken = {
    classificationVersion: 4
    id: string
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string | null
    logoCandidates: string[]
    logoSource?: 'curated' | 'provider' | 'local' | 'fallback'
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
    officialAsset?: boolean
    issuer?: string | null
    officialWebsite?: string | null
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

export type WalletTokenInventory = BalancePage & {
    metadata: Map<string, TokenMetadata>
    prices: Map<string, string>
    nativePriceUSD: string | null
    source: 'alchemy-portfolio'
}

const MAX_BALANCE_PAGES = 50
const LEGACY_PAGE_SIZE = 100
export const WALLET_TOKEN_CLASSIFICATION_VERSION = 4 as const
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

function invalidateWalletTokenCacheForAddress(chainId: number, address: string) {
    for (const [key, entry] of cache) {
        if (
            key.startsWith(`v${WALLET_TOKEN_CLASSIFICATION_VERSION}:${chainId}:`) &&
            entry.tokens.some((token) => token.address === address)
        ) cache.delete(key)
    }
}

subscribeTokenSecurityAssessments((address, assessment) => {
    invalidateWalletTokenCacheForAddress(assessment.chainId, address)
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
    setBoundedCacheEntry(cache, walletCacheKey(chainId, wallet, includeZero), {
        tokens: tokens as WalletToken[],
        expiresAt: Number.POSITIVE_INFINITY,
    }, 1_000)
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
    portfolioPrice,
    alchemyPrice,
    coinGeckoPrice,
    moralisPrice,
    dexScreenerPrice,
}: {
    freshMarketPrice?: string | null
    portfolioPrice?: string | null
    alchemyPrice?: string | null
    coinGeckoPrice?: string | null
    moralisPrice?: string | null
    dexScreenerPrice?: string | null
}) {
    return validPrice(freshMarketPrice) ??
        validPrice(portfolioPrice) ??
        validPrice(alchemyPrice) ??
        validPrice(coinGeckoPrice) ??
        validPrice(moralisPrice) ??
        validPrice(dexScreenerPrice)
}

function resolveWalletTokenPricing(input: Parameters<typeof resolveWalletTokenPrice>[0]) {
    const sources = [
        ['catalog', input.freshMarketPrice],
        ['alchemy-portfolio', input.portfolioPrice],
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
    priceSource: 'trusted' | 'market' = 'trusted',
): WalletToken {
    const formattedBalance = formatTokenUnits(rawBalance, 18)
    const trustedPriceUSD = priceSource === 'trusted' ? priceUSD : null
    const marketPriceUSD = priceSource === 'market' ? priceUSD : null
    return {
        ...NATIVE_BNB_TOKEN,
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        rawBalance: rawBalance.toString(),
        formattedBalance,
        balance: formattedBalance,
        priceUSD,
        trustedPriceUSD,
        marketPriceUSD,
        valueUSD: trustedPriceUSD
            ? multiplyDecimal(formattedBalance, trustedPriceUSD)
            : null,
        priceConfidence: priceUSD ? priceSource : 'unknown',
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

function createNativeWalletTokenForChain(
    chainId: number,
    rawBalance: bigint,
    priceUSD: string | null,
    priceSource: 'trusted' | 'market' = 'trusted',
): WalletToken {
    if (chainId === 56) {
        return createNativeWalletToken(rawBalance, priceUSD, priceSource)
    }
    const chain = requireActiveTokenDiscoveryChain(chainId)
    return {
        ...createNativeWalletToken(rawBalance, priceUSD, priceSource),
        id: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
        chainId,
        name: chain.native.name,
        symbol: chain.native.symbol,
        decimals: chain.native.decimals,
        logoURI: chain.chainLogoURI,
        logoCandidates: [chain.chainLogoURI],
        coinGeckoId: chain.native.coinGeckoId,
        recognitionReasons: ['native-token'],
        verificationReasons: ['native-token'],
        spamReasons: ['native-token'],
        securityReasons: ['native-token'],
        visibilityReasons: ['native-token'],
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
    chainId = 56,
    walletAddress,
    signal,
    rpc = alchemyRpc,
}: {
    chainId?: number
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
            chainId,
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

async function getAllBalances(chainId: number, wallet: string, signal?: AbortSignal) {
    return getAlchemyTokenBalancesPaginated({
        walletAddress: wallet,
        signal,
        chainId,
    })
}

export async function getWalletTokens({
    chainId,
    walletAddress,
    includeZero = false,
    signal,
    inventory,
}: {
    chainId: number
    walletAddress: string
    includeZero?: boolean
    signal?: AbortSignal
    inventory?: WalletTokenInventory
}): Promise<WalletToken[]> {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) throw new Error('Invalid wallet address.')
    const chain = requireActiveTokenDiscoveryChain(chainId)

    const cacheKey = walletCacheKey(chainId, wallet, includeZero)
    const cached = inventory ? null : cache.get(cacheKey)
    if (
        cached &&
        cached.expiresAt > Date.now() &&
        cached.tokens.every(isCurrentWalletTokenRecord)
    ) return cached.tokens
    if (cached) cache.delete(cacheKey)

    const catalogRequest = marketCatalogService.getCatalog(chainId)
        .then(({ catalog }) => ({
            tokens: catalog.tokens,
            priceFresh: Date.now() - catalog.generatedAt <= 60_000,
        }))
        .catch(() => ({ tokens: [], priceFresh: false }))
    const [balancePage, nativeResult, catalogResult, moralisResult] = await Promise.all([
        inventory ?? getAllBalances(chainId, wallet, signal),
        inventory
            ? Promise.resolve(null)
            : alchemyRpc(
                  {
                      id: 'native',
                      jsonrpc: '2.0',
                      method: 'eth_getBalance',
                      params: [wallet, 'latest'],
                  },
                  signal,
                  chainId,
              ).catch(() => null),
        catalogRequest,
        moralisWalletTokenService.getWalletTokens(wallet, signal, chainId),
    ])
    const nativeFromRpc = rawBalance(nativeResult)
    const nativeBalance = nativeFromRpc ?? balancePage.nativeBalance
    const balances = new Map(
        [...balancePage.balances].filter(([, value]) => includeZero || value > 0n),
    )
    const addresses = [...balances.keys()]
    const config = getApiConfig()
    const addressPolicy = getWalletTokenAddressPolicy(chainId)
    const wrappedNativeAddress = chain.wrappedNative.address
    const needsWrappedNativePrice =
        nativeBalance !== null && inventory?.nativePriceUSD == null
    const priceAddresses = [...new Set([
        ...addresses,
        ...(needsWrappedNativePrice ? [wrappedNativeAddress] : []),
    ])]
    const metadata = new Map<string, TokenMetadata>(inventory?.metadata ?? [])
    const missingPortfolioMetadata = addresses.filter(
        (address) => !metadata.has(address),
    )
    if (missingPortfolioMetadata.length > 0) {
        const fallbackMetadata = await getTokenMetadataBatch({
            chainId,
            addresses: missingPortfolioMetadata,
            signal,
        }).catch(() => new Map())
        for (const [address, value] of fallbackMetadata) {
            if (value) metadata.set(address, value)
        }
    }
    const missingMetadata = addresses.filter((address) => !metadata.get(address))

    const providedPrices = new Map<string, string>(inventory?.prices ?? [])
    const missingPriceAddresses = priceAddresses.filter(
        (address) => !providedPrices.has(address),
    )
    const shouldFetchNativePrice = inventory?.nativePriceUSD == null

    const [
        decimalsResult,
        alchemyPrices,
        nativePrice,
        recognizedResult,
        marketResult,
        curatedResult,
    ] =
        await Promise.allSettled([
            getTokenDecimalsBatch({ chainId, addresses: missingMetadata, signal }),
            getTokenPrices({
                chainId,
                addresses: missingPriceAddresses,
                signal,
            }),
            shouldFetchNativePrice
                ? getNativeBnbPrice(signal, chainId)
                : Promise.resolve(null),
            getCoinGeckoTokensBatch(priceAddresses, signal, chainId),
            fetchTokenMarkets(priceAddresses, signal, chainId),
            chainId === 56
                ? getCuratedBscRecognition(addresses, signal)
                : Promise.resolve(new Map()),
        ])
    const decimals = decimalsResult.status === 'fulfilled'
        ? decimalsResult.value
        : new Map<string, number | null>()
    const prices = new Map(providedPrices)
    if (alchemyPrices.status === 'fulfilled') {
        for (const [address, price] of alchemyPrices.value) {
            prices.set(address, price)
        }
    }
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
        const portfolioNativePrice = inventory?.nativePriceUSD ?? null
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
            nativePrice: portfolioNativePrice ?? directPrice,
            wrappedNativePrice: wrappedPrice,
        })
        tokens.push(createNativeWalletTokenForChain(
            chainId,
            nativeBalance,
            price,
            portfolioNativePrice !== null ? 'market' : 'trusted',
        ))
    }

    for (const [address, balance] of balances) {
        const exactMetadata = metadata.get(address)
        const coinGecko = recognized.get(address)
        const moralis = moralisResult.tokens.get(address)
        const curatedRecognition = curated.get(address)
        const officialAsset = getOfficialAsset(chainId, address) ??
            curatedRecognition?.officialAsset ?? null
        const market = markets.get(address)
        const catalogToken = catalog.get(address)
        const tokenDecimals =
            officialAsset?.decimals ?? catalogToken?.decimals ?? coinGecko?.decimals ??
            moralis?.decimals ??
            exactMetadata?.decimals ?? decimals.get(address) ?? 18
        const fallback = fallbackTokenMetadata(address)
        const name = officialAsset?.name ?? catalogToken?.name ?? coinGecko?.name ??
            moralis?.name ??
            exactMetadata?.name ?? market?.name ?? fallback.name
        const symbol = officialAsset?.symbol ?? catalogToken?.symbol ?? coinGecko?.symbol ??
            moralis?.symbol ??
            exactMetadata?.symbol ?? market?.symbol ?? fallback.symbol
        const formattedBalance = formatTokenUnits(balance, tokenDecimals)
        const pricing = resolveWalletTokenPricing({
            freshMarketPrice:
                catalogResult.priceFresh ? catalogToken?.priceUSD : null,
            portfolioPrice: inventory?.prices.get(address),
            alchemyPrice: alchemyPrices.status === 'fulfilled'
                ? alchemyPrices.value.get(address)
                : null,
            coinGeckoPrice: coinGecko?.priceUSD,
            moralisPrice: moralis?.priceUSD,
            dexScreenerPrice: market?.priceUSD,
        })
        const exactRecognition = Boolean(coinGecko)
        const moralisVerified = moralis?.verifiedContract === true
        const pancakeSwapRecognized = curatedRecognition?.pancakeSwap === true
        const trustWalletRecognized = curatedRecognition?.trustWallet === true
        const established = Boolean(officialAsset || catalogToken)
        const allowlisted = addressPolicy.allowlist.has(address)
        const blocklisted = addressPolicy.blocklist.has(address)
        const trustedLocalMetadata = allowlisted
        const recognitionReasons = [
            ...(officialAsset ? ['curated-official-contract'] : []),
            ...(catalogToken ? ['established-catalog'] : []),
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
        const possibleSpam = moralis?.possibleSpam ?? (officialAsset ? false : null)
        const spamStatus = possibleSpam === true
            ? 'possible-spam' as const
            : possibleSpam === false
              ? 'clean' as const
              : 'unknown' as const
        const spamReasons = possibleSpam === true
            ? ['moralis-possible-spam']
            : possibleSpam === false
              ? [moralis
                    ? 'moralis-clean'
                    : officialAsset
                      ? 'curated-official-contract'
                      : 'spam-check-clean']
              : ['moralis-spam-unknown']
        const security = securityPresentation(
            tokenSecurityService.getCachedAndRefresh(address, chainId),
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
        const portfolioMarketPrice = inventory?.prices.get(address) ?? null
        const trustedPriceUSD = recognizedIdentity &&
            possibleSpam !== true &&
            pricing.source !== 'alchemy-portfolio'
            ? pricing.priceUSD
            : null
        const marketPriceUSD = trustedPriceUSD ? null : pricing.priceUSD
        const priceConfidence = trustedPriceUSD
            ? 'trusted' as const
            : pricing.priceUSD === null
              ? 'unknown' as const
              : portfolioMarketPrice !== null ||
                    ['moralis', 'dexscreener'].includes(String(pricing.source))
                ? 'market' as const
                : 'untrusted' as const
        const logoCandidates = [
            ...(officialAsset?.logoCandidates ?? []),
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
            logoSource: officialAsset ? 'curated' :
                logoCandidates[0] === '/icons/token-fallback.svg'
                    ? 'fallback'
                    : 'provider',
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
            coinGeckoId: officialAsset?.coinGeckoId ?? coinGecko?.coinGeckoId ?? null,
            liquidityUsd: market?.liquidityUsd ?? 0,
            isNative: false,
            recognitionStatus,
            recognitionReasons,
            spamStatus,
            possibleSpam,
            verifiedContract: officialAsset?.verifiedContract ??
                moralis?.verifiedContract ?? null,
            officialAsset: officialAsset?.officialAsset ?? false,
            issuer: officialAsset?.issuer ?? null,
            officialWebsite: officialAsset?.officialWebsite ?? null,
            spamReasons,
            verificationStatus: recognitionStatus,
            verificationReasons: [
                ...recognitionReasons,
                ...(inventory?.metadata.has(address)
                    ? ['alchemy-portfolio-metadata']
                    : exactMetadata
                      ? ['onchain-metadata']
                      : ['fallback-metadata']),
            ],
            ...security,
            visibility: classification.visibility,
            visibilityReasons: classification.visibilityReasons,
        })
    }

    const canonicalTokens = new Map<string, WalletToken>()
    for (const token of tokens) {
        const canonicalAddress = canonicalTokenAddress(token.chainId, token.address)
        const identity = createTokenId(token.chainId, canonicalAddress)
        const existing = canonicalTokens.get(identity)
        if (!existing) {
            canonicalTokens.set(identity, canonicalAddress === token.address
                ? token
                : { ...token, id: identity, address: canonicalAddress, isNative: true })
            continue
        }
        const preferred = existing.address === NATIVE_TOKEN_ADDRESS
            ? existing
            : token.address === NATIVE_TOKEN_ADDRESS ? token : existing
        const supplement = preferred === existing ? token : existing
        canonicalTokens.set(identity, {
            ...supplement,
            ...preferred,
            id: identity,
            address: canonicalAddress,
            name: canonicalAddress === NATIVE_TOKEN_ADDRESS ? chain.native.name : preferred.name,
            symbol: canonicalAddress === NATIVE_TOKEN_ADDRESS ? chain.native.symbol : preferred.symbol,
            isNative: canonicalAddress === NATIVE_TOKEN_ADDRESS,
            priceUSD: preferred.priceUSD ?? supplement.priceUSD,
            trustedPriceUSD: preferred.trustedPriceUSD ?? supplement.trustedPriceUSD,
            marketPriceUSD: preferred.marketPriceUSD ?? supplement.marketPriceUSD,
            valueUSD: preferred.valueUSD ?? supplement.valueUSD,
            logoURI: preferred.logoURI ?? supplement.logoURI,
            logoCandidates: [...new Set([
                ...preferred.logoCandidates,
                ...supplement.logoCandidates,
            ])],
        })
    }
    tokens.splice(0, tokens.length, ...canonicalTokens.values())
    sortWalletTokens(tokens)
    if (!inventory) {
        setBoundedCacheEntry(cache, cacheKey, {
            tokens,
            expiresAt: Date.now() + getApiConfig().alchemy.walletTtlMs,
        }, 1_000)
    }
    return tokens
}

export { alchemyRpcBatch }
