function parseDecimal(value) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim())
    if (!match) return null
    return {
        digits: BigInt(`${match[1]}${match[2] ?? ''}`),
        scale: (match[2] ?? '').length,
    }
}

/** Compares non-negative decimal strings without floating-point precision loss. */
export function compareDecimalStrings(leftValue, rightValue) {
    const left = parseDecimal(leftValue)
    const right = parseDecimal(rightValue)
    if (!left || !right) return null
    const scale = Math.max(left.scale, right.scale)
    const leftUnits = left.digits * 10n ** BigInt(scale - left.scale)
    const rightUnits = right.digits * 10n ** BigInt(scale - right.scale)
    return leftUnits === rightUnits ? 0 : leftUnits < rightUnits ? -1 : 1
}

/** Returns the exact chain/address identity key used for wallet asset deduplication. */
export function getAssetIdentity(token) {
    return `${Number(token?.chainId)}:${String(token?.address ?? '').toLowerCase()}`
}

/** Returns whether a wallet-token record has a strictly positive raw balance. */
export function isPositiveWalletBalance(token) {
    const parsed = parseDecimal(token?.balance ?? token?.formattedBalance)
    return parsed !== null && parsed.digits > 0n
}

/** Filters portfolio records according to visibility settings without mutating source data. */
export function filterPortfolioTokens(
    tokens,
    {
        hideSmallBalances = false,
        hideUnknownTokens = true,
        selectedTokens = [],
    } = {},
) {
    const selected = new Set(selectedTokens.filter(Boolean).map(getAssetIdentity))
    return tokens.filter((token) => {
        if (!isPositiveWalletBalance(token)) return false
        if (token.visibility !== 'primary') return false
        const isSelected = selected.has(getAssetIdentity(token))

        if (
            hideSmallBalances &&
            hideUnknownTokens &&
            token.valueUSD !== null &&
            token.valueUSD !== undefined &&
            compareDecimalStrings(token.valueUSD, '0.20') === -1 &&
            !isSelected
        ) return false

        return true
    })
}

/** Returns portfolio records classified as hidden by backend/source metadata. */
export function getHiddenPortfolioTokens(tokens) {
    return tokens.filter((token) => {
        if (!(isPositiveWalletBalance(token) && token.visibility === 'hidden')) {
            return false
        }
        return true
    })
}

/** Returns non-hidden portfolio records lacking verified-token evidence. */
export function getUnverifiedPortfolioTokens(tokens) {
    return tokens.filter((token) => {
        if (!isPositiveWalletBalance(token)) return false
        if (token.visibility !== 'unverified') return false
        return true
    })
}

/** Sorts a copy of wallet assets by trusted USD value and deterministic token fallback keys. */
export function sortWalletAssetsByValue(tokens) {
    const visibilityRank = { primary: 0, unverified: 1, hidden: 2 }
    return tokens.toSorted((left, right) => {
        if (left.visibility !== right.visibility) {
            return (visibilityRank[left.visibility] ?? 3) -
                (visibilityRank[right.visibility] ?? 3)
        }
        if (left.valueUSD == null && right.valueUSD == null) return 0
        if (left.valueUSD == null) return 1
        if (right.valueUSD == null) return -1
        return -(compareDecimalStrings(left.valueUSD, right.valueUSD) ?? 0)
    })
}
