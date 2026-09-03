import {
    TOKEN_DISCOVERY_CHAINS,
} from '../../../web3/curatedEvmChains.js'

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/
const MAX_PREFIX_SYMBOL_LENGTH = 6

const EXTRA_CHAIN_ALIASES = Object.freeze({
    1: Object.freeze(['eth', 'ethereum mainnet']),
    10: Object.freeze(['op', 'optimism']),
    56: Object.freeze([
        'bnb',
        'bsc',
        'bnb chain',
        'binance chain',
        'binance smart chain',
    ]),
    100: Object.freeze(['gnosis', 'xdai']),
    137: Object.freeze([
        'pol',
        'matic',
        'matic network',
        'polygon network',
        'polygon pos',
    ]),
    204: Object.freeze(['op bnb']),
    324: Object.freeze(['zk sync', 'zk sync era', 'zksync']),
    8453: Object.freeze(['base mainnet']),
    42161: Object.freeze(['arb', 'arbitrum']),
    43114: Object.freeze(['avax', 'avalanche c chain']),
})

/*
 * Some short native symbols are shared by many chains (most notably ETH and
 * BNB). When a user qualifies another token with one of these, use the
 * conventional network meaning rather than letting an arbitrary chain win an
 * alias tie. More specific names such as "opbnb" still resolve independently.
 */
const PREFERRED_AMBIGUOUS_CHAIN_ALIASES = Object.freeze({
    eth: 1,
    bnb: 56,
})

/*
 * These are intentionally narrower than the compound-query aliases. A lone
 * "arbitrum" should still be allowed to find ARB, and a lone "optimism" OP.
 * Polygon/MATIC is the important exception because the native token was
 * renamed to POL, so literal token search otherwise misses what users mean.
 */
const EXACT_NATIVE_QUERY_REWRITES = Object.freeze({
    matic: Object.freeze({ chainId: 137, query: 'pol' }),
    'matic network': Object.freeze({ chainId: 137, query: 'pol' }),
    'matic token': Object.freeze({ chainId: 137, query: 'pol' }),
    polygon: Object.freeze({ chainId: 137, query: 'pol' }),
    'polygon ecosystem token': Object.freeze({ chainId: 137, query: 'pol' }),
    'polygon network': Object.freeze({ chainId: 137, query: 'pol' }),
    'polygon pos': Object.freeze({ chainId: 137, query: 'pol' }),
    'polygon token': Object.freeze({ chainId: 137, query: 'pol' }),
})

function normalizeSearchText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
}

function normalizeChainPhrase(value) {
    return normalizeSearchText(value)
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ')
}

function normalizeScope(value) {
    if (String(value).trim().toLowerCase() === 'all') return 'all'
    const chainId = Number(value)
    return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : value
}

function buildChainAliasEntries() {
    const owners = new Map()

    for (const chain of TOKEN_DISCOVERY_CHAINS) {
        const aliases = new Set([
            chain.name,
            chain.nativeCurrency?.symbol,
            ...(EXTRA_CHAIN_ALIASES[chain.id] ?? []),
        ].map(normalizeChainPhrase).filter(Boolean))

        for (const alias of aliases) {
            const chainIds = owners.get(alias) ?? new Set()
            chainIds.add(Number(chain.id))
            owners.set(alias, chainIds)
        }
    }

    for (const [alias, chainId] of Object.entries(PREFERRED_AMBIGUOUS_CHAIN_ALIASES)) {
        owners.set(alias, new Set([chainId]))
    }

    return [...owners.entries()]
        .flatMap(([alias, chainIds]) =>
            chainIds.size === 1
                ? [{ alias, chainId: [...chainIds][0] }]
                : [])
        .sort((left, right) => {
            const leftWords = left.alias.split(' ').length
            const rightWords = right.alias.split(' ').length
            return rightWords - leftWords ||
                right.alias.length - left.alias.length ||
                left.chainId - right.chainId
        })
}

const CHAIN_ALIAS_ENTRIES = Object.freeze(buildChainAliasEntries())

function findPhraseIndex(words, phraseWords) {
    if (phraseWords.length > words.length) return -1
    for (let index = 0; index <= words.length - phraseWords.length; index += 1) {
        if (phraseWords.every((word, offset) => words[index + offset] === word)) {
            return index
        }
    }
    return -1
}

function compactTickerFragments(value) {
    const normalized = normalizeSearchText(value)
    const parts = normalized.split(' ')
    if (parts.length < 2 || parts.join('').length > 12) return normalized
    if (!parts.every((part) => /^[a-z0-9]+$/.test(part) && part.length <= 3)) {
        return normalized
    }
    return parts.join('')
}

function looksLikeShortTokenSymbol(value) {
    const normalized = normalizeSearchText(value)
    if (!normalized || normalized.includes(' ')) return false
    const withoutPunctuation = normalized.replace(/[.$-]/g, '')
    return withoutPunctuation.length > 0 &&
        withoutPunctuation.length <= MAX_PREFIX_SYMBOL_LENGTH &&
        /^[a-z0-9]+$/.test(withoutPunctuation)
}

function findCompoundChainQualifier(query) {
    const words = normalizeChainPhrase(query).split(' ').filter(Boolean)
    if (words.length < 2) return null

    for (const entry of CHAIN_ALIAS_ENTRIES) {
        const aliasWords = entry.alias.split(' ')
        const index = findPhraseIndex(words, aliasWords)
        if (index < 0) continue

        const end = index + aliasWords.length
        const atStart = index === 0
        const atEnd = end === words.length
        if (!atStart && !atEnd) continue

        const remainderWords = [
            ...words.slice(0, index),
            ...words.slice(end),
        ]
        if (remainderWords.length === 0) continue

        const remainder = remainderWords.join(' ')
        const compactRemainder = compactTickerFragments(remainder)

        /*
         * Suffix network qualifiers are unambiguous ("usd coin polygon").
         * Prefix qualifiers are accepted for ticker-like queries
         * ("polygon usdc") but not arbitrary phrases such as "base protocol",
         * which may simply be a token name.
         */
        if (
            atStart &&
            !atEnd &&
            compactRemainder === remainder &&
            !looksLikeShortTokenSymbol(remainder)
        ) {
            continue
        }

        return {
            chainId: entry.chainId,
            chainAlias: entry.alias,
            tokenQuery: compactRemainder,
        }
    }

    return null
}

/**
 * Interprets wallet-style searches such as "USDC Polygon" without changing
 * the user's selected network when it is already explicit.
 */
export function interpretTokenSearchQuery({
    chainId = 'all',
    query = '',
} = {}) {
    const requestedChainId = normalizeScope(chainId)
    const originalQuery = normalizeSearchText(query)
    if (!originalQuery || EVM_ADDRESS_PATTERN.test(originalQuery)) {
        return {
            chainId: requestedChainId,
            query: originalQuery,
            originalQuery,
            chainAlias: null,
            chainQualified: false,
        }
    }

    const exactRewrite = EXACT_NATIVE_QUERY_REWRITES[
        normalizeChainPhrase(originalQuery)
    ]
    if (
        exactRewrite &&
        (requestedChainId === 'all' || requestedChainId === exactRewrite.chainId)
    ) {
        return {
            chainId: exactRewrite.chainId,
            query: exactRewrite.query,
            originalQuery,
            chainAlias: normalizeChainPhrase(originalQuery),
            chainQualified: true,
        }
    }

    const compound = findCompoundChainQualifier(originalQuery)
    if (
        compound &&
        (requestedChainId === 'all' || requestedChainId === compound.chainId)
    ) {
        return {
            chainId: compound.chainId,
            query: compound.tokenQuery,
            originalQuery,
            chainAlias: compound.chainAlias,
            chainQualified: true,
        }
    }

    return {
        chainId: requestedChainId,
        query: originalQuery,
        originalQuery,
        chainAlias: null,
        chainQualified: false,
    }
}
