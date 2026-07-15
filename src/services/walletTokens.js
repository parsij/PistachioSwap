import { multiplyUsdAmount } from './fiatValue.js'

export const WALLET_TOKEN_CLASSIFICATION_VERSION = 3
export const WALLET_TOKEN_CACHE_NAMESPACE = 'pistachioswap:wallet-tokens:v3:'
const LEGACY_WALLET_TOKEN_CACHE_NAMESPACES = [
    'pistachioswap:wallet-tokens:v1:',
    'pistachioswap:wallet-tokens:v2:',
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

export function formatWalletUsdValue(token) {
    const value = normalizedDecimal(token?.valueUSD)
        ? String(token.valueUSD)
        : token?.priceConfidence === 'trusted' && normalizedDecimal(token?.trustedPriceUSD)
          ? multiplyUsdAmount(token?.balance, token.trustedPriceUSD)
          : null
    return value === null ? '—' : formatUsdDecimal(value)
}

export async function fetchWalletTokens({
    chainId = 56,
    address,
    signal,
    apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL ??
        'http://localhost:3001',
} = {}) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(address ?? ''))) {
        throw new Error('A valid wallet address is required')
    }

    const url = new URL(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/wallet-tokens`,
    )
    url.searchParams.set('chainId', String(chainId))
    url.searchParams.set('address', address)
    url.searchParams.set('classificationVersion', String(WALLET_TOKEN_CLASSIFICATION_VERSION))

    clearLegacyWalletTokenCacheKeys(globalThis.localStorage)
    clearLegacyWalletTokenCacheKeys(globalThis.sessionStorage)

    const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
    })

    if (!response.ok) {
        throw new Error(
            `Wallet-token request failed with ${response.status}`,
        )
    }

    const payload = await response.json()
    if (
        payload.classificationVersion !== WALLET_TOKEN_CLASSIFICATION_VERSION ||
        !Array.isArray(payload.tokens) ||
        !payload.tokens.every(isCurrentWalletTokenRecord)
    ) {
        throw new Error('Backend returned invalid wallet tokens')
    }
    return payload.tokens
}

export function mergeWalletBalances(
    catalogTokens,
    walletTokens,
) {
    const tokens = new Map()
    const key = (token) =>
        `${Number(token.chainId)}:${String(token.address).toLowerCase()}`

    for (const token of catalogTokens) tokens.set(key(token), token)
    for (const walletToken of walletTokens) {
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
            marketPriceUSD: currentRecord ? walletToken.marketPriceUSD ?? null : null,
            priceConfidence: currentRecord
                ? walletToken.priceConfidence
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
    const identity = `${Number(selectedToken.chainId)}:${String(selectedToken.address).toLowerCase()}`
    const current = availableTokens.find(
        (token) =>
            `${Number(token.chainId)}:${String(token.address).toLowerCase()}` === identity,
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
