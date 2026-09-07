import {
    decodeFunctionData,
    formatUnits,
    isHex,
    toEventSelector,
    zeroAddress,
} from 'viem'

import {
    CANONICAL_NATIVE_TOKEN_ADDRESS,
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
    getWrappedNativeTokenAddress,
} from '../../../web3/curatedEvmChains.js'

export const WALLET_HISTORY_CLASSIFIER_VERSION = 1

export const GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS =
    '0x973731be76bdb84b994d32ef1e9607edebfbe470'

export const KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES = Object.freeze([
    GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS,
    '0x517b6c94da086f3f69dc725d7d70cdba7c4a9b62',
    '0x21331d393a0622eeddffce3e9db29448b6110bc6',
])

const KNOWN_PISTACHIO_BSC_CONTRACT_SET = new Set(
    KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES,
)

const TRANSFER_EVENT = toEventSelector('Transfer(address,address,uint256)').toLowerCase()
const SWAP_EVENTS = new Set([
    toEventSelector('Swap(address,uint256,uint256,uint256,uint256,address)'),
    toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)'),
    toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)'),
].map(value => value.toLowerCase()))

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
]

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
]

const UINT256_MAX = (1n << 256n) - 1n

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function stringValue(value, maximumLength = 200) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text && text.length <= maximumLength ? text : null
}

function decimalValue(value) {
    const text = String(value ?? '').trim()
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? text : null
}

function uintValue(value) {
    const text = String(value ?? '').trim()
    if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(text)) return null
    try {
        return BigInt(text)
    } catch {
        return null
    }
}

function tokenForAddress(chainId, value) {
    const address = normalizeAddress(value)
    if (!address) return null
    if (address === zeroAddress) return nativeToken(chainId)
    return {
        address,
        symbol: null,
        name: null,
        decimals: null,
        isNative: false,
        logoURI: null,
    }
}

function nativeToken(chainId) {
    const chain = getCuratedEvmChain(chainId)
    return {
        address: CANONICAL_NATIVE_TOKEN_ADDRESS,
        symbol: chain?.nativeCurrency?.symbol ?? null,
        name: chain?.nativeCurrency?.name ?? null,
        decimals: chain?.nativeCurrency?.decimals ?? 18,
        isNative: true,
        logoURI: getCuratedEvmChainLogoUri(chainId),
    }
}

function erc20Token(value) {
    if (!isRecord(value)) return null
    const address = normalizeAddress(value.address ?? value.token_address)
    if (!address) return null
    const decimals = value.token_decimals == null
        ? NaN
        : Number(value.token_decimals)
    return {
        address,
        symbol: stringValue(value.token_symbol, 24),
        name: stringValue(value.token_name, 100),
        decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
            ? decimals
            : null,
        isNative: false,
        logoURI: null,
    }
}

function transferDirection(wallet, from, to) {
    if (from === wallet && to === wallet) return null
    if (from === wallet) return 'outgoing'
    if (to === wallet) return 'incoming'
    return null
}

function erc20Transfer(wallet, value) {
    const token = erc20Token(value)
    if (!token || !isRecord(value)) return null
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)
    return {
        token,
        amount: decimalValue(value.value_formatted),
        rawAmount: uintValue(value.value),
        from,
        to,
        direction: transferDirection(wallet, from, to),
    }
}

function nativeTransfer(chainId, wallet, value) {
    if (!isRecord(value)) return null
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)
    return {
        token: nativeToken(chainId),
        amount: decimalValue(value.value_formatted),
        rawAmount: uintValue(value.value),
        from,
        to,
        direction: transferDirection(wallet, from, to),
    }
}

function tokenIdentity(token) {
    return token?.isNative ? 'native' : token?.address ?? null
}

function differentAssets(chainId, sell, buy) {
    const wrapped = getWrappedNativeTokenAddress(chainId)
    return tokenIdentity(sell) !== tokenIdentity(buy) &&
        !(sell?.isNative && buy?.address === wrapped) &&
        !(buy?.isNative && sell?.address === wrapped)
}

function tokenMatchesAddress(token, address) {
    return address === zeroAddress
        ? token?.isNative === true
        : token?.address === address
}

function exactTransfer(transfers, address, rawAmount) {
    return transfers.find(transfer =>
        tokenMatchesAddress(transfer.token, address) &&
        (rawAmount === undefined || transfer.rawAmount === rawAmount)) ?? null
}

function formatRawAmount(rawAmount, token) {
    const decimals = token?.decimals
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null
    try {
        return formatUnits(rawAmount, decimals)
    } catch {
        return null
    }
}

function authorizationAddresses(value) {
    const candidates = value.authorization_list ?? value.authorizationList
    if (!Array.isArray(candidates)) return []
    return candidates.flatMap(entry => {
        if (!isRecord(entry)) return []
        const address = normalizeAddress(entry.address ?? entry.contract_address)
        return address ? [address] : []
    })
}

function hasKnownPistachioAuthorization(value) {
    return authorizationAddresses(value)
        .some(address => KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address))
}

function isKnownPistachioBscContract(value) {
    const address = normalizeAddress(value)
    return Boolean(address) && KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address)
}

function dominantTransfer(transfers) {
    if (transfers.length === 0) return null
    return transfers.reduce((best, candidate) => {
        if (!best) return candidate
        if (best.rawAmount !== null && candidate.rawAmount !== null) {
            return candidate.rawAmount > best.rawAmount ? candidate : best
        }
        const bestAmount = Number(best.amount)
        const candidateAmount = Number(candidate.amount)
        return Number.isFinite(candidateAmount) &&
            (!Number.isFinite(bestAmount) || candidateAmount > bestAmount)
            ? candidate
            : best
    }, null)
}

function singleTokenFlow(transfers) {
    const groups = new Map()
    for (const transfer of transfers) {
        const identity = tokenIdentity(transfer.token)
        if (!identity) continue
        groups.set(identity, [...(groups.get(identity) ?? []), transfer])
    }
    if (groups.size !== 1) return null
    const group = [...groups.values()][0] ?? []
    const first = dominantTransfer(group)
    if (!first || group.some(item => item.rawAmount === null)) return first
    const rawAmount = group.reduce((total, item) => total + item.rawAmount, 0n)
    return {
        ...first,
        rawAmount,
        amount: formatRawAmount(rawAmount, first.token),
    }
}

function netFlows(transfers) {
    const groups = new Map()
    for (const transfer of transfers) {
        const identity = tokenIdentity(transfer.token)
        if (!identity || !transfer.direction || transfer.rawAmount === 0n) continue
        groups.set(identity, [...(groups.get(identity) ?? []), transfer])
    }
    return [...groups.values()].flatMap(group => {
        if (group.some(item => item.rawAmount === null)) return group
        const net = group.reduce((total, item) => total +
            (item.direction === 'incoming' ? 1n : -1n) * item.rawAmount, 0n)
        if (net === 0n) return []
        const direction = net > 0n ? 'incoming' : 'outgoing'
        const first = group.find(item => item.direction === direction)
        if (!first) return []
        const rawAmount = net > 0n ? net : -net
        return [{
            ...first,
            direction,
            rawAmount,
            amount: formatRawAmount(rawAmount, first.token),
        }]
    })
}

export function receiptHasSwapEvidence(receipt) {
    return Array.isArray(receipt?.logs) && receipt.logs.some(log => {
        if (!isRecord(log) || !Array.isArray(log.topics)) return false
        return SWAP_EVENTS.has(String(log.topics[0] ?? '').toLowerCase())
    })
}

export function buildReceiptHistoryRow({
    chainId,
    walletAddress,
    transaction,
    receipt,
    indexedTransfers = [],
} = {}) {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet || !isRecord(transaction) || !isRecord(receipt)) return null

    const metadata = new Map()
    for (const item of indexedTransfers) {
        if (!isRecord(item)) continue
        const rawContract = isRecord(item.rawContract) ? item.rawContract : {}
        const address = normalizeAddress(rawContract.address)
        if (!address) continue
        const rawDecimals = uintValue(rawContract.decimal)
        metadata.set(address, {
            symbol: stringValue(item.asset, 24),
            decimals: rawDecimals !== null && rawDecimals <= 255n
                ? Number(rawDecimals)
                : null,
        })
    }

    const erc20Transfers = []
    const logs = Array.isArray(receipt.logs) ? receipt.logs.filter(isRecord) : []
    for (const log of logs) {
        const topics = Array.isArray(log.topics) ? log.topics : []
        if (String(topics[0] ?? '').toLowerCase() !== TRANSFER_EVENT || topics.length !== 3) {
            continue
        }
        const from = normalizeAddress(`0x${String(topics[1] ?? '').slice(-40)}`)
        const to = normalizeAddress(`0x${String(topics[2] ?? '').slice(-40)}`)
        const rawAmount = uintValue(log.data)
        const address = normalizeAddress(log.address)
        if (!address || (from !== wallet && to !== wallet) || rawAmount === null || rawAmount === 0n) {
            continue
        }
        const tokenMetadata = metadata.get(address)
        const decimals = tokenMetadata?.decimals ?? null
        erc20Transfers.push({
            address,
            from_address: from,
            to_address: to,
            value: rawAmount.toString(),
            token_symbol: tokenMetadata?.symbol ?? null,
            token_decimals: decimals,
            value_formatted: decimals === null
                ? null
                : formatUnits(rawAmount, decimals),
        })
    }

    const nativeAmount = uintValue(transaction.value) ?? 0n
    const nativeTransfers = nativeAmount > 0n
        ? [{
            from_address: transaction.from,
            to_address: transaction.to,
            value: nativeAmount.toString(),
            value_formatted: formatUnits(nativeAmount, 18),
        }]
        : []
    const metadataEntry = indexedTransfers
        .map(item => isRecord(item) ? item.metadata : null)
        .find(isRecord)

    return {
        hash: String(transaction.hash ?? '').toLowerCase(),
        from_address: transaction.from,
        to_address: transaction.to,
        input: transaction.input,
        value: nativeAmount.toString(),
        block_number: uintValue(transaction.blockNumber)?.toString() ?? null,
        block_timestamp: stringValue(metadataEntry?.blockTimestamp, 50),
        receipt_status: uintValue(receipt.status)?.toString() ?? '0',
        authorization_list: transaction.authorizationList,
        erc20_transfers: erc20Transfers,
        native_transfers: nativeTransfers,
        category: 'contract interaction',
        provider: 'alchemy-browser',
        swap_evidence: receiptHasSwapEvidence(receipt),
        contract_interactions: [...new Set(logs
            .map(log => normalizeAddress(log.address))
            .filter(Boolean))],
    }
}

function decodeApprovalActivity({ chainId, wallet, value, hash, timestamp }) {
    const from = normalizeAddress(value.from_address)
    const tokenAddress = normalizeAddress(value.to_address)
    const input = stringValue(value.input, 4_096)
    if (from !== wallet || !tokenAddress || !input || !isHex(input) || input.length < 10) {
        return null
    }
    try {
        const decoded = decodeFunctionData({ abi: erc20ApproveAbi, data: input })
        if (decoded.functionName !== 'approve') return null
        const [spender, amountRaw] = decoded.args
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'approved',
            chainId,
            hash,
            timestamp,
            token: tokenForAddress(chainId, tokenAddress),
            amount: null,
            recipient: normalizeAddress(spender),
            approvalAmountRaw: amountRaw === UINT256_MAX ? null : amountRaw.toString(),
        }
    } catch {
        return null
    }
}

function decodeGasAssistActivity({
    chainId,
    wallet,
    value,
    hash,
    timestamp,
    outgoing,
    incoming,
}) {
    if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
    const to = normalizeAddress(value.to_address)
    const directKnownContract = isKnownPistachioBscContract(to)
    const delegatedSelfCall = to === wallet && hasKnownPistachioAuthorization(value)
    if (!directKnownContract && !delegatedSelfCall) return null

    const input = stringValue(value.input, 200_000)
    if (!input || !isHex(input) || input.length < 10) return null

    try {
        const decoded = decodeFunctionData({ abi: gasAssistAtomicExecutorAbi, data: input })
        if (decoded.functionName !== 'executeAtomicSwap') return null
        const [, , , rawSellToken, swapAmount, rawBuyToken] = decoded.args
        const sellAddress = normalizeAddress(rawSellToken)
        const buyAddress = normalizeAddress(rawBuyToken)
        if (!sellAddress || !buyAddress || swapAmount <= 0n) return null

        const anySell = exactTransfer(outgoing, sellAddress, swapAmount) ??
            exactTransfer(outgoing, sellAddress)
        const buyTransfer = exactTransfer(incoming, buyAddress)
        if (!anySell || !buyTransfer ||
            !differentAssets(chainId, anySell.token, buyTransfer.token)) {
            return null
        }

        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken: anySell.token,
            buyToken: buyTransfer.token,
            sellAmount: formatRawAmount(swapAmount, anySell.token) ?? anySell.amount,
            buyAmount: buyTransfer.amount,
            recipient: wallet,
            provider: 'pistachio-gas-assist',
        }
    } catch {
        return null
    }
}

function inferKnownPistachioSwap({
    chainId,
    wallet,
    value,
    hash,
    timestamp,
    outgoing,
    incoming,
}) {
    if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
    const to = normalizeAddress(value.to_address)
    if (!isKnownPistachioBscContract(to) && !(to === wallet && hasKnownPistachioAuthorization(value))) {
        return null
    }

    const net = netFlows([...outgoing, ...incoming])
    const sell = singleTokenFlow(net.filter(item => item.direction === 'outgoing'))
    const buy = singleTokenFlow(net.filter(item => item.direction === 'incoming'))
    if (!sell || !buy || !differentAssets(chainId, sell.token, buy.token)) return null

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

export function classifyReceiptHistoryRow(chainId, walletAddress, value) {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet || !isRecord(value) || String(value.receipt_status ?? '0') !== '1') return null
    const hash = stringValue(value.hash, 66)?.toLowerCase()
    if (!hash || !/^0x[a-f0-9]{64}$/.test(hash)) return null

    const erc20 = Array.isArray(value.erc20_transfers)
        ? value.erc20_transfers.map(item => erc20Transfer(wallet, item)).filter(Boolean)
        : []
    const native = Array.isArray(value.native_transfers)
        ? value.native_transfers.map(item => nativeTransfer(chainId, wallet, item)).filter(Boolean)
        : []
    const transfers = [...erc20, ...native].filter(item =>
        item.rawAmount !== 0n && (item.rawAmount !== null || Number(item.amount) > 0))
    const outgoing = transfers.filter(item => item.direction === 'outgoing')
    const incoming = transfers.filter(item => item.direction === 'incoming')
    const from = normalizeAddress(value.from_address)
    const to = normalizeAddress(value.to_address)
    const timestamp = stringValue(value.block_timestamp, 50)

    let activity = decodeApprovalActivity({ chainId, wallet, value, hash, timestamp })
    if (!activity) {
        activity = decodeGasAssistActivity({
            chainId,
            wallet,
            value,
            hash,
            timestamp,
            outgoing,
            incoming,
        })
    }
    if (!activity) {
        activity = inferKnownPistachioSwap({
            chainId,
            wallet,
            value,
            hash,
            timestamp,
            outgoing,
            incoming,
        })
    }

    if (!activity && from === wallet && value.swap_evidence === true) {
        const net = netFlows(transfers)
        const sell = singleTokenFlow(net.filter(item => item.direction === 'outgoing'))
        const buy = singleTokenFlow(net.filter(item => item.direction === 'incoming'))
        if (sell && buy && differentAssets(chainId, sell.token, buy.token)) {
            activity = {
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
                provider: 'alchemy-browser',
            }
        }
    }

    if (!activity && from === wallet) {
        const transfer = dominantTransfer(outgoing)
        activity = {
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

    if (!activity && incoming.length > 0) {
        const transfer = dominantTransfer(incoming)
        activity = {
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

    if (!activity) return null

    const authorization = authorizationAddresses(value)
    const detectedContract = authorization.find(address =>
        KNOWN_PISTACHIO_BSC_CONTRACT_SET.has(address)) ??
        (activity.type === 'swapped' ? to : null)

    return {
        ...activity,
        source: 'remote',
        status: 'confirmed',
        blockNumber: String(value.block_number ?? ''),
        from,
        to,
        nativeValue: decimalValue(value.value),
        provider: activity.provider ?? value.provider ?? 'alchemy-browser',
        providerType: stringValue(value.category, 60),
        detectedContract,
        classificationReason: activity.type === 'swapped'
            ? 'Successful receipt with distinct outgoing and incoming assets and swap evidence'
            : activity.type === 'approved'
                ? 'ERC-20 approval calldata'
                : activity.type === 'sent'
                    ? 'Wallet-initiated outgoing asset movement'
                    : activity.type === 'received'
                        ? 'Incoming asset movement to the wallet'
                        : 'Wallet-initiated contract call without confirmed swap flows',
    }
}

export const walletHistoryClassifierInternals = {
    TRANSFER_EVENT,
    SWAP_EVENTS,
    differentAssets,
    netFlows,
    normalizeAddress,
    uintValue,
}
