import type { FastifyPluginAsync } from 'fastify'

import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../lib/address.js'
import { isRecord } from '../lib/http.js'
import { moralisWalletHistoryRequest } from '../providers/moralis/wallet-history.js'
import {
    getWalletTokens,
    type WalletToken,
} from '../providers/alchemy/wallet-tokens.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from '../token-discovery/registry.js'

type ActivityToken = {
    address: string | null
    symbol: string | null
    name: string | null
    decimals: number | null
    isNative: boolean
    logoURI: string | null
}

type Transfer = {
    token: ActivityToken
    amount: string | null
    from: string | null
    to: string | null
    direction: 'incoming' | 'outgoing' | null
}

const MORALIS_CHAIN_IDS = new Set(
    ACTIVE_TOKEN_DISCOVERY_CHAINS
        .filter((chain) => chain.capabilities.moralis)
        .map((chain) => chain.chainId),
)

function stringValue(value: unknown, maximumLength = 200) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text && text.length <= maximumLength ? text : null
}

function decimalValue(value: unknown) {
    const text = String(value ?? '').trim()
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? text : null
}

function booleanValue(value: unknown) {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    return null
}

function safeHttpsUrl(value: unknown) {
    const text = stringValue(value, 500)
    if (!text) return null
    try {
        const url = new URL(text)
        return url.protocol === 'https:' && !url.username && !url.password
            ? url.toString()
            : null
    } catch {
        return null
    }
}

function activityTokenFromErc20(value: unknown): ActivityToken | null {
    if (!isRecord(value) || booleanValue(value.possible_spam) === true) return null
    const address = normalizeAddress(value.address ?? value.token_address)
    if (!address) return null
    const decimals = Number(value.token_decimals)
    return {
        address,
        symbol: stringValue(value.token_symbol, 24),
        name: stringValue(value.token_name, 100),
        decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
            ? decimals
            : null,
        isNative: false,
        logoURI: safeHttpsUrl(value.token_logo),
    }
}

function activityTokenFromNative(chainId: number, value: unknown): ActivityToken {
    const chain = getTokenDiscoveryChain(chainId)
    return {
        address: NATIVE_TOKEN_ADDRESS,
        symbol: isRecord(value)
            ? stringValue(value.token_symbol, 24) ?? chain?.native.symbol ?? null
            : chain?.native.symbol ?? null,
        name: chain?.native.name ?? null,
        decimals: chain?.native.decimals ?? 18,
        isNative: true,
        logoURI: isRecord(value)
            ? safeHttpsUrl(value.token_logo) ?? chain?.chainLogoURI ?? null
            : chain?.chainLogoURI ?? null,
    }
}

function transferDirection(
    wallet: string,
    from: string | null,
    to: string | null,
    declared: unknown,
): Transfer['direction'] {
    const normalizedDeclared = String(declared ?? '').trim().toLowerCase()
    if (normalizedDeclared === 'incoming' || normalizedDeclared === 'outgoing') {
        return normalizedDeclared
    }
    if (from === wallet) return 'outgoing'
    if (to === wallet) return 'incoming'
    return null
}

function erc20Transfer(wallet: string, value: unknown): Transfer | null {
    const token = activityTokenFromErc20(value)
    if (!token || !isRecord(value)) return null
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)
    return {
        token,
        amount: decimalValue(value.value_formatted),
        from,
        to,
        direction: transferDirection(wallet, from, to, value.direction),
    }
}

function nativeTransfer(
    chainId: number,
    wallet: string,
    value: unknown,
): Transfer | null {
    if (!isRecord(value)) return null
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)
    return {
        token: activityTokenFromNative(chainId, value),
        amount: decimalValue(value.value_formatted),
        from,
        to,
        direction: transferDirection(wallet, from, to, value.direction),
    }
}

function tokenIdentity(token: ActivityToken) {
    return token.isNative ? 'native' : token.address
}

function normalizeMoralisActivity(
    chainId: number,
    wallet: string,
    value: unknown,
): Record<string, unknown> | null {
    if (!isRecord(value) || String(value.receipt_status ?? '1') !== '1') return null
    const hash = stringValue(value.hash, 66)?.toLowerCase()
    if (!hash || !/^0x[a-f0-9]{64}$/.test(hash)) return null

    const erc20 = Array.isArray(value.erc20_transfers)
        ? value.erc20_transfers
            .map((item) => erc20Transfer(wallet, item))
            .filter((item): item is Transfer => item !== null)
        : []
    const native = Array.isArray(value.native_transfers)
        ? value.native_transfers
            .map((item) => nativeTransfer(chainId, wallet, item))
            .filter((item): item is Transfer => item !== null)
        : []
    const transfers = [...erc20, ...native]
    const outgoing = transfers.filter((item) => item.direction === 'outgoing')
    const incoming = transfers.filter((item) => item.direction === 'incoming')
    const summary = `${String(value.summary ?? '')} ${String(value.method_label ?? '')}`
        .trim()
        .toLowerCase()
    const timestamp = stringValue(value.block_timestamp, 40)
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)

    if (/\b(?:approve|approval|set approval)\b/.test(summary)) {
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'approved',
            chainId,
            hash,
            timestamp,
            token: outgoing[0]?.token ?? null,
            amount: outgoing[0]?.amount ?? null,
            recipient: to,
        }
    }

    const sell = outgoing[0] ?? null
    const buy = incoming.find((item) =>
        !sell || tokenIdentity(item.token) !== tokenIdentity(sell.token)) ??
        incoming[0] ?? null
    if (
        /\b(?:swap|swapped|trade|traded)\b/.test(summary) &&
        sell && buy && tokenIdentity(sell.token) !== tokenIdentity(buy.token)
    ) {
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken: sell?.token ?? null,
            buyToken: buy?.token ?? null,
            sellAmount: sell?.amount ?? null,
            buyAmount: buy?.amount ?? null,
            recipient: to,
        }
    }

    if (outgoing.length > 0 || from === wallet) {
        const transfer = outgoing[0] ?? null
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: transfer ? 'sent' : 'contract',
            chainId,
            hash,
            timestamp,
            token: transfer?.token ?? null,
            amount: transfer?.amount ?? null,
            recipient: transfer?.to ?? to,
        }
    }

    if (incoming.length > 0 || to === wallet) {
        const transfer = incoming[0] ?? null
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'received',
            chainId,
            hash,
            timestamp,
            token: transfer?.token ?? null,
            amount: transfer?.amount ?? null,
            recipient: wallet,
        }
    }

    return null
}

function walletTokenKey(chainId: number, token: ActivityToken | null) {
    if (!token) return null
    return `${chainId}:${token.isNative ? NATIVE_TOKEN_ADDRESS : token.address}`
}

function trustedWalletToken(token: WalletToken | undefined) {
    if (!token) return false
    if (token.isNative === true) return true
    return token.visibility === 'primary' &&
        token.recognitionStatus !== 'unverified' &&
        token.possibleSpam !== true &&
        token.priceConfidence !== 'untrusted' &&
        token.includeInPortfolioValue !== false &&
        !['caution', 'high', 'blocked'].includes(token.securityStatus)
}

function activityTokenTrusted(
    chainId: number,
    token: ActivityToken | null,
    trustedTokens: Map<string, WalletToken>,
) {
    if (token?.isNative === true) return true
    const key = walletTokenKey(chainId, token)
    return key ? trustedWalletToken(trustedTokens.get(key)) : false
}

function activityPassesTrustPolicy(
    item: Record<string, unknown>,
    trustedTokens: Map<string, WalletToken>,
) {
    const chainId = Number(item.chainId)
    const type = String(item.type)
    if (type === 'contract') return false
    if (type === 'swapped') {
        return activityTokenTrusted(chainId, item.sellToken as ActivityToken | null, trustedTokens) &&
            activityTokenTrusted(chainId, item.buyToken as ActivityToken | null, trustedTokens)
    }
    return activityTokenTrusted(chainId, item.token as ActivityToken | null, trustedTokens)
}

function enrichActivityToken(
    chainId: number,
    token: ActivityToken | null,
    trustedTokens: Map<string, WalletToken>,
) {
    if (!token) return null
    return trustedTokens.get(walletTokenKey(chainId, token) ?? '') ?? token
}

function enrichActivityTokens(
    item: Record<string, unknown>,
    trustedTokens: Map<string, WalletToken>,
) {
    const chainId = Number(item.chainId)
    if (item.type === 'swapped') {
        return {
            ...item,
            sellToken: enrichActivityToken(chainId, item.sellToken as ActivityToken | null, trustedTokens),
            buyToken: enrichActivityToken(chainId, item.buyToken as ActivityToken | null, trustedTokens),
        }
    }
    return {
        ...item,
        token: enrichActivityToken(chainId, item.token as ActivityToken | null, trustedTokens),
    }
}

function requestedChainIds(value: unknown) {
    const requested = String(value ?? '')
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isSafeInteger(item) && MORALIS_CHAIN_IDS.has(item))
    return [...new Set(requested)].slice(0, 8)
}

export const walletActivityRoutes: FastifyPluginAsync = async (app) => {
    app.get<{
        Querystring: {
            address?: string
            chainIds?: string
            limit?: string
        }
    }>('/v1/wallet-activity', {
        config: {
            rateLimit: {
                max: 20,
                timeWindow: '1 minute',
            },
        },
    }, async (request, reply) => {
        const wallet = normalizeAddress(request.query.address)
        if (!wallet) {
            return reply.code(400).send({
                error: {
                    code: 'INVALID_WALLET_ADDRESS',
                    message: 'A valid wallet address is required.',
                },
            })
        }

        const chainIds = requestedChainIds(request.query.chainIds)
        if (chainIds.length === 0) chainIds.push(56)
        const limit = Math.max(1, Math.min(50, Number(request.query.limit) || 50))
        const perChainLimit = Math.max(10, Math.min(50, limit))
        const results = await Promise.allSettled(chainIds.map(async (chainId) => ({
            chainId,
            payload: await moralisWalletHistoryRequest({
                chainId,
                walletAddress: wallet,
                limit: perChainLimit,
            }),
            walletTokens: await getWalletTokens({
                chainId,
                walletAddress: wallet,
                includeZero: false,
            }).catch(() => []),
        })))

        const items: Record<string, unknown>[] = []
        const failedChainIds: number[] = []
        const unsupportedChainIds: number[] = []
        for (const [index, result] of results.entries()) {
            const chainId = chainIds[index]
            if (result.status === 'rejected') {
                failedChainIds.push(chainId)
                continue
            }
            if (!result.value.payload) {
                unsupportedChainIds.push(chainId)
                continue
            }
            const payload = result.value.payload
            const trustedTokens = new Map(result.value.walletTokens.map((token) => [
                `${Number(token.chainId)}:${String(token.address).toLowerCase()}`,
                token,
            ]))
            const rows = isRecord(payload) && Array.isArray(payload.result)
                ? payload.result
                : []
            for (const row of rows) {
                const item = normalizeMoralisActivity(chainId, wallet, row)
                if (item && activityPassesTrustPolicy(item, trustedTokens)) {
                    items.push(enrichActivityTokens(item, trustedTokens))
                }
            }
        }

        const deduplicated = new Map<string, Record<string, unknown>>()
        for (const item of items) {
            const key = `${item.chainId}:${item.hash}:${item.type}`
            if (!deduplicated.has(key)) deduplicated.set(key, item)
        }
        const sorted = [...deduplicated.values()]
            .sort((left, right) =>
                Date.parse(String(right.timestamp ?? '')) -
                Date.parse(String(left.timestamp ?? '')))
            .slice(0, limit)

        return {
            address: wallet,
            items: sorted,
            queriedChainIds: chainIds,
            failedChainIds,
            unsupportedChainIds,
            partial: failedChainIds.length > 0 || unsupportedChainIds.length > 0,
            source: 'moralis-wallet-history',
        }
    })
}

export const walletActivityInternals = {
    activityTokenFromErc20,
    normalizeMoralisActivity,
    requestedChainIds,
}
