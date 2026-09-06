import {
    decodeFunctionData,
    formatUnits,
    isHex,
    zeroAddress,
    type Hex,
} from 'viem'
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
    getFallbackTokensForChain,
    type PublicFallbackToken,
} from '../token-discovery/fallback-token-catalog.js'
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

type KnownActivityToken = WalletToken | PublicFallbackToken

type Transfer = {
    token: ActivityToken
    amount: string | null
    rawAmount: bigint | null
    from: string | null
    to: string | null
    direction: 'incoming' | 'outgoing' | null
}

const MORALIS_CHAIN_IDS = new Set(
    ACTIVE_TOKEN_DISCOVERY_CHAINS
        .filter((chain) => chain.capabilities.moralis)
        .map((chain) => chain.chainId),
)

// Production same-chain Gas Assist delegates the user's BNB Chain EOA to this
// ownerless EIP-7702 executor. The top-level transaction still targets the
// user's own EOA, so wallet history cannot identify it from `to_address` alone.
export const GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS =
    '0x973731be76bdb84b994d32ef1e9607edebfbe470'

const gasAssistAtomicExecutorAbi = [
    {
        type: 'function',
        name: 'executeAtomicSwap',
        stateMutability: 'payable',
        inputs: [
            { name: 'treasury', type: 'address' },
            { name: 'paymentToken', type: 'address' },
            { name: 'feeAmount', type: 'uint256' },
            { name: 'sellToken', type: 'address' },
            { name: 'swapAmount', type: 'uint256' },
            { name: 'buyToken', type: 'address' },
            { name: 'router', type: 'address' },
            { name: 'swapCalldata', type: 'bytes' },
            { name: 'minOut', type: 'uint256' },
        ],
        outputs: [],
    },
] as const

const erc20ApproveAbi = [
    {
        type: 'function',
        name: 'approve',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const

const UINT256_MAX = (1n << 256n) - 1n

function stringValue(value: unknown, maximumLength = 200) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text && text.length <= maximumLength ? text : null
}

function decimalValue(value: unknown) {
    const text = String(value ?? '').trim()
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? text : null
}

function uintValue(value: unknown) {
    const text = String(value ?? '').trim()
    if (!/^\d+$/.test(text)) return null
    try {
        return BigInt(text)
    } catch {
        return null
    }
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

function activityTokenForAddress(chainId: number, value: unknown): ActivityToken | null {
    const address = normalizeAddress(value)
    if (!address) return null
    if (address === zeroAddress) return activityTokenFromNative(chainId, null)
    return {
        address,
        symbol: null,
        name: null,
        decimals: null,
        isNative: false,
        logoURI: null,
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
        rawAmount: uintValue(value.value),
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
        rawAmount: uintValue(value.value),
        from,
        to,
        direction: transferDirection(wallet, from, to, value.direction),
    }
}

function tokenIdentity(token: ActivityToken) {
    return token.isNative ? 'native' : token.address
}

function tokenMatchesAddress(token: ActivityToken, address: string) {
    return address === zeroAddress
        ? token.isNative
        : token.address === address
}

function exactTransfer(
    transfers: Transfer[],
    address: string,
    rawAmount?: bigint,
) {
    return transfers.find((transfer) =>
        tokenMatchesAddress(transfer.token, address) &&
        (rawAmount === undefined || transfer.rawAmount === rawAmount)) ?? null
}

function formatRawAmount(rawAmount: bigint, token: ActivityToken | null) {
    const decimals = token?.decimals
    if (!Number.isInteger(decimals) || decimals === null || decimals < 0 || decimals > 255) {
        return null
    }
    try {
        return formatUnits(rawAmount, decimals)
    } catch {
        return null
    }
}

function authorizationAddresses(value: Record<string, unknown>) {
    const candidates = value.authorization_list ?? value.authorizationList
    if (!Array.isArray(candidates)) return []
    return candidates
        .map((entry) => isRecord(entry)
            ? normalizeAddress(entry.address ?? entry.contract_address)
            : null)
        .filter((address): address is string => Boolean(address))
}

function gasAssistAuthorizationMatches(value: Record<string, unknown>) {
    const addresses = authorizationAddresses(value)
    // Some Moralis history responses do not expose EIP-7702 authorization
    // tuples. When they are present, require the exact production executor.
    return addresses.length === 0 || addresses.includes(GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS)
}

function decodeGasAssistActivity({
    chainId,
    wallet,
    value,
    hash,
    timestamp,
    outgoing,
    incoming,
}: {
    chainId: number
    wallet: string
    value: Record<string, unknown>
    hash: string
    timestamp: string | null
    outgoing: Transfer[]
    incoming: Transfer[]
}): Record<string, unknown> | null {
    if (chainId !== 56) return null
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)
    if (from !== wallet || to !== wallet || !gasAssistAuthorizationMatches(value)) return null

    const input = stringValue(value.input, 200_000)
    if (!input || !isHex(input) || input.length < 10) return null

    try {
        const decoded = decodeFunctionData({
            abi: gasAssistAtomicExecutorAbi,
            data: input as Hex,
        })
        if (decoded.functionName !== 'executeAtomicSwap') return null

        const [
            ,
            ,
            ,
            rawSellToken,
            swapAmount,
            rawBuyToken,
        ] = decoded.args
        const sellAddress = normalizeAddress(rawSellToken)
        const normalizedBuyAddress = normalizeAddress(rawBuyToken)
        if (!sellAddress || !normalizedBuyAddress || swapAmount <= 0n) return null

        const buyAddress = normalizedBuyAddress === zeroAddress
            ? zeroAddress
            : normalizedBuyAddress
        const exactSell = exactTransfer(outgoing, sellAddress, swapAmount)
        const anySell = exactSell ?? exactTransfer(outgoing, sellAddress)
        const buyTransfer = exactTransfer(incoming, buyAddress)
        const sellToken = anySell?.token ?? activityTokenForAddress(chainId, sellAddress)
        const buyToken = buyTransfer?.token ?? activityTokenForAddress(chainId, buyAddress)
        if (!sellToken || !buyToken || tokenIdentity(sellToken) === tokenIdentity(buyToken)) {
            return null
        }

        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken,
            buyToken,
            // The executor's swapAmount is the exact principal. Do not use the
            // first outgoing transfer because it may be the Gas Assist fee.
            sellAmount:
                formatRawAmount(swapAmount, sellToken) ?? anySell?.amount ?? null,
            buyAmount: buyTransfer?.amount ?? null,
            recipient: wallet,
            provider: 'pistachio-gas-assist',
        }
    } catch {
        return null
    }
}

function decodeApprovalActivity({
    chainId,
    wallet,
    value,
    hash,
    timestamp,
}: {
    chainId: number
    wallet: string
    value: Record<string, unknown>
    hash: string
    timestamp: string | null
}): Record<string, unknown> | null {
    const from = normalizeAddress(value.from_address)
    const tokenAddress = normalizeAddress(value.to_address)
    const input = stringValue(value.input, 4_096)
    if (from !== wallet || !tokenAddress || !input || !isHex(input) || input.length < 10) {
        return null
    }

    try {
        const decoded = decodeFunctionData({
            abi: erc20ApproveAbi,
            data: input as Hex,
        })
        if (decoded.functionName !== 'approve') return null
        const [spender, amountRaw] = decoded.args
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'approved',
            chainId,
            hash,
            timestamp,
            token: activityTokenForAddress(chainId, tokenAddress),
            amountRaw: amountRaw === UINT256_MAX ? null : amountRaw.toString(),
            recipient: normalizeAddress(spender),
        }
    } catch {
        return null
    }
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
    const category = String(value.category ?? '').trim().toLowerCase()
    const timestamp = stringValue(value.block_timestamp, 40)
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)

    const gasAssist = decodeGasAssistActivity({
        chainId,
        wallet,
        value,
        hash,
        timestamp,
        outgoing,
        incoming,
    })
    if (gasAssist) return gasAssist

    const decodedApproval = decodeApprovalActivity({
        chainId,
        wallet,
        value,
        hash,
        timestamp,
    })
    if (decodedApproval) return decodedApproval

    if (/\b(?:approve|approval|set approval)\b/.test(summary) || category === 'approve') {
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'approved',
            chainId,
            hash,
            timestamp,
            token: outgoing[0]?.token ?? activityTokenForAddress(chainId, to),
            amount: outgoing[0]?.amount ?? null,
            recipient: to,
        }
    }

    const sell = outgoing[0] ?? null
    const buy = incoming.find((item) =>
        !sell || tokenIdentity(item.token) !== tokenIdentity(sell.token)) ??
        incoming[0] ?? null
    const swapSemantic =
        /\b(?:swap|swapped|trade|traded)\b/.test(summary) ||
        ['swap', 'token swap'].includes(category)
    if (
        swapSemantic &&
        sell && buy && tokenIdentity(sell.token) !== tokenIdentity(buy.token)
    ) {
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken: sell.token,
            buyToken: buy.token,
            sellAmount: sell.amount,
            buyAmount: buy.amount,
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

function isStaticFallbackToken(token: KnownActivityToken | undefined) {
    return token && 'catalogSource' in token &&
        token.catalogSource === 'static-fallback' &&
        token.directoryStatus === 'listed'
}

function trustedWalletToken(token: KnownActivityToken | undefined) {
    if (!token) return false
    if (isStaticFallbackToken(token)) return true
    const walletToken = token as WalletToken
    if (walletToken.isNative === true) return true
    return ['core', 'established'].includes(walletToken.classificationTier) &&
        walletToken.visibility === 'primary' &&
        walletToken.possibleSpam !== true &&
        !['high', 'blocked'].includes(walletToken.securityStatus)
}

function activityTokenTrusted(
    chainId: number,
    token: ActivityToken | null,
    trustedTokens: Map<string, KnownActivityToken>,
) {
    if (token?.isNative === true) return true
    const key = walletTokenKey(chainId, token)
    return key ? trustedWalletToken(trustedTokens.get(key)) : false
}

function activityPassesTrustPolicy(
    item: Record<string, unknown>,
    trustedTokens: Map<string, KnownActivityToken>,
) {
    const chainId = Number(item.chainId)
    const type = String(item.type)
    if (type === 'contract') return false
    if (type === 'swapped') {
        return activityTokenTrusted(
            chainId,
            item.sellToken as ActivityToken | null,
            trustedTokens,
        ) && activityTokenTrusted(
            chainId,
            item.buyToken as ActivityToken | null,
            trustedTokens,
        )
    }
    return activityTokenTrusted(
        chainId,
        item.token as ActivityToken | null,
        trustedTokens,
    )
}

function enrichActivityToken(
    chainId: number,
    token: ActivityToken | null,
    trustedTokens: Map<string, KnownActivityToken>,
) {
    if (!token) return null
    const known = trustedTokens.get(walletTokenKey(chainId, token) ?? '')
    if (!known) return token
    if (isStaticFallbackToken(known)) {
        return {
            ...token,
            ...known,
            address: token.address,
            isNative: token.isNative,
            historyVerified: true,
            classificationTier: token.isNative ? 'core' : 'established',
            recognitionStatus: 'recognized',
            recognitionReasons: ['static-fallback-history-contract'],
            verificationStatus: 'recognized',
            verificationReasons: ['static-fallback-history-contract'],
            possibleSpam: false,
            verifiedContract: token.isNative ? null : true,
            securityStatus: 'low',
            visibility: 'primary',
            includeInPortfolioValue: false,
            priceConfidence: 'unknown',
        }
    }
    return {
        ...token,
        ...known,
        address: token.address,
        isNative: token.isNative,
        historyVerified: true,
    }
}

function enrichActivityTokens(
    item: Record<string, unknown>,
    trustedTokens: Map<string, KnownActivityToken>,
) {
    const chainId = Number(item.chainId)
    if (item.type === 'swapped') {
        return {
            ...item,
            sellToken: enrichActivityToken(
                chainId,
                item.sellToken as ActivityToken | null,
                trustedTokens,
            ),
            buyToken: enrichActivityToken(
                chainId,
                item.buyToken as ActivityToken | null,
                trustedTokens,
            ),
        }
    }
    const token = enrichActivityToken(
        chainId,
        item.token as ActivityToken | null,
        trustedTokens,
    )
    let amount = item.amount ?? null
    if (
        amount == null &&
        typeof item.amountRaw === 'string' &&
        /^\d+$/.test(item.amountRaw) &&
        token?.decimals != null
    ) {
        try {
            amount = formatUnits(BigInt(item.amountRaw), Number(token.decimals))
        } catch {
            amount = null
        }
    }
    return {
        ...item,
        token,
        amount,
        amountRaw: undefined,
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
        const results = await Promise.allSettled(chainIds.map(async (chainId) => {
            const [payload, walletTokens, fallbackTokens] = await Promise.all([
                moralisWalletHistoryRequest({
                    chainId,
                    walletAddress: wallet,
                    limit: perChainLimit,
                }),
                getWalletTokens({
                    chainId,
                    walletAddress: wallet,
                    includeZero: false,
                }).catch(() => []),
                getFallbackTokensForChain(chainId).catch(() => []),
            ])
            return { chainId, payload, walletTokens, fallbackTokens }
        }))

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
            const trustedTokens = new Map<string, KnownActivityToken>()
            for (const token of result.value.fallbackTokens) {
                trustedTokens.set(
                    `${Number(token.chainId)}:${String(token.address).toLowerCase()}`,
                    token,
                )
            }
            // Current wallet records take precedence for richer price/security
            // metadata, but their absence no longer erases historical transfers.
            for (const token of result.value.walletTokens) {
                trustedTokens.set(
                    `${Number(token.chainId)}:${String(token.address).toLowerCase()}`,
                    token,
                )
            }
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
    decodeApprovalActivity,
    decodeGasAssistActivity,
    normalizeMoralisActivity,
    requestedChainIds,
}
