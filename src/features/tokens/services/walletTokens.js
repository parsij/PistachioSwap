import { multiplyUsdAmount } from '../../../services/fiatValue.js'
import {
    getCanonicalTokenIdentity,
    mergeCanonicalTokenRecords,
} from './marketTokens.js'
import {
    isTokenDiscoveryChainId,
    TOKEN_DISCOVERY_CHAIN_IDS,
} from '../../../web3/curatedEvmChains.js'

const walletTokenRequests = new Map()

export const WALLET_TOKEN_CLASSIFICATION_VERSION = 5
export const WALLET_TOKEN_CACHE_NAMESPACE = 'pistachioswap:wallet-tokens:v5:'
const LEGACY_WALLET_TOKEN_CACHE_NAMESPACES = [
    'pistachioswap:wallet-tokens:v1:',
    'pistachioswap:wallet-tokens:v2:',
    'pistachioswap:wallet-tokens:v3:',
    'pistachioswap:wallet-tokens:v4:',
]

export function clearLegacyWalletTokenCacheKeys(storage) {
    if (!storage) return
    try {
        const keys = Array.from(
            { length: storage.length },
            (_, index) => storage.key(index),
        ).filter(Boolean)
        for (const key of keys) {
            if (LEGACY_WALLET_TOKEN_CACHE_NAMESPACES.some((prefix) => key.startsWith(prefix))) {
                storage.removeItem(key)
            }
        }
    } catch {
        // Browser storage may be unavailable.
    }
}

export function isCurrentWalletTokenRecord(token) {
    return token !== null &&
        typeof token === 'object' &&
        getCanonicalTokenIdentity(token) !== null &&
        token.classificationVersion === WALLET_TOKEN_CLASSIFICATION_VERSION &&
        ['established', 'recognized', 'unverified'].includes(token.recognitionStatus) &&
        ['clean', 'possible-spam', 'unknown'].includes(token.spamStatus) &&
        (token.possibleSpam === null || typeof token.possibleSpam === 'boolean') &&
        (token.verifiedContract === null || typeof token.verifiedContract === 'boolean') &&
        ['trusted', 'low', 'caution', 'high', 'blocked', 'unknown'].includes(token.securityStatus) &&
        ['primary', 'unverified', 'hidden'].includes(token.visibility) &&
        ['trusted', 'market', 'untrusted', 'unknown'].includes(token.priceConfidence)
}

function normalizedDecimal(value) {
    const text = String(value ?? '').trim()
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
    if (!match) return null
    return {
        whole: match[1].replace(/^0+(?=\d)/, ''),
        fraction: match[2] ?? '',
    }
}

function groupedInteger(value) {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatWalletTokenAmount(value) {
    const decimal = normalizedDecimal(value)
    if (!decimal) return '0'
    const positive = /[1-9]/.test(`${decimal.whole}${decimal.fraction}`)
    if (!positive) return '0'

    if (decimal.whole === '0') {
        const firstNonZero = decimal.fraction.search(/[1-9]/)
        if (firstNonZero >= 6) return '<0.000001'
    }

    const fraction = decimal.fraction.slice(0, 6).replace(/0+$/, '')
    return fraction
        ? `${groupedInteger(decimal.whole)}.${fraction}`
        : groupedInteger(decimal.whole)
}

function formatUsdDecimal(value) {
    const decimal = normalizedDecimal(value)
    if (!decimal) return '—'
    const digits = `${decimal.whole}${decimal.fraction}`
    if (!/[1-9]/.test(digits)) return '$0.00'
    if (
        decimal.whole === '0' &&
        decimal.fraction.padEnd(2, '0').slice(0, 2) === '00'
    ) {
        return '<$0.01'
    }

    const scale = decimal.fraction.length
    const integer = BigInt(digits)
    let cents
    if (scale <= 2) {
        cents = integer * 10n ** BigInt(2 - scale)
    } else {
        const divisor = 10n ** BigInt(scale - 2)
        cents = integer / divisor
        if ((integer % divisor) * 2n >= divisor) cents += 1n
    }

    const whole = cents / 100n
    const fraction = (cents % 100n).toString().padStart(2, '0')
    return fraction === '00'
        ? `$${groupedInteger(whole.toString())}`
        : `$${groupedInteger(whole.toString())}.${fraction}`
}

export function resolveWalletUsdValue(token) {
    if (token?.includeInPortfolioValue === false ||
        token?.priceConfidence === 'untrusted') return null
    if (normalizedDecimal(token?.valueUSD)) return String(token.valueUSD)
    if (normalizedDecimal(token?.trustedPriceUSD)) {
        return multiplyUsdAmount(token?.balance, token.trustedPriceUSD)
    }
    const marketPriceAllowed =
        ['established', 'recognized'].includes(token?.recognitionStatus) &&
        token?.priceConfidence === 'market' &&
        normalizedDecimal(token?.marketPriceUSD) !== null &&
        token?.visibility !== 'hidden' &&
        token?.possibleSpam !== true &&
        !['high', 'blocked'].includes(token?.securityStatus)
    return marketPriceAllowed
        ? multiplyUsdAmount(token?.balance, token.marketPriceUSD)
        : null
}

export function formatWalletUsdValue(token) {
    const value = resolveWalletUsdValue(token)
    return value === null ? '—' : formatUsdDecimal(value)
}

async function fetchWalletTokensForChain({
    chainId,
    address,
    signal,
    apiBaseUrl,
}) {
    const url = new URL(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/wallet-tokens`,
    )
    url.searchParams.set('chainId', String(chainId))
    url.searchParams.set('address', address)

    const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
    })

    if (!response.ok) {
        throw new Error('Wallet balances could not be loaded.')
    }

    const payload = await response.json()
    if (
        payload.classificationVersion !== WALLET_TOKEN_CLASSIFICATION_VERSION ||
        !Array.isArray(payload.tokens) ||
        !payload.tokens.every((token) =>
            isCurrentWalletTokenRecord(token) &&
            Number(token.chainId) === chainId,
        )
    ) {
        throw new Error('Backend returned invalid wallet tokens')
    }
    return payload.tokens
}

function isChainIdArray(value) {
    return Array.isArray(value) && value.every((chainId) =>
        Number.isSafeInteger(chainId) && isTokenDiscoveryChainId(chainId),
    )
}

function isChainErrors(value) {
    return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.entries(value).every(([chainId, message]) =>
            /^[1-9]\d*$/.test(chainId) &&
            isTokenDiscoveryChainId(Number(chainId)) &&
            typeof message === 'string' &&
            message.length > 0 &&
            message.length <= 160,
        )
}

function validateAllChainWalletTokenResponse(payload, address) {
    if (
        payload === null ||
        typeof payload !== 'object' ||
        payload.classificationVersion !== WALLET_TOKEN_CLASSIFICATION_VERSION ||
        payload.address !== address.toLowerCase() ||
        (payload.source !== 'alchemy-portfolio' && payload.source !== 'legacy') ||
        !Array.isArray(payload.tokens) ||
        !payload.tokens.every((token) =>
            isCurrentWalletTokenRecord(token) &&
            isTokenDiscoveryChainId(Number(token.chainId)),
        ) ||
        !isChainIdArray(payload.queriedChainIds) ||
        !isChainIdArray(payload.successfulChainIds) ||
        !isChainIdArray(payload.failedChainIds) ||
        !isChainIdArray(payload.providerRejectedChainIds) ||
        !isChainIdArray(payload.unsupportedChainIds) ||
        !isChainErrors(payload.chainErrors) ||
        typeof payload.partial !== 'boolean' ||
        typeof payload.stale !== 'boolean'
    ) {
        throw new Error('Backend returned invalid wallet tokens')
    }

    const queried = new Set(payload.queriedChainIds)
    const successful = new Set(payload.successfulChainIds)
    const failed = new Set(payload.failedChainIds)
    const providerRejected = new Set(payload.providerRejectedChainIds)
    const unsupported = new Set(payload.unsupportedChainIds)
    const chainErrorIds = Object.keys(payload.chainErrors).map(Number)
    if (
        successful.size !== payload.successfulChainIds.length ||
        failed.size !== payload.failedChainIds.length ||
        providerRejected.size !== payload.providerRejectedChainIds.length ||
        queried.size !== payload.queriedChainIds.length ||
        unsupported.size !== payload.unsupportedChainIds.length ||
        payload.successfulChainIds.some((chainId) => !queried.has(chainId)) ||
        payload.failedChainIds.some((chainId) =>
            !queried.has(chainId) || successful.has(chainId),
        ) ||
        payload.unsupportedChainIds.some((chainId) =>
            queried.has(chainId) ||
            successful.has(chainId) ||
            failed.has(chainId) ||
            providerRejected.has(chainId),
        ) ||
        payload.providerRejectedChainIds.some((chainId) =>
            successful.has(chainId) || failed.has(chainId),
        ) ||
        chainErrorIds.some((chainId) =>
            !failed.has(chainId) && !providerRejected.has(chainId),
        ) ||
        [...payload.failedChainIds, ...payload.providerRejectedChainIds].some((chainId) =>
            !Object.hasOwn(payload.chainErrors, String(chainId)),
        ) ||
        payload.tokens.some((token) => !successful.has(Number(token.chainId)))
    ) {
        throw new Error('Backend returned invalid wallet tokens')
    }

    return {
        tokens: payload.tokens,
        queriedChainIds: payload.queriedChainIds,
        successfulChainIds: payload.successfulChainIds,
        failedChainIds: payload.failedChainIds,
        providerRejectedChainIds: payload.providerRejectedChainIds,
        unsupportedChainIds: payload.unsupportedChainIds,
        chainErrors: payload.chainErrors,
        partial: payload.partial,
        stale: payload.stale,
        source: payload.source,
    }
}

/**
 * Fetches and normalizes wallet-token balances/classification for one or all chains.
 * @param {object} input Endpoint, wallet address, chain scope, cache and abort options.
 * @returns {Promise<object>} Current records plus per-chain partial/stale diagnostics.
 * @sideEffects Performs backend HTTP and reads/writes wallet-token cache; never prompts the wallet.
 */
export async function fetchWalletTokens({
    chainId = 56,
    chainIds = TOKEN_DISCOVERY_CHAIN_IDS,
    address,
    signal,
    apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL ??
        'http://localhost:3001',
} = {}) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(address ?? ''))) {
        throw new Error('A valid wallet address is required')
    }

    clearLegacyWalletTokenCacheKeys(globalThis.localStorage)
    clearLegacyWalletTokenCacheKeys(globalThis.sessionStorage)

    if (String(chainId).trim().toLowerCase() !== 'all') {
        const numericChainId = Number(chainId)
        if (!Number.isSafeInteger(numericChainId) ||
            !isTokenDiscoveryChainId(numericChainId)) {
            throw new Error('A valid wallet-token chain is required')
        }
        return fetchWalletTokensForChain({
            chainId: numericChainId,
            address,
            signal,
            apiBaseUrl,
        })
    }

    const concreteChainIds = [...new Set(chainIds.map(Number))].filter(
        (value) => Number.isSafeInteger(value) && isTokenDiscoveryChainId(value),
    )
    if (concreteChainIds.length === 0) {
        throw new Error('At least one wallet-token chain is required')
    }

    const url = new URL(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/wallet-tokens`,
    )
    url.searchParams.set('chainId', 'all')
    url.searchParams.set('address', address)
    const requestKey = url.toString()
    let request = walletTokenRequests.get(requestKey)
    if (!request) {
        request = fetch(url, {
            cache: 'no-store',
            headers: { accept: 'application/json' },
        }).then(async (response) => {
            if (!response.ok) {
                throw new Error('Wallet balances could not be loaded.')
            }
            const payload = await response.json().catch(() => null)
            return validateAllChainWalletTokenResponse(payload, address)
        }).finally(() => {
            if (walletTokenRequests.get(requestKey) === request) {
                walletTokenRequests.delete(requestKey)
            }
        })
        walletTokenRequests.set(requestKey, request)
    }
    if (!signal) return request
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        request.then(resolve, reject).finally(() => {
            signal.removeEventListener('abort', abort)
        })
    })
}

export function mergeWalletBalances(
    catalogTokens,
    walletTokens,
) {
    const tokens = new Map()
    const key = (token) => {
        const identity = getCanonicalTokenIdentity(token)
        if (!identity) throw new Error('A valid token identity is required')
        return identity
    }

    for (const token of catalogTokens) {
        tokens.set(key(token), mergeCanonicalTokenRecords(tokens.get(key(token)), token))
    }
    const canonicalWalletTokens = new Map()
    for (const walletToken of walletTokens) {
        canonicalWalletTokens.set(
            key(walletToken),
            mergeCanonicalTokenRecords(canonicalWalletTokens.get(key(walletToken)), walletToken),
        )
    }
    for (const walletToken of canonicalWalletTokens.values()) {
        const existing = tokens.get(key(walletToken)) ?? {}
        const currentRecord = isCurrentWalletTokenRecord(walletToken)
        const recognitionStatus = currentRecord
            ? walletToken.recognitionStatus
            : 'unverified'
        const securityStatus = currentRecord
            ? walletToken.securityStatus
            : 'unknown'
        const spamStatus = currentRecord ? walletToken.spamStatus : 'unknown'
        const visibility = currentRecord ? walletToken.visibility : 'hidden'
        const walletBalance =
            walletToken.formattedBalance ?? walletToken.balance ?? null
        const walletHasFallbackMetadata =
            walletToken.verificationReasons?.includes('fallback-metadata') === true
        const metadata = walletHasFallbackMetadata && existing.name
            ? existing
            : walletToken
        const priceUSD = walletToken.priceUSD ?? null
        const catalogMarketPriceUSD =
            normalizedDecimal(existing.marketPriceUSD) !== null
                ? String(existing.marketPriceUSD)
                : normalizedDecimal(existing.priceUSD) !== null
                  ? String(existing.priceUSD)
                  : null
        const marketPriceUSD = currentRecord
            ? walletToken.marketPriceUSD ?? catalogMarketPriceUSD
            : null
        const trustedPriceUSD = currentRecord
            ? walletToken.trustedPriceUSD ?? null
            : null
        const valueUSD = currentRecord ? walletToken.valueUSD ?? null : null
        const logoCandidates = [
            ...(walletToken.logoCandidates ?? []),
            walletToken.logoURI,
            ...(existing.logoCandidates ?? []),
            existing.logoURI,
        ].filter(
            (value, index, values) =>
                typeof value === 'string' && values.indexOf(value) === index,
        )
        tokens.set(key(walletToken), {
            ...existing,
            ...walletToken,
            classificationVersion: currentRecord
                ? WALLET_TOKEN_CLASSIFICATION_VERSION
                : null,
            name: metadata.name ?? walletToken.name ?? existing.name,
            symbol: metadata.symbol ?? walletToken.symbol ?? existing.symbol,
            decimals: metadata.decimals ?? walletToken.decimals ?? existing.decimals,
            balance:
                walletBalance,
            formattedBalance: walletBalance,
            rawBalance: walletToken.rawBalance ?? existing.rawBalance,
            valueUSD,
            priceUSD,
            trustedPriceUSD,
            marketPriceUSD,
            priceConfidence: currentRecord
                ? walletToken.priceConfidence === 'unknown' &&
                  walletToken.marketPriceUSD == null &&
                  marketPriceUSD !== null
                    ? 'market'
                    : walletToken.priceConfidence
                : priceUSD === null
                  ? 'unknown'
                  : 'untrusted',
            recognitionStatus,
            recognitionReasons: currentRecord ? walletToken.recognitionReasons ?? [] : [],
            verificationStatus: recognitionStatus,
            verificationReasons: walletToken.verificationReasons ?? [],
            spamStatus,
            possibleSpam: currentRecord ? walletToken.possibleSpam : null,
            verifiedContract: currentRecord ? walletToken.verifiedContract : null,
            spamReasons: currentRecord ? walletToken.spamReasons ?? [] : [],
            securityStatus,
            securityReasons: currentRecord ? walletToken.securityReasons ?? [] : [],
            securityProviders: currentRecord ? walletToken.securityProviders : undefined,
            visibility,
            visibilityReasons: currentRecord
                ? walletToken.visibilityReasons ?? []
                : ['legacy-classification-rejected'],
            logoURI: logoCandidates[0] ?? null,
            iconUrl: logoCandidates[0] ?? null,
            logoCandidates,
        })
    }

    return [...tokens.values()]
}

export function resolveSelectedToken(selectedToken, availableTokens) {
    if (!selectedToken) return null
    const identity = getCanonicalTokenIdentity(selectedToken)
    if (!identity) return null
    const current = availableTokens.find(
        (token) => getCanonicalTokenIdentity(token) === identity,
    )
    if (!current) return selectedToken
    const currentWalletRecord = isCurrentWalletTokenRecord(current)
    return {
        ...selectedToken,
        ...current,
        balance: current.balance ?? selectedToken.balance,
        rawBalance: current.rawBalance ?? selectedToken.rawBalance,
        priceUSD: current.priceUSD ?? selectedToken.priceUSD ?? null,
        trustedPriceUSD: currentWalletRecord
            ? current.trustedPriceUSD ?? null
            : selectedToken.trustedPriceUSD ?? null,
        marketPriceUSD: currentWalletRecord
            ? current.marketPriceUSD ?? null
            : selectedToken.marketPriceUSD ?? null,
        valueUSD: currentWalletRecord
            ? current.valueUSD ?? null
            : selectedToken.valueUSD ?? null,
        priceConfidence: currentWalletRecord
            ? current.priceConfidence
            : selectedToken.priceConfidence ?? 'unknown',
        recognitionStatus: currentWalletRecord
            ? current.recognitionStatus
            : selectedToken.recognitionStatus ?? 'unverified',
        securityStatus: currentWalletRecord
            ? current.securityStatus
            : selectedToken.securityStatus ?? 'unknown',
        spamStatus: currentWalletRecord
            ? current.spamStatus
            : selectedToken.spamStatus ?? 'unknown',
        possibleSpam: currentWalletRecord
            ? current.possibleSpam
            : selectedToken.possibleSpam ?? null,
        verifiedContract: currentWalletRecord
            ? current.verifiedContract
            : selectedToken.verifiedContract ?? null,
        visibility: currentWalletRecord
            ? current.visibility
            : selectedToken.visibility ?? 'hidden',
    }
}
