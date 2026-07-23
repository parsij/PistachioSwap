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

const STRONG_RECOGNITION_REASONS = new Set([
    'native-token',
    'native-bnb',
    'curated-official-contract',
    'coingecko-exact-contract',
    'manual-allowlist',
    'pancakeswap-curated-list',
    'trustwallet-reviewed-asset',
])

const CORE_CURATED_REASONS = new Set([
    'native-token',
    'native-bnb',
    'curated-official-contract',
    'manual-allowlist',
    'pancakeswap-curated-list',
    'trustwallet-reviewed-asset',
])

/** Returns whether a wallet token has curated identity evidence suitable for primary UI. */
export function isPrimaryTrustedAsset(token) {
    if (!token) return false
    if (resolvePortfolioTier(token) === 'core') return true
    if (resolvePortfolioTier(token) === 'established') return true
    if (token.isNative === true || token.officialAsset === true) return true
    return Array.isArray(token.recognitionReasons) &&
        token.recognitionReasons.some((reason) =>
            STRONG_RECOGNITION_REASONS.has(reason))
}

/** Returns whether a wallet token may appear in normal primary wallet UI. */
export function isTrustedWalletToken(token) {
    if (!token || token.possibleSpam === true) return false
    if (['high', 'blocked'].includes(token.securityStatus)) return false
    if (token.visibility === 'hidden') return false
    return ['core', 'established'].includes(resolvePortfolioTier(token)) &&
        isPrimaryTrustedAsset(token)
}

export function resolvePortfolioTier(token) {
    if (['core', 'established', 'hidden', 'blocked'].includes(token?.classificationTier)) {
        return token.classificationTier
    }
    if (token?.securityStatus === 'blocked') return 'blocked'
    if (token?.visibility === 'hidden' || token?.visibility === 'unverified') return 'hidden'
    if (token?.visibility !== 'primary') return 'hidden'
    if (token?.isNative === true || token?.officialAsset === true) return 'core'
    if (Array.isArray(token?.recognitionReasons) &&
        token.recognitionReasons.some((reason) => CORE_CURATED_REASONS.has(reason))) {
        return 'core'
    }
    if (
        token?.includeInPortfolioValue === true &&
        token?.priceConfidence === 'trusted' &&
        ['established', 'recognized'].includes(token?.recognitionStatus)
    ) return 'established'
    return 'hidden'
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
    return partitionPortfolioAssets(tokens).primaryTokens.filter((token) => {
        if (!isPositiveWalletBalance(token)) return false
        if (hideUnknownTokens && !isTrustedWalletToken(token)) return false
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
    return partitionPortfolioAssets(tokens).hiddenTokens.filter(
        (token) => token.visibility === 'hidden' ||
            ['hidden', 'blocked'].includes(token.classificationTier),
    )
}

/** Returns non-hidden portfolio records lacking verified-token evidence. */
export function getUnverifiedPortfolioTokens(tokens) {
    return partitionPortfolioAssets(tokens).hiddenTokens.filter(
        (token) => token.visibility === 'unverified',
    )
}

/** Sorts a copy of wallet assets by trusted USD value and deterministic token fallback keys. */
export function sortWalletAssetsByValue(tokens) {
    const tierRank = { core: 0, established: 1, hidden: 2, blocked: 3 }
    return tokens.toSorted((left, right) => {
        const leftTier = resolvePortfolioTier(left)
        const rightTier = resolvePortfolioTier(right)
        if (leftTier !== rightTier) {
            return (tierRank[leftTier] ?? 4) -
                (tierRank[rightTier] ?? 4)
        }
        if (left.valueUSD == null && right.valueUSD == null) return 0
        if (left.valueUSD == null) return 1
        if (right.valueUSD == null) return -1
        return -(compareDecimalStrings(left.valueUSD, right.valueUSD) ?? 0) ||
            compareDecimalStrings(right.balance, left.balance) ||
            getAssetIdentity(left).localeCompare(getAssetIdentity(right))
    })
}

function tokenRiskRank(token) {
    if (resolvePortfolioTier(token) === 'blocked' ||
        token.securityStatus === 'blocked' ||
        token.securityStatus === 'high') return 0
    if (token.securityStatus === 'caution' || token.possibleSpam === true) return 1
    return 2
}

/** Partitions held wallet assets before rendering so hidden tokens never mix into primary UI. */
export function partitionPortfolioAssets(tokens) {
    const primaryTokens = []
    const hiddenTokens = []
    const blockedTokens = []

    for (const token of tokens) {
        if (!isPositiveWalletBalance(token)) continue
        const tier = resolvePortfolioTier(token)
        if (tier === 'blocked' ||
            token.securityStatus === 'blocked') {
            blockedTokens.push(token)
            hiddenTokens.push(token)
            continue
        }
        if (isTrustedWalletToken(token) &&
            token.visibility === 'primary') {
            primaryTokens.push(token)
        } else if (token.visibility === 'hidden' ||
            token.classificationTier === 'hidden' ||
            token.visibility === 'unverified') {
            hiddenTokens.push(token)
        }
    }

    return {
        primaryTokens: sortWalletAssetsByValue(primaryTokens),
        hiddenTokens: hiddenTokens.toSorted((left, right) =>
            tokenRiskRank(left) - tokenRiskRank(right) ||
            -(compareDecimalStrings(
                left.marketPriceUSD ?? left.priceUSD ?? left.balance ?? '0',
                right.marketPriceUSD ?? right.priceUSD ?? right.balance ?? '0',
            ) ?? 0) ||
            getAssetIdentity(left).localeCompare(getAssetIdentity(right)),
        ),
        blockedTokens,
    }
}
