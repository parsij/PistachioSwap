import {
    NATIVE_TOKEN_ADDRESS,
    createTokenId,
    normalizeAddress,
} from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import {
    marketCatalogService,
    type MarketToken,
} from '../../modules/market-tokens.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    canonicalTokenAddress,
    getTokenDiscoveryChain,
    requireActiveTokenDiscoveryChain,
} from '../../token-discovery/registry.js'
import {
    formatTokenUnits,
    multiplyDecimal,
    sortWalletTokens,
    WALLET_TOKEN_CLASSIFICATION_VERSION,
    type WalletToken,
} from '../alchemy/wallet-tokens.js'
import { getOfficialAsset } from '../recognition/curated-token-lists.js'
import { buildTokenLogo } from '../token-logos.js'

type AccountToken = {
    balance: bigint
    contract: string
    decimals: number
    name: string
    symbol: string
}

type Account = {
    balance: bigint
    pubkey: string
    tokens: AccountToken[]
}

type CacheEntry = {
    expiresAt: number
    tokens: WalletToken[]
}

export type UnchainedWalletTokenResult = {
    classificationVersion: typeof WALLET_TOKEN_CLASSIFICATION_VERSION
    address: string
    source: 'unchained'
    tokens: WalletToken[]
    queriedChainIds: number[]
    successfulChainIds: number[]
    failedChainIds: number[]
    providerRejectedChainIds: number[]
    chainErrors: Record<string, string>
    batchErrors: []
    partial: boolean
    stale: false
    diagnostics: {
        pageCount: number
        cacheStatus: 'hit' | 'miss'
        failureCode: string | null
    }
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<WalletToken[]>>()

function readBoolean(name: string, fallback: boolean) {
    const value = process.env[name]?.trim().toLowerCase()
    if (!value) return fallback
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error(`${name} must be true or false.`)
}

function normalizeEndpoint(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return null
    const url = new URL(value.trim())
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    const allowHttp = readBoolean('UNCHAINED_ALLOW_INSECURE_HTTP', false)
    if (
        url.username ||
        url.password ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || allowHttp)))
    ) {
        throw new Error(
            'Unchained endpoints must use HTTPS unless insecure HTTP is explicitly enabled.',
        )
    }
    return url.toString().replace(/\/+$/, '')
}

function configuredEndpoints() {
    const endpoints = new Map<number, string>()
    const raw = process.env.UNCHAINED_HTTP_URLS_JSON?.trim()
    if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (!isRecord(parsed)) {
            throw new Error('UNCHAINED_HTTP_URLS_JSON must be a JSON object.')
        }
        for (const [chainIdText, value] of Object.entries(parsed)) {
            const chainId = Number(chainIdText)
            if (!Number.isSafeInteger(chainId) || !getTokenDiscoveryChain(chainId)?.active) {
                continue
            }
            const endpoint = normalizeEndpoint(value)
            if (endpoint) endpoints.set(chainId, endpoint)
        }
    }
    for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
        const endpoint = normalizeEndpoint(process.env[`UNCHAINED_HTTP_URL_${chain.chainId}`])
        if (endpoint) endpoints.set(chain.chainId, endpoint)
    }
    return endpoints
}

export function getConfiguredUnchainedChainIds() {
    return [...configuredEndpoints().keys()].sort((left, right) => left - right)
}

export function isUnchainedWalletEnabled() {
    return readBoolean('UNCHAINED_ENABLED', true) && configuredEndpoints().size > 0
}

function accountUrl(endpoint: string, walletAddress: string) {
    const base = new URL(`${endpoint}/`)
    const path = base.pathname.replace(/\/+$/, '').endsWith('/api/v1')
        ? `account/${walletAddress}`
        : `api/v1/account/${walletAddress}`
    return new URL(path, base)
}

function nonnegativeInteger(value: unknown) {
    const text = String(value ?? '').trim()
    return /^\d+$/.test(text) ? BigInt(text) : null
}

function validDecimals(value: unknown) {
    const decimals = Number(value)
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
        ? decimals
        : null
}

function cleanText(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text && text.length <= maximum ? text : null
}

export function normalizeUnchainedAccount(value: unknown): Account | null {
    if (!isRecord(value)) return null
    const balance = nonnegativeInteger(value.balance)
    const pubkey = normalizeAddress(value.pubkey)
    if (balance === null || !pubkey || !Array.isArray(value.tokens)) return null
    const tokens: AccountToken[] = []
    for (const candidate of value.tokens) {
        if (!isRecord(candidate)) continue
        const contract = normalizeAddress(candidate.contract)
        const tokenBalance = nonnegativeInteger(candidate.balance)
        const decimals = validDecimals(candidate.decimals)
        const name = cleanText(candidate.name, 120)
        const symbol = cleanText(candidate.symbol, 32)
        if (!contract || tokenBalance === null || decimals === null || !name || !symbol) {
            continue
        }
        tokens.push({ balance: tokenBalance, contract, decimals, name, symbol })
    }
    return { balance, pubkey, tokens }
}

async function fetchAccount(
    endpoint: string,
    walletAddress: string,
    signal?: AbortSignal,
) {
    const payload = await fetchJson(accountUrl(endpoint, walletAddress), {
        signal,
        timeoutMs: Number(process.env.UNCHAINED_REQUEST_TIMEOUT_MS ?? 8_000),
        retries: 1,
        dedupeKey: `unchained-account:${endpoint}:${walletAddress}`,
    })
    const account = normalizeUnchainedAccount(payload)
    if (!account || account.pubkey !== walletAddress) {
        throw new ProviderError({
            code: 'UNCHAINED_ACCOUNT_RESPONSE_INVALID',
            message: 'Unchained returned an invalid account response.',
            statusCode: 502,
            outcome: 'upstream',
        })
    }
    return account
}

async function catalogByAddress(chainId: number) {
    try {
        const { catalog } = await marketCatalogService.getCatalog(chainId)
        return new Map<string, MarketToken>([
            ...catalog.tokens,
            ...(catalog.commonTokens ?? []),
        ].flatMap((token) => {
            const address = normalizeAddress(token.address)
            return address ? [[address, token] as const] : []
        }))
    } catch {
        return new Map<string, MarketToken>()
    }
}

function trustedCatalogToken(token?: MarketToken) {
    return Boolean(
        token &&
        token.verifiedContract === true &&
        token.possibleSpam !== true &&
        token.visibility === 'primary' &&
        ['core', 'established'].includes(String(token.classificationTier)) &&
        !['high', 'blocked'].includes(String(token.securityStatus)),
    )
}

function securityProviders() {
    return {
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
    }
}

function nativeToken(
    chainId: number,
    rawBalance: bigint,
    catalog: Map<string, MarketToken>,
): WalletToken {
    const chain = requireActiveTokenDiscoveryChain(chainId)
    const wrapped = catalog.get(chain.wrappedNative.address)
    const priceUSD = wrapped?.trustedPriceUSD ?? wrapped?.priceUSD ?? null
    const balance = formatTokenUnits(rawBalance, chain.native.decimals)
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        id: createTokenId(chainId, NATIVE_TOKEN_ADDRESS),
        chainId,
        address: NATIVE_TOKEN_ADDRESS,
        name: chain.native.name,
        symbol: chain.native.symbol,
        decimals: chain.native.decimals,
        logoURI: chain.chainLogoURI,
        logoCandidates: [chain.chainLogoURI, '/icons/token-fallback.svg'],
        logoSource: 'curated',
        rawBalance: rawBalance.toString(),
        formattedBalance: balance,
        balance,
        priceUSD,
        trustedPriceUSD: priceUSD,
        marketPriceUSD: null,
        valueUSD: priceUSD ? multiplyDecimal(balance, priceUSD) : null,
        priceConfidence: priceUSD ? 'trusted' : 'unknown',
        coinGeckoId: chain.native.coinGeckoId,
        liquidityUsd: wrapped?.liquidityUsd ?? 0,
        trustedLiquidityUsd: wrapped?.trustedLiquidityUsd ?? wrapped?.liquidityUsd ?? null,
        largestTrustedPoolLiquidityUsd:
            wrapped?.largestTrustedPoolLiquidityUsd ?? wrapped?.liquidityUsd ?? null,
        volume24hUsd: wrapped?.volume24hUsd ?? null,
        transactionCount24h:
            wrapped?.transactionCount24h ?? wrapped?.transactions24h ?? null,
        uniqueTraders24h: wrapped?.uniqueTraders24h ?? null,
        trustedPairCount: wrapped?.trustedPairCount ?? wrapped?.pairCount ?? null,
        oldestTrustedPoolCreatedAt:
            wrapped?.oldestTrustedPoolCreatedAt ?? wrapped?.oldestPairCreatedAt ?? null,
        establishedAgeDays: wrapped?.establishedAgeDays ?? null,
        estimatedSellValueUsd: priceUSD ? multiplyDecimal(balance, priceUSD) : null,
        classificationTier: 'core',
        classificationReasons: ['native-token', 'unchained-account-balance'],
        isNative: true,
        recognitionStatus: 'established',
        recognitionReasons: ['native-token', 'unchained-account-balance'],
        verificationStatus: 'established',
        verificationReasons: ['native-token', 'unchained-account-balance'],
        spamStatus: 'clean',
        possibleSpam: false,
        verifiedContract: null,
        officialAsset: true,
        issuer: null,
        officialWebsite: null,
        spamReasons: ['native-token'],
        securityStatus: 'trusted',
        securityScore: null,
        securityReasons: ['native-token'],
        securityProviders: securityProviders(),
        visibility: 'primary',
        visibilityReasons: ['native-token'],
        includeInPortfolioValue: true,
    }
}

function accountToken(
    chainId: number,
    token: AccountToken,
    catalogToken?: MarketToken,
): WalletToken {
    const official = getOfficialAsset(chainId, token.contract)
    const trusted = official !== null || trustedCatalogToken(catalogToken)
    const decimals = official?.decimals ?? catalogToken?.decimals ?? token.decimals
    const name = official?.name ?? catalogToken?.name ?? token.name
    const symbol = official?.symbol ?? catalogToken?.symbol ?? token.symbol
    const balance = formatTokenUnits(token.balance, decimals)
    const priceUSD = trusted
        ? catalogToken?.trustedPriceUSD ?? catalogToken?.priceUSD ?? null
        : null
    const reasons = trusted
        ? [...new Set([
              ...(catalogToken?.recognitionReasons ?? catalogToken?.verificationReasons ?? []),
              ...(official ? ['curated-official-contract'] : []),
              'unchained-account-balance',
          ])]
        : ['unchained-account-balance']
    const logo = buildTokenLogo({
        chainId,
        address: token.contract,
        curatedImages: official?.logoCandidates ?? catalogToken?.logoCandidates,
        localImage: catalogToken?.logoURI?.startsWith('/')
            ? catalogToken.logoURI
            : null,
        coinGeckoImage: catalogToken?.logoURI?.startsWith('http')
            ? catalogToken.logoURI
            : null,
    })
    const catalogTier = catalogToken?.classificationTier
    const tier: WalletToken['classificationTier'] = trusted
        ? catalogTier === 'core' || catalogTier === 'established'
            ? catalogTier
            : official ? 'core' : 'established'
        : 'hidden'
    const catalogSecurity = catalogToken?.securityStatus
    const securityStatus: WalletToken['securityStatus'] = trusted
        ? ['trusted', 'low', 'caution'].includes(String(catalogSecurity))
            ? catalogSecurity as WalletToken['securityStatus']
            : 'trusted'
        : 'unknown'
    const valueUSD = trusted && priceUSD ? multiplyDecimal(balance, priceUSD) : null
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        id: createTokenId(chainId, token.contract),
        chainId,
        address: token.contract,
        name,
        symbol,
        decimals,
        logoURI: logo.logoURI,
        logoCandidates: logo.logoCandidates,
        logoSource: official
            ? 'curated'
            : logo.logoURI === '/icons/token-fallback.svg'
              ? 'fallback'
              : 'provider',
        rawBalance: token.balance.toString(),
        formattedBalance: balance,
        balance,
        priceUSD,
        trustedPriceUSD: trusted ? priceUSD : null,
        marketPriceUSD: null,
        valueUSD,
        priceConfidence: trusted && priceUSD
            ? catalogToken?.priceConfidence === 'market' ? 'market' : 'trusted'
            : 'unknown',
        coinGeckoId: official?.coinGeckoId ?? catalogToken?.coinGeckoId ?? null,
        liquidityUsd: trusted ? catalogToken?.liquidityUsd ?? 0 : 0,
        trustedLiquidityUsd: trusted
            ? catalogToken?.trustedLiquidityUsd ?? catalogToken?.liquidityUsd ?? null
            : null,
        largestTrustedPoolLiquidityUsd: trusted
            ? catalogToken?.largestTrustedPoolLiquidityUsd ?? catalogToken?.liquidityUsd ?? null
            : null,
        volume24hUsd: trusted ? catalogToken?.volume24hUsd ?? null : null,
        transactionCount24h: trusted
            ? catalogToken?.transactionCount24h ?? catalogToken?.transactions24h ?? null
            : null,
        uniqueTraders24h: trusted ? catalogToken?.uniqueTraders24h ?? null : null,
        trustedPairCount: trusted
            ? catalogToken?.trustedPairCount ?? catalogToken?.pairCount ?? null
            : null,
        oldestTrustedPoolCreatedAt: trusted
            ? catalogToken?.oldestTrustedPoolCreatedAt ?? catalogToken?.oldestPairCreatedAt ?? null
            : null,
        establishedAgeDays: trusted ? catalogToken?.establishedAgeDays ?? null : null,
        estimatedSellValueUsd: valueUSD,
        classificationTier: tier,
        classificationReasons: trusted
            ? catalogToken?.classificationReasons ?? ['established-market-asset']
            : ['unverified-unchained-token'],
        isNative: false,
        recognitionStatus: trusted ? 'established' : 'unverified',
        recognitionReasons: reasons,
        verificationStatus: trusted ? 'established' : 'unverified',
        verificationReasons: reasons,
        spamStatus: trusted ? 'clean' : 'unknown',
        possibleSpam: trusted ? false : null,
        verifiedContract: official?.verifiedContract ?? (trusted ? true : null),
        officialAsset: official?.officialAsset ?? false,
        issuer: official?.issuer ?? null,
        officialWebsite: official?.officialWebsite ?? null,
        spamReasons: trusted
            ? ['unchained-upstream-spam-filter']
            : ['provider-spam-unknown'],
        securityStatus,
        securityScore: null,
        securityReasons: trusted
            ? catalogToken?.classificationReasons ?? ['established-market-asset']
            : ['security-provider-unavailable'],
        securityProviders: securityProviders(),
        visibility: trusted ? 'primary' : 'unverified',
        visibilityReasons: trusted ? reasons : ['unverified-unchained-token'],
        includeInPortfolioValue: valueUSD !== null,
    }
}

async function loadChainTokens({
    chainId,
    endpoint,
    walletAddress,
    includeZero,
    signal,
}: {
    chainId: number
    endpoint: string
    walletAddress: string
    includeZero: boolean
    signal?: AbortSignal
}) {
    const key = `${chainId}:${endpoint}:${walletAddress}:${includeZero}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
        return { tokens: cached.tokens, cacheStatus: 'hit' as const }
    }
    let request = inFlight.get(key)
    if (!request) {
        request = (async () => {
            const [account, catalog] = await Promise.all([
                fetchAccount(endpoint, walletAddress, signal),
                catalogByAddress(chainId),
            ])
            const chain = requireActiveTokenDiscoveryChain(chainId)
            const tokens: WalletToken[] = []
            if (includeZero || account.balance > 0n) {
                tokens.push(nativeToken(chainId, account.balance, catalog))
            }
            for (const held of account.tokens) {
                if (!includeZero && held.balance === 0n) continue
                if (chain.native.erc20Aliases.includes(held.contract as `0x${string}`)) continue
                const address = canonicalTokenAddress(chainId, held.contract)
                tokens.push(accountToken(
                    chainId,
                    { ...held, contract: address },
                    catalog.get(address),
                ))
            }
            sortWalletTokens(tokens)
            cache.set(key, { tokens, expiresAt: Date.now() + CACHE_TTL_MS })
            return tokens
        })().finally(() => inFlight.delete(key))
        inFlight.set(key, request)
    }
    return { tokens: await request, cacheStatus: 'miss' as const }
}

export async function getUnchainedWalletTokens({
    walletAddress,
    chainIds,
    includeZero = false,
    signal,
}: {
    walletAddress: string
    chainIds: readonly number[]
    includeZero?: boolean
    signal?: AbortSignal
}): Promise<UnchainedWalletTokenResult> {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) {
        throw new ProviderError({
            code: 'UNCHAINED_INVALID_WALLET_ADDRESS',
            message: 'A valid wallet address is required.',
            statusCode: 400,
            outcome: 'validation',
        })
    }
    const endpoints = configuredEndpoints()
    const requested = [...new Set(chainIds.map(Number))].filter((chainId) =>
        Number.isSafeInteger(chainId) && endpoints.has(chainId))
    if (requested.length === 0) {
        throw new ProviderError({
            code: 'UNCHAINED_NOT_CONFIGURED',
            message: 'No Unchained endpoint is configured for the requested chains.',
            statusCode: 503,
            outcome: 'configuration',
        })
    }

    const tokens: WalletToken[] = []
    const successfulChainIds: number[] = []
    const failedChainIds: number[] = []
    const chainErrors: Record<string, string> = {}
    let pageCount = 0
    let anyCacheHit = false
    let cursor = 0
    const workers = Array.from({ length: Math.min(4, requested.length) }, async () => {
        while (cursor < requested.length) {
            const chainId = requested[cursor]
            cursor += 1
            try {
                const result = await loadChainTokens({
                    chainId,
                    endpoint: endpoints.get(chainId)!,
                    walletAddress: wallet,
                    includeZero,
                    signal,
                })
                tokens.push(...result.tokens)
                successfulChainIds.push(chainId)
                pageCount += 1
                anyCacheHit ||= result.cacheStatus === 'hit'
            } catch {
                failedChainIds.push(chainId)
                chainErrors[String(chainId)] =
                    'This Unchained network balance could not be refreshed.'
            }
        }
    })
    await Promise.all(workers)
    if (successfulChainIds.length === 0) {
        throw new ProviderError({
            code: 'UNCHAINED_WALLET_UNAVAILABLE',
            message: 'Unchained wallet balances are unavailable.',
            statusCode: 503,
            retryable: true,
            outcome: 'upstream',
        })
    }
    sortWalletTokens(tokens)
    return {
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        address: wallet,
        source: 'unchained',
        tokens,
        queriedChainIds: requested,
        successfulChainIds: successfulChainIds.sort((left, right) => left - right),
        failedChainIds: failedChainIds.sort((left, right) => left - right),
        providerRejectedChainIds: [],
        chainErrors,
        batchErrors: [],
        partial: failedChainIds.length > 0,
        stale: false,
        diagnostics: {
            pageCount,
            cacheStatus: anyCacheHit ? 'hit' : 'miss',
            failureCode: null,
        },
    }
}

export function clearUnchainedWalletCacheForTest() {
    cache.clear()
    inFlight.clear()
}
