import { zeroAddress } from 'viem'

function positiveFiniteDecimal(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? value : null
}

function isCanonicalNativeToken(token) {
    return token?.isNative === true &&
        String(token?.address ?? '').toLowerCase() === zeroAddress
}

/** Returns a positive trusted USD price or null when provider evidence is incomplete. */
export function getTrustedTokenPrice(token) {
    if (!token || ['market', 'untrusted'].includes(token.priceConfidence)) {
        return null
    }
    return positiveFiniteDecimal(token.trustedPriceUSD ?? token.priceUSD)
}

/** Returns the displayable USD price while preserving the existing trust/fallback policy. */
export function getDisplayTokenPrice(token) {
    if (!token) return null

    const recognitionStatus = token.recognitionStatus ?? token.verificationStatus
    const recognized = ['established', 'recognized'].includes(recognitionStatus) ||
        isCanonicalNativeToken(token)
    const safe = token.possibleSpam !== true &&
        token.visibility !== 'hidden' &&
        !['blocked', 'high'].includes(token.securityStatus)

    if (!recognized || !safe) return null

    return positiveFiniteDecimal(token.trustedPriceUSD) ??
        positiveFiniteDecimal(token.marketPriceUSD) ??
        positiveFiniteDecimal(token.priceUSD)
}
