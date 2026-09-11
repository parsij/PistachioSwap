import {
    BNB_CHAIN_LOGO_URI,
    CANONICAL_NATIVE_TOKEN_ADDRESS,
} from '../../../web3/curatedEvmChains.js'
import { getTokenDisplaySymbol } from '../services/tokenDisplay.js'

const TOKEN_METADATA_STORAGE_PREFIXES = Object.freeze([
    'pistachioswap:market-tokens:v7:',
    'pistachio-token-catalog-v5:featured:',
    'pistachio-token-catalog-v5:browse:',
    'pistachioswap:recent-token-searches:v6:',
    'pistachioswap:wallet-tokens:v6:',
])
const storedLogoCandidates = new Map()

const CANONICAL_TOKEN_LOGOS = Object.freeze({
    '10:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': '/icons/usdt.svg',
})

function normalizeAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function tokenIdentity(token) {
    const chainId = Number(token?.chainId)
    const address = normalizeAddress(token?.address)
    return Number.isSafeInteger(chainId) && chainId > 0 && address
        ? `${chainId}:${address}`
        : null
}

function dedupeLogoCandidates(values) {
    const seen = new Set()
    return values.filter((value) => {
        if (typeof value !== 'string') return false
        const normalized = value.trim()
        if (!normalized || seen.has(normalized)) return false
        seen.add(normalized)
        return true
    }).map((value) => value.trim())
}

function logoCandidatesFromToken(token) {
    return dedupeLogoCandidates([
        ...(Array.isArray(token?.logoCandidates)
            ? token.logoCandidates
            : []),
        token?.logoURI,
        token?.logoUri,
        token?.iconUrl,
    ])
}

function storedTokenRecords(value, depth = 0) {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object' || depth > 2) return []
    const direct = [
        value.tokens,
        value.featuredTokens,
        value.browseTokens,
        value.commonTokens,
        value.fallbackTokens,
    ].flatMap((records) => Array.isArray(records) ? records : [])
    return [
        ...direct,
        ...storedTokenRecords(value.payload, depth + 1),
        ...storedTokenRecords(value.data, depth + 1),
    ]
}

function getStoredLogoCandidates(token) {
    const identity = tokenIdentity(token)
    if (!identity) return []
    if (storedLogoCandidates.has(identity)) {
        return storedLogoCandidates.get(identity)
    }

    let storage
    try {
        storage = globalThis.localStorage ?? null
    } catch {
        return []
    }
    if (!storage) return []

    const matches = []
    try {
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index)
            if (!key || !TOKEN_METADATA_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
                continue
            }
            let payload
            try {
                payload = JSON.parse(storage.getItem(key) ?? 'null')
            } catch {
                continue
            }
            for (const candidate of storedTokenRecords(payload)) {
                if (tokenIdentity(candidate) !== identity) continue
                matches.push(...logoCandidatesFromToken(candidate))
            }
        }
    } catch {
        return []
    }

    const candidates = dedupeLogoCandidates(matches)
    if (candidates.length > 0) storedLogoCandidates.set(identity, candidates)
    return candidates
}

function isNativeBnb(token) {
    if (Number(token?.chainId) !== 56) return false
    return token?.isNative === true ||
        normalizeAddress(token?.address) === CANONICAL_NATIVE_TOKEN_ADDRESS
}

/**
 * Returns ordered token artwork candidates. Sparse activity records reuse the
 * same browser token-catalog metadata already loaded by the selector, so old
 * zero-balance transactions do not fall back to a letter just because the
 * wallet no longer holds that asset.
 */
export function getTokenLogoCandidates(token) {
    // BNB has one canonical yellow mark throughout PistachioSwap.
    if (isNativeBnb(token)) return [BNB_CHAIN_LOGO_URI]

    const identity = tokenIdentity(token)
    const canonicalLogo = identity ? CANONICAL_TOKEN_LOGOS[identity] : null

    return dedupeLogoCandidates([
        canonicalLogo,
        ...logoCandidatesFromToken(token),
        ...getStoredLogoCandidates(token),
    ])
}

/** Returns the single visible fallback character used when all token logos fail. */
export function getTokenFallbackLetter(token) {
    return getTokenDisplaySymbol(token)
        .slice(0, 1)
        .toUpperCase()
}
