/**
 * Builds the chain-and-address identity used to prevent token alias collisions.
 * @param {object|null} token Token-like value.
 * @param {number|string} [fallbackChainId] Chain used when the token omits one.
 * @returns {string} Stable identity or `empty`.
 * @security Contract identity remains exact-address based; symbols are fallback display identity only.
 */
export function getTokenIdentity(token, fallbackChainId = 0) {
    if (!token) return 'empty'
    const chainId = Number(token.chainId ?? fallbackChainId)
    const address = String(token.address ?? '').trim().toLowerCase()
    return `${chainId}:${address || token.id || token.symbol}`
}

/**
 * Normalizes backend, configured, or wallet token data into the UI token shape.
 * @param {object} token Source token.
 * @param {number|string} fallbackChainId Chain used when absent.
 * @param {string|null} fallbackChainLogo Chain logo fallback.
 * @returns {object} Normalized token without mutating the input.
 * @sideEffects None.
 */
export function normalizeMarketToken(token, fallbackChainId, fallbackChainLogo) {
    const chainId = Number(token.chainId ?? fallbackChainId)
    const address = String(token.address ?? '').trim()
    const logoCandidates = [
        ...(Array.isArray(token.logoCandidates) ? token.logoCandidates : []),
        token.logoURI,
        token.iconUrl,
    ].filter((value, index, values) =>
        typeof value === 'string' && value.length > 0 && values.indexOf(value) === index)

    return {
        ...token,
        id: getTokenIdentity({ ...token, chainId, address }, fallbackChainId),
        chainId,
        address,
        name: token.name ?? token.symbol ?? 'Unknown token',
        symbol: token.symbol ?? 'UNKNOWN',
        decimals: Number(token.decimals ?? 18),
        iconUrl: logoCandidates[0] ?? null,
        logoURI: logoCandidates[0] ?? null,
        logoCandidates,
        logoSource: token.logoSource ?? (logoCandidates.length > 0 ? 'local' : 'fallback'),
        chainLogoURI: token.chainLogoURI ?? token.networkLogoURI ?? fallbackChainLogo ?? null,
        balance: token.balance == null ? null : String(token.balance),
        priceUSD: token.priceUSD ?? null,
    }
}
