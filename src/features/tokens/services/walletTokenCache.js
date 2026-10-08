import { formatUnits } from 'viem'

import { apiBaseUrl as defaultApiBaseUrl } from '../../../lib/apiBaseUrl.js'
import {
    isCurrentWalletTokenRecord,
    WALLET_TOKEN_CACHE_NAMESPACE,
    WALLET_TOKEN_CLASSIFICATION_VERSION,
} from './walletTokens.js'

export const WALLET_TOKEN_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000
export const MAX_FAST_BALANCE_TOKENS = 64
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

function normalizedScope(chainId) {
    const text = String(chainId ?? '').trim().toLowerCase()
    if (text === 'all') return 'all'
    const numeric = Number(chainId)
    return Number.isSafeInteger(numeric) && numeric > 0
        ? String(numeric)
        : null
}

export function walletTokenCacheKey({ chainId, address }) {
    const scope = normalizedScope(chainId)
    const wallet = String(address ?? '').trim().toLowerCase()
    if (!scope || !/^0x[a-f0-9]{40}$/.test(wallet)) return null
    return `${WALLET_TOKEN_CACHE_NAMESPACE}${scope}:${wallet}`
}

function safeStorage(storage) {
    return storage ?? globalThis.localStorage ?? null
}

function normalizedMetadata(value) {
    return {
        chainErrors: value?.chainErrors ?? {},
        queriedChainIds: value?.queriedChainIds ?? [],
        successfulChainIds: value?.successfulChainIds ?? [],
        failedChainIds: value?.failedChainIds ?? [],
        providerRejectedChainIds: value?.providerRejectedChainIds ?? [],
        unsupportedChainIds: value?.unsupportedChainIds ?? [],
        partial: value?.partial === true,
        stale: true,
    }
}

function isNativeWalletToken(token) {
    return token?.isNative === true ||
        String(token?.address ?? '').toLowerCase() === NATIVE_TOKEN_ADDRESS
}

export function repairNativeWalletTokenRecord(token) {
    if (!isNativeWalletToken(token)) return token
    return {
        ...token,
        address: NATIVE_TOKEN_ADDRESS,
        isNative: true,
        classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
        recognitionStatus: 'established',
        recognitionReasons: Array.isArray(token.recognitionReasons)
            ? [...new Set(['native-token', ...token.recognitionReasons])]
            : ['native-token'],
        verificationStatus: 'established',
        spamStatus: 'clean',
        possibleSpam: false,
        verifiedContract: null,
        spamReasons: ['native-token'],
        securityStatus: 'trusted',
        securityReasons: ['native-token'],
        visibility: 'primary',
        visibilityReasons: ['native-token'],
        classificationTier: 'core',
        classificationReasons: ['native-token'],
        includeInPortfolioValue: true,
    }
}

export function readWalletTokenCache({
    chainId,
    address,
    storage,
    now = Date.now(),
} = {}) {
    const key = walletTokenCacheKey({ chainId, address })
    const target = safeStorage(storage)
    if (!key || !target) return null

    try {
        const raw = target.getItem(key)
        if (!raw) return null
        const payload = JSON.parse(raw)
        const savedAt = Number(payload?.savedAt)
        const wallet = String(address).toLowerCase()
        const repairedTokens = payload.tokens.map(repairNativeWalletTokenRecord)
        if (
            payload?.classificationVersion !== WALLET_TOKEN_CLASSIFICATION_VERSION ||
            payload?.address !== wallet ||
            payload?.scope !== normalizedScope(chainId) ||
            !Number.isFinite(savedAt) ||
            savedAt <= 0 ||
            now - savedAt > WALLET_TOKEN_CACHE_MAX_AGE_MS ||
            !Array.isArray(payload.tokens) ||
            !repairedTokens.every(isCurrentWalletTokenRecord)
        ) {
            target.removeItem(key)
            return null
        }
        return {
            tokens: repairedTokens,
            savedAt,
            ...normalizedMetadata(payload),
        }
    } catch {
        return null
    }
}

export function writeWalletTokenCache({
    chainId,
    address,
    tokens,
    metadata = {},
    storage,
    now = Date.now(),
} = {}) {
    const key = walletTokenCacheKey({ chainId, address })
    const target = safeStorage(storage)
    if (!key || !target || !Array.isArray(tokens) ||
        !tokens.every(isCurrentWalletTokenRecord)) return false

    try {
        target.setItem(key, JSON.stringify({
            classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
            address: String(address).toLowerCase(),
            scope: normalizedScope(chainId),
            savedAt: now,
            tokens,
            ...normalizedMetadata(metadata),
        }))
        return true
    } catch {
        return false
    }
}

function knownTokenRequest(tokens) {
    return tokens
        .filter(isCurrentWalletTokenRecord)
        .toSorted((left, right) =>
            Number(right.visibility === 'primary') - Number(left.visibility === 'primary'))
        .slice(0, MAX_FAST_BALANCE_TOKENS)
        .map((token) => ({
            chainId: Number(token.chainId),
            address: String(token.address).toLowerCase(),
        }))
}

function validKnownBalancePayload(payload, address) {
    return payload !== null &&
        typeof payload === 'object' &&
        payload.address === address.toLowerCase() &&
        Array.isArray(payload.balances) &&
        payload.balances.every((balance) =>
            Number.isSafeInteger(Number(balance?.chainId)) &&
            /^0x[a-f0-9]{40}$/.test(String(balance?.address ?? '')) &&
            /^\d+$/.test(String(balance?.rawBalance ?? '')))
}

export async function fetchKnownWalletTokenBalances({
    address,
    tokens,
    signal,
    apiBaseUrl = defaultApiBaseUrl,
} = {}) {
    const wallet = String(address ?? '').trim().toLowerCase()
    const requestedTokens = knownTokenRequest(tokens ?? [])
    if (!/^0x[a-f0-9]{40}$/.test(wallet) || requestedTokens.length === 0) {
        return null
    }

    const response = await fetch(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/wallet-tokens/known-balances`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                address: wallet,
                tokens: requestedTokens,
            }),
            signal,
        },
    )
    if (!response.ok) throw new Error('Known wallet balances could not be loaded.')
    const payload = await response.json().catch(() => null)
    if (!validKnownBalancePayload(payload, wallet)) {
        throw new Error('Backend returned invalid known wallet balances.')
    }
    return payload
}

export function mergeKnownWalletTokenBalances(tokens, payload) {
    if (!Array.isArray(tokens) || !payload?.balances) return tokens ?? []
    const balances = new Map(payload.balances.map((balance) => [
        `${Number(balance.chainId)}:${String(balance.address).toLowerCase()}`,
        String(balance.rawBalance),
    ]))

    return tokens.flatMap((token) => {
        const key = `${Number(token.chainId)}:${String(token.address).toLowerCase()}`
        if (!balances.has(key)) return [token]
        const rawBalance = balances.get(key)
        if (BigInt(rawBalance) === 0n) return []
        const formattedBalance = formatUnits(
            BigInt(rawBalance),
            Number(token.decimals ?? 18),
        )
        return [{
            ...token,
            rawBalance,
            balance: formattedBalance,
            formattedBalance,
            valueUSD: null,
        }]
    })
}

export function mergeDiscoveredWalletTokenBalances(discovered, cached, payload) {
    if (!payload?.balances) return discovered
    const verified = new Set(payload.balances.map(balance =>
        `${Number(balance.chainId)}:${String(balance.address).toLowerCase()}`))
    const tokens = new Map(discovered.map(token => [
        `${Number(token.chainId)}:${String(token.address).toLowerCase()}`, token,
    ]))
    for (const token of cached ?? []) {
        const identity = `${Number(token.chainId)}:${String(token.address).toLowerCase()}`
        if (!tokens.has(identity) && verified.has(identity)) tokens.set(identity, token)
    }
    return mergeKnownWalletTokenBalances([...tokens.values()], payload)
}

export const walletTokenCacheInternals = {
    knownTokenRequest,
    normalizedMetadata,
    normalizedScope,
    validKnownBalancePayload,
}
