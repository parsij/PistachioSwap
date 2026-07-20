import { auditMarketCatalogPayload } from '../src/diagnostics/market-catalog-audit.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

const argumentIndex = process.argv.indexOf('--base-url')
const rawBaseUrl = argumentIndex >= 0
    ? process.argv[argumentIndex + 1]
    : 'http://127.0.0.1:3001'
const baseUrl = new URL(rawBaseUrl)
const local = ['127.0.0.1', 'localhost'].includes(baseUrl.hostname)
if (baseUrl.username || baseUrl.password ||
    (baseUrl.protocol !== 'https:' && !(local && baseUrl.protocol === 'http:'))) {
    throw new Error('The audit base URL is not allowed.')
}
async function request(path: string) {
    const response = await fetch(new URL(path, baseUrl), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Market catalog audit failed with HTTP ${response.status}.`)
    return response.json()
}

const payload = await request('/v1/market-tokens?chainId=all&limit=2400')
if (typeof payload !== 'object' || payload === null) {
    throw new Error('Market catalog audit received an invalid response.')
}
const combined = payload as Record<string, unknown>
const tokens = Array.isArray(combined.tokens) ? [...combined.tokens] : []
const commonTokens = Array.isArray(combined.commonTokens) ? [...combined.commonTokens] : []
const rankedChainIds = new Set(tokens.flatMap((token) =>
    typeof token === 'object' && token !== null && 'chainId' in token
        ? [Number(token.chainId)]
        : [],
))
for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
    if (rankedChainIds.has(chain.chainId)) continue
    await request(`/v1/market-tokens?chainId=${chain.chainId}&limit=100`)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const chainPayload = await request(`/v1/market-tokens?chainId=${chain.chainId}&limit=100`)
    if (typeof chainPayload !== 'object' || chainPayload === null) continue
    const record = chainPayload as Record<string, unknown>
    if (Array.isArray(record.tokens)) tokens.push(...record.tokens)
    if (Array.isArray(record.commonTokens)) {
        commonTokens.push(...record.commonTokens)
    }
}
const dedupe = (values: unknown[]) => [...new Map(values.flatMap((token) =>
    typeof token === 'object' && token !== null && 'canonicalId' in token &&
    typeof token.canonicalId === 'string'
        ? [[token.canonicalId, token] as const]
        : [],
)).values()]
const dedupedCommonTokens = dedupe(commonTokens)
const auditPayload = {
    ...combined,
    tokens: dedupe(tokens),
    commonTokens: dedupedCommonTokens,
    commonCount: dedupedCommonTokens.length,
}
const results = auditMarketCatalogPayload(auditPayload)
for (const result of results) console.log(JSON.stringify(result))
console.log(JSON.stringify({
    operation: 'market-catalog-audit-summary',
    chainsAudited: results.length,
    totals: results.reduce((totals, result) => ({
        missingRequiredClassificationFields: totals.missingRequiredClassificationFields + result.missingRequiredClassificationFields,
        fallbackOnlyLogos: totals.fallbackOnlyLogos + result.fallbackOnlyLogos,
        majorCuratedTokensMissingTrustedLogos: totals.majorCuratedTokensMissingTrustedLogos + result.majorCuratedTokensMissingTrustedLogos,
        duplicateCanonicalIdentitiesAcrossSections: totals.duplicateCanonicalIdentitiesAcrossSections + result.duplicateCanonicalIdentitiesAcrossSections,
    }), {
        missingRequiredClassificationFields: 0,
        fallbackOnlyLogos: 0,
        majorCuratedTokensMissingTrustedLogos: 0,
        duplicateCanonicalIdentitiesAcrossSections: 0,
    }),
}))
