import Fuse from 'fuse.js'

import {
    TOKEN_DISCOVERY_CHAINS,
} from '../../../web3/curatedEvmChains.js'

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/
const MAX_CHAIN_QUALIFIER_WORDS = 5

/*
 * Fuse handles the actual matching for every enabled network. This table is
 * intentionally limited to genuine alternate names/acronyms that cannot be
 * inferred from the chain registry itself.
 */
const SEMANTIC_CHAIN_ALIASES = Object.freeze({
    1: Object.freeze(['eth', 'ethereum mainnet']),
    10: Object.freeze(['op', 'optimism']),
    56: Object.freeze(['bnb', 'bsc', 'binance chain', 'binance smart chain']),
    100: Object.freeze(['gnosis', 'xdai']),
    137: Object.freeze(['pol', 'matic', 'polygon', 'polygon network', 'polygon pos']),
    204: Object.freeze(['op bnb']),
    324: Object.freeze(['zk sync', 'zk sync era', 'zksync']),
    42161: Object.freeze(['arb', 'arbitrum']),
    43114: Object.freeze(['avax', 'avalanche']),
})

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

function compactTickerFragments(value) {
    const normalized = normalizeSearchText(value)
    const parts = normalized.split(' ')
    if (parts.length < 2 || parts.join('').length > 12) return normalized
    if (!parts.every((part) => /^[a-z0-9]+$/.test(part) && part.length <= 3)) {
        return normalized
    }
    return parts.join('')
}

function inferredChainAliases(chain) {
    const normalizedName = normalizeChainPhrase(chain.name)
    const simplifiedName = normalizedName
        .replace(/\b(mainnet|network)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const withoutChainSuffix = simplifiedName
        .replace(/\bchain\b$/g, '')
        .trim()

    return [
        normalizedName,
        simplifiedName,
        withoutChainSuffix,
        String(chain.id),
        chain.nativeCurrency?.name,
        chain.nativeCurrency?.symbol,
        ...(SEMANTIC_CHAIN_ALIASES[chain.id] ?? []),
    ].map(normalizeChainPhrase).filter(Boolean)
}

const CHAIN_SEARCH_DOCUMENTS = Object.freeze(TOKEN_DISCOVERY_CHAINS.map((chain) => ({
    chainId: Number(chain.id),
    name: normalizeChainPhrase(chain.name),
    aliases: [...new Set(inferredChainAliases(chain))],
})))

const EXACT_CHAIN_ALIASES = new Map()
for (const document of CHAIN_SEARCH_DOCUMENTS) {
    for (const alias of document.aliases) {
        const owners = EXACT_CHAIN_ALIASES.get(alias) ?? new Set()
        owners.add(document.chainId)
        EXACT_CHAIN_ALIASES.set(alias, owners)
    }
}

/* ETH and BNB are native symbols on multiple enabled networks. For a network
 * qualifier, humans conventionally mean Ethereum and BNB Chain respectively.
 */
EXACT_CHAIN_ALIASES.set('eth', new Set([1]))
EXACT_CHAIN_ALIASES.set('bnb', new Set([56]))

const CHAIN_FUSE = new Fuse(CHAIN_SEARCH_DOCUMENTS, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.27,
    minMatchCharLength: 3,
    useTokenSearch: true,
    tokenMatch: 'all',
    keys: [
        { name: 'name', weight: 1 },
        { name: 'aliases', weight: 1 },
    ],
})

function resolveChainPhrase(value) {
    const phrase = normalizeChainPhrase(value)
    if (!phrase) return null

    const exactOwners = EXACT_CHAIN_ALIASES.get(phrase)
    if (exactOwners?.size === 1) {
        return {
            chainId: [...exactOwners][0],
            chainAlias: phrase,
            score: 0,
        }
    }

    /* Short fuzzy aliases are too collision-prone for wallet search. Exact
     * acronyms such as OP, ARB, BSC, and AVAX are already covered above.
     */
    if (phrase.length < 4) return null

    const [best, second] = CHAIN_FUSE.search(phrase, { limit: 2 })
    if (!best || Number(best.score ?? 1) > 0.27) return null
    if (
        second &&
        Number(second.score ?? 1) - Number(best.score ?? 1) < 0.06 &&
        second.item.chainId !== best.item.chainId
    ) {
        return null
    }

    return {
        chainId: best.item.chainId,
        chainAlias: phrase,
        score: Number(best.score ?? 0),
    }
}

function chainQualifierCandidates(query) {
    const words = normalizeChainPhrase(query).split(' ').filter(Boolean)
    if (words.length < 2) return []

    const candidates = []
    const maxWords = Math.min(MAX_CHAIN_QUALIFIER_WORDS, words.length - 1)
    for (let length = maxWords; length >= 1; length -= 1) {
        const suffixStart = words.length - length
        const suffixPhrase = words.slice(suffixStart).join(' ')
        const suffixMatch = resolveChainPhrase(suffixPhrase)
        if (suffixMatch) {
            candidates.push({
                ...suffixMatch,
                position: 'suffix',
                phraseWords: length,
                tokenQuery: compactTickerFragments(words.slice(0, suffixStart).join(' ')),
            })
        }

        const prefixPhrase = words.slice(0, length).join(' ')
        const prefixMatch = resolveChainPhrase(prefixPhrase)
        if (prefixMatch) {
            candidates.push({
                ...prefixMatch,
                position: 'prefix',
                phraseWords: length,
                tokenQuery: compactTickerFragments(words.slice(length).join(' ')),
            })
        }
    }

    return candidates.filter((candidate) => candidate.tokenQuery)
}

function findCompoundChainQualifier(query) {
    const candidates = chainQualifierCandidates(query)
    if (!candidates.length) return null

    candidates.sort((left, right) =>
        right.phraseWords - left.phraseWords ||
        left.score - right.score ||
        Number(left.position === 'suffix') - Number(right.position === 'suffix'))

    return candidates[0]
}

/**
 * Interprets wallet-style token searches. Network matching is generated from
 * the complete enabled-chain registry and delegated to Fuse.js, so adding a
 * supported chain does not require another hand-written parser branch.
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
        query: compactTickerFragments(originalQuery),
        originalQuery,
        chainAlias: null,
        chainQualified: false,
    }
}
