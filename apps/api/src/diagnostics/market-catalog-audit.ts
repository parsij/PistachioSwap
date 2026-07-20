import { normalizeAddress } from '../lib/address.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS, canonicalTokenAddress } from '../token-discovery/registry.js'

type AuditToken = Record<string, unknown>

const TRUSTED_REASONS = new Set([
    'coingecko-exact-contract', 'curated-official-contract',
    'curated-token-allowlist', 'trusted-asset-exact-contract',
    'provider-verified-contract', 'explicit-native-allowlist',
])

function identity(token: AuditToken) {
    const chainId = Number(token.chainId)
    const address = normalizeAddress(token.address)
    return address ? `${chainId}:${canonicalTokenAddress(chainId, address)}` : null
}

function fallbackOnly(token: AuditToken) {
    const candidates = Array.isArray(token.logoCandidates) ? token.logoCandidates : []
    return candidates.length === 0 || candidates.every((value) =>
        value === '/icons/token-fallback.svg')
}

export function auditMarketCatalogPayload(payload: Record<string, unknown>) {
    const ranked = Array.isArray(payload.tokens) ? payload.tokens.filter(
        (token): token is AuditToken => typeof token === 'object' && token !== null,
    ) : []
    const common = Array.isArray(payload.commonTokens) ? payload.commonTokens.filter(
        (token): token is AuditToken => typeof token === 'object' && token !== null,
    ) : []
    return ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => {
        const chainRanked = ranked.filter((token) => Number(token.chainId) === chain.chainId)
        const chainCommon = common.filter((token) => Number(token.chainId) === chain.chainId)
        const rankedIds = new Set(chainRanked.map(identity).filter(Boolean))
        const commonIds = chainCommon.map(identity).filter(Boolean)
        const duplicateCommonIds = commonIds.filter((id, index) =>
            commonIds.indexOf(id) !== index)
        const missingClassification = chainRanked.filter((token) =>
            !token.canonicalId || token.catalogSection !== 'volume' ||
            !['recognized', 'established'].includes(String(token.recognitionStatus)) ||
            token.verifiedContract !== true || token.possibleSpam !== false ||
            !Array.isArray(token.recognitionReasons) || !token.spamStatus ||
            !token.securityStatus || !token.visibility || !token.marketSource,
        ).length
        return {
            chainId: chain.chainId,
            totalRankedTokens: chainRanked.length,
            totalCommonTokens: chainCommon.length,
            missingRequiredClassificationFields: missingClassification,
            fallbackOnlyLogos: [...chainRanked, ...chainCommon].filter(fallbackOnly).length,
            majorCuratedTokensMissingTrustedLogos: chainCommon.filter((token) =>
                token.officialAsset === true && fallbackOnly(token)).length,
            duplicateCanonicalIdentitiesAcrossSections: commonIds.filter((id) =>
                rankedIds.has(id)).length + duplicateCommonIds.length,
            invalidAddresses: [...chainRanked, ...chainCommon].filter((token) =>
                identity(token) === null).length,
            missingDecimals: [...chainRanked, ...chainCommon].filter((token) =>
                !Number.isInteger(Number(token.decimals))).length,
            commonCountMismatch: payload.commonCount !== common.length,
            rankedTokensWithoutVolumeOrLiquidity: chainRanked.filter((token) =>
                !(Number(token.volume24hUsd) > 0) || !(Number(token.liquidityUsd) > 0)).length,
            rankedTokensWithoutExactTrustedRecognition: chainRanked.filter((token) =>
                !Array.isArray(token.recognitionReasons) ||
                !token.recognitionReasons.some((reason) => TRUSTED_REASONS.has(String(reason)))).length,
        }
    })
}
