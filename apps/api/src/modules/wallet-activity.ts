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
import { alchemyWalletHistoryRequest, receiptHasSwapEvidence } from '../providers/alchemy/wallet-history.js'
import { alchemyRpcBatch } from '../providers/alchemy/alchemy-client.js'
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

// Current direct EIP-7702 same-chain executor.
export const GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS =
    '0x973731be76bdb84b994d32ef1e9607edebfbe470'

// Pistachio-owned BNB Chain contracts that have been used by the product.
// Keep these as transaction-history identities only. Their presence here does
// not grant execution privileges or alter Gas Assist routing/security policy.
export const KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES = Object.freeze([
    GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS,
    '0x517b6c94da086f3f69dc725d7d70cdba7c4a9b62',
    '0x21331d393a0622eeddffce3e9db29448b6110bc6',
])

const KNOWN_PISTACHIO_BSC_CONTRACT_SET = new Set(
    KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES,
)

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

function activityTokenForAddress(
    chainId: number,
    value: unknown,
): ActivityToken | null {
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
    const decimals = value.token_decimals == null ? NaN : Number(value.token_decimals)
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
    if (from === wallet && to === wallet) return null
    if (from === wallet) return 'outgoing'
    if (to === wallet) return 'incoming'
    if (from && to) return null
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

function differentAssets(chainId: number, sell: ActivityToken, buy: ActivityToken) {
    const wrapped = getTokenDiscoveryChain(chainId)?.wrappedNative?.address
    return tokenIdentity(sell) !== tokenIdentity(buy) &&
        !(sell.isNative && buy.address === wrapped) &&
        !(buy.isNative && sell.address === wrapped)
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
    if (
        typeof decimals !== 'number' ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255
    ) {
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
    const addresses: string[] = []
    for (const entry of candidates) {
        if (!isRecord(entry)) continue
        const address = normalizeAddress(entry.address ?? entry.contract_address)
        if (address) addresses.push(address)
    }
    return addresses
}

function isKnownPistachioBscContract(value: unknown) {
    const address = normalizeAddress(value)
    return address !== null && KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address)
}

function hasKnownPistachioAuthorization(value: Record<string, unknown>) {
    return authorizationAddresses(value)
        .some((address) => KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address))
}

function gasAssistAuthorizationMatches(value: Record<string, unknown>) {
    const addresses = authorizationAddresses(value)
    // Moralis does not always expose EIP-7702 authorization tuples. When it
    // does expose them, require a known Pistachio executor/contract identity.
    return addresses.length === 0 || addresses.some((address) =>
        KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address))
}

function dominantTransfer(transfers: Transfer[]) {
    if (transfers.length === 0) return null
    return transfers.reduce((best, candidate) => {
        if (!best) return candidate
        if (best.rawAmount !== null && candidate.rawAmount !== null) {
            return candidate.rawAmount > best.rawAmount ? candidate : best
        }
        const bestAmount = Number(best.amount)
        const candidateAmount = Number(candidate.amount)
        if (Number.isFinite(candidateAmount) &&
            (!Number.isFinite(bestAmount) || candidateAmount > bestAmount)) {
            return candidate
        }
        return best
    }, null as Transfer | null)
}

function singleTokenFlow(transfers: Transfer[]) {
    const groups = new Map<string, Transfer[]>()
    for (const transfer of transfers) {
        const identity = tokenIdentity(transfer.token)
        if (!identity) continue
        const group = groups.get(identity) ?? []
        group.push(transfer)
        groups.set(identity, group)
    }
    if (groups.size !== 1) return null
    const group = [...groups.values()][0] ?? []
    const first = dominantTransfer(group)
    if (!first || group.some(item => item.rawAmount === null)) return first
    const rawAmount = group.reduce((total, item) => total + (item.rawAmount ?? 0n), 0n)
    return { ...first, rawAmount, amount: formatRawAmount(rawAmount, first.token) }
}

function netFlows(transfers: Transfer[]) {
    const groups = new Map<string, Transfer[]>()
    for (const transfer of transfers) {
        const key = tokenIdentity(transfer.token)
        if (!key || !transfer.direction || transfer.rawAmount === 0n) continue
        groups.set(key, [...(groups.get(key) ?? []), transfer])
    }
    return [...groups.values()].flatMap(group => {
        if (group.some(item => item.rawAmount === null)) return group
        const net = group.reduce((total, item) => total +
            (item.direction === 'incoming' ? 1n : -1n) * (item.rawAmount ?? 0n), 0n)
        if (net === 0n) return []
        const direction = net > 0n ? 'incoming' : 'outgoing'
        const first = group.find(item => item.direction === direction)!
        const rawAmount = net > 0n ? net : -net
        return [{ ...first, direction, rawAmount, amount: formatRawAmount(rawAmount, first.token) } as Transfer]
    })
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
    const directKnownContract = isKnownPistachioBscContract(to)
    const delegatedSelfCall = to === wallet && gasAssistAuthorizationMatches(value)
    if (from !== wallet || (!directKnownContract && !delegatedSelfCall)) return null

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
        // Require observed token flow. Calldata alone must never turn an
        // unrelated or reverted-looking interaction into a displayed swap.
        if (!anySell || !buyTransfer) return null
        const sellToken = anySell.token
        const buyToken = buyTransfer.token
        if (!differentAssets(chainId, sellToken, buyToken)) return null

        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken,
            buyToken,
            // swapAmount is the principal. A fee transfer may be the first
            // outgoing transfer, so never infer the principal from array order.
            sellAmount:
                formatRawAmount(swapAmount, sellToken) ?? anySell.amount ?? null,
            buyAmount: buyTransfer.amount ?? null,
            recipient: wallet,
            provider: 'pistachio-gas-assist',
        }
    } catch {
        return null
    }
}

function inferKnownPistachioSwapActivity({
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
    if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
    const to = normalizeAddress(value.to_address)
    const knownInteraction = isKnownPistachioBscContract(to) ||
        (to === wallet && hasKnownPistachioAuthorization(value))
    if (!knownInteraction) return null

    // Only infer a legacy/custom Pistachio swap when transfer flow is
    // unambiguous: one outgoing asset identity and one incoming asset identity.
    // Exact modern Gas Assist calls are handled above and retain exact principal.
    const net = netFlows([...outgoing, ...incoming])
    const sell = singleTokenFlow(net.filter(item => item.direction === 'outgoing'))
    const buy = singleTokenFlow(net.filter(item => item.direction === 'incoming'))
    if (!sell || !buy || !differentAssets(chainId, sell.token, buy.token)) {
        return null
    }

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
        provider: 'pistachio-contract',
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

function classifyHistoryActivity(
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
    if (native.length === 0 && (uintValue(value.value) ?? 0n) > 0n) {
        const transfer = nativeTransfer(chainId, wallet, {
            from_address: value.from_address, to_address: value.to_address,
            value: value.value, value_formatted: formatUnits(uintValue(value.value)!, 18),
        })
        if (transfer) native.push(transfer)
    }
    const transfers = [...erc20, ...native].filter(item =>
        item.rawAmount !== 0n && (item.rawAmount !== null || Number(item.amount) > 0))
    const outgoing = transfers.filter((item) => item.direction === 'outgoing')
    const incoming = transfers.filter((item) => item.direction === 'incoming')
    const summary = `${String(value.summary ?? '')} ${String(value.method_label ?? '')}`
        .trim()
        .toLowerCase()
    const category = String(value.category ?? '').trim().toLowerCase()
    const timestamp = stringValue(value.block_timestamp, 40)
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)

    const approval = decodeApprovalActivity({ chainId, wallet, value, hash, timestamp })
    if (approval) return approval

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

    const knownPistachioSwap = inferKnownPistachioSwapActivity({
        chainId,
        wallet,
        value,
        hash,
        timestamp,
        outgoing,
        incoming,
    })
    if (knownPistachioSwap) return knownPistachioSwap

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

    const net = netFlows(transfers)
    const sell = singleTokenFlow(net.filter(item => item.direction === 'outgoing'))
    const buy = net.filter(item => item.direction === 'incoming').find((item) =>
        !sell || tokenIdentity(item.token) !== tokenIdentity(sell.token)) ??
        null
    const swapSemantic =
        /\b(?:swap|swapped|trade|traded)\b/.test(summary) ||
        ['swap', 'token swap'].includes(category) || value.swap_evidence === true
    if (
        from === wallet && swapSemantic &&
        sell && buy && differentAssets(chainId, sell.token, buy.token)
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
            sender: transfer?.from ?? from,
        }
    }

    return null
}

function normalizeMoralisActivity(chainId: number, wallet: string, value: unknown) {
    wallet = normalizeAddress(wallet) ?? wallet
    const item = classifyHistoryActivity(chainId, wallet, value)
    if (!item || !isRecord(value)) return item
    const contracts = [normalizeAddress(value.to_address), ...authorizationAddresses(value)]
    return { ...item, source: 'remote', status: 'confirmed',
        blockNumber: String(value.block_number ?? ''),
        from: normalizeAddress(value.from_address), to: normalizeAddress(value.to_address),
        nativeValue: decimalValue(value.value), provider: item.provider ?? value.provider ?? 'moralis',
        providerType: stringValue(value.category),
        detectedContract: contracts.find(address => address && KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address)) ??
            (item.type === 'swapped' ? normalizeAddress(value.to_address) : null),
        classificationReason: item.type === 'swapped'
            ? 'Successful swap interaction with outgoing and incoming distinct assets'
            : item.type === 'approved' ? 'Approval calldata or provider approval evidence'
            : item.type === 'sent' ? 'Outgoing wallet movement; no confirmed distinct buy flow'
            : item.type === 'received' ? 'Incoming wallet movement'
            : 'Wallet contract call without swap flows',
    }
}

async function verifyAmbiguousSwapRows(chainId: number, wallet: string, rows: unknown[]) {
    let verificationUnavailable = false
    const candidates = rows.filter(isRecord).filter(row => {
        if (normalizeAddress(row.from_address) !== wallet) return false
        if (normalizeMoralisActivity(chainId, wallet, row)?.type !== 'sent') return false
        const movements = [...(Array.isArray(row.erc20_transfers) ? row.erc20_transfers : []),
            ...(Array.isArray(row.native_transfers) ? row.native_transfers : [])].filter(isRecord)
        return movements.some(item => normalizeAddress(item.to_address) === wallet && normalizeAddress(item.from_address) !== wallet)
    })
    for (let index = 0; index < candidates.length; index += 10) {
        const batch = candidates.slice(index, index + 10)
        const responses = await alchemyRpcBatch(batch.map(row => ({ jsonrpc: '2.0', id: String(row.hash),
            method: 'eth_getTransactionReceipt', params: [row.hash] })), undefined, chainId).catch(() => null)
        for (const row of batch) {
            const response = responses?.get(String(row.hash))
            if (response?.error || !isRecord(response?.result)) {
                verificationUnavailable = true
                continue
            }
            row.swap_evidence = receiptHasSwapEvidence(response.result)
            row.receipt_status = response.result.status === '0x1' ? '1' : '0'
        }
    }
    return { result: rows, limitations: verificationUnavailable ? ['swap-receipt-verification-unavailable'] : [] }
}

async function loadWalletHistory(chainId: number, walletAddress: string) {
    try {
        const rows: unknown[] = []
        let cursor: string | undefined
        const seen = new Set<string>()
        for (let page = 0; page < 5; page++) {
            const payload = await moralisWalletHistoryRequest({ chainId, walletAddress, limit: 50, cursor })
            if (!payload) throw new Error('History provider unavailable')
            if (!isRecord(payload) || !Array.isArray(payload.result)) throw new Error('Invalid history response')
            rows.push(...payload.result)
            if (!payload.cursor) return { ...await verifyAmbiguousSwapRows(chainId, walletAddress, rows), source: 'moralis-wallet-history', truncated: false }
            if (typeof payload.cursor !== 'string' || seen.has(payload.cursor)) throw new Error('Invalid history cursor')
            cursor = payload.cursor
            seen.add(cursor)
        }
        return { ...await verifyAmbiguousSwapRows(chainId, walletAddress, rows), source: 'moralis-wallet-history', truncated: true }
    } catch {
        if (chainId !== 56) throw new Error('History provider unavailable')
        return alchemyWalletHistoryRequest({ chainId, walletAddress })
    }
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
    const type = String(item.type)

    // Transaction history is not a portfolio. A successful transaction that the
    // wallet initiated must remain visible even when the asset has since moved
    // to zero balance or lacks current primary-portfolio classification.
    if (['contract', 'approved', 'sent', 'swapped'].includes(type)) {
        // A token can emit forged outbound logs for any address. Such logs are
        // not evidence that this wallet initiated a send.
        if (type === 'sent' && item.from && item.from !== item.walletAddress) {
            return activityTokenTrusted(Number(item.chainId), item.token as ActivityToken | null, trustedTokens)
        }
        return true
    }

    // Unsolicited inbound token transfers are the spam surface. Keep the strict
    // token trust gate there in addition to Moralis possible_spam filtering.
    if (type === 'received') {
        return activityTokenTrusted(
            Number(item.chainId),
            item.token as ActivityToken | null,
            trustedTokens,
        )
    }

    return false
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
    const amountRaw = typeof item.amountRaw === 'string' ? item.amountRaw : null
    let amount = item.amount ?? null
    if (
        amount == null &&
        amountRaw !== null &&
        /^\d+$/.test(amountRaw) &&
        token?.decimals != null
    ) {
        try {
            amount = formatUnits(BigInt(amountRaw), Number(token.decimals))
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
        const results = await Promise.allSettled(chainIds.map(async (chainId) => {
            const [payload, walletTokens, fallbackTokens] = await Promise.all([
                loadWalletHistory(chainId, wallet),
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
        const coverage: Record<string, unknown>[] = []
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
            coverage.push({ chainId, source: payload.source, truncated: payload.truncated, limitations: payload.limitations })
            const trustedTokens = new Map<string, KnownActivityToken>()
            for (const token of result.value.fallbackTokens) {
                trustedTokens.set(
                    `${Number(token.chainId)}:${String(token.address).toLowerCase()}`,
                    token,
                )
            }
            // Current wallet records enrich display metadata. They no longer
            // decide whether user-initiated historical transactions exist.
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
            const key = `${item.chainId}:${item.hash}`
            if (!deduplicated.has(key)) deduplicated.set(key, item)
        }
        const sorted = [...deduplicated.values()]
            .sort((left, right) =>
                Date.parse(String(right.timestamp ?? '')) -
                Date.parse(String(left.timestamp ?? '')))
            .slice(0, limit)

        if (failedChainIds.length === chainIds.length) {
            return reply.code(503).send({ error: { code: 'WALLET_HISTORY_UNAVAILABLE', message: 'Wallet history providers are unavailable.' } })
        }
        return {
            address: wallet,
            items: sorted,
            queriedChainIds: chainIds,
            failedChainIds,
            unsupportedChainIds,
            partial: failedChainIds.length > 0 || unsupportedChainIds.length > 0 ||
                coverage.some(entry => entry.truncated === true ||
                    (Array.isArray(entry.limitations) && entry.limitations.includes('swap-receipt-verification-unavailable'))),
            coverage,
            source: coverage.length === 1 ? coverage[0].source : 'wallet-history',
        }
    })
}

export const walletActivityInternals = {
    activityPassesTrustPolicy,
    activityTokenFromErc20,
    decodeApprovalActivity,
    decodeGasAssistActivity,
    inferKnownPistachioSwapActivity,
    isKnownPistachioBscContract,
    normalizeMoralisActivity,
    requestedChainIds,
}
