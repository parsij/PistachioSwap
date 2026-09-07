import { formatUnits, toEventSelector } from 'viem'
import { alchemyRpc, alchemyRpcBatch, type JsonRpcRequest } from './alchemy-client.js'
import { isRecord } from '../../lib/http.js'
import { normalizeAddress } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'

const TRANSFER = toEventSelector('Transfer(address,address,uint256)')
const SWAP_EVENTS = new Set<string>([
    toEventSelector('Swap(address,uint256,uint256,uint256,uint256,address)'),
    toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)'),
    toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)'),
])
const MAX_PAGES = 5
const MAX_TRANSACTIONS = 200

export function receiptHasSwapEvidence(receipt: Record<string, unknown>) {
    return Array.isArray(receipt.logs) && receipt.logs.filter(isRecord).some(log =>
        Array.isArray(log.topics) && SWAP_EVENTS.has(String(log.topics[0])))
}

function invalid() {
    return new ProviderError({ code: 'ACTIVITY_PROVIDER_INVALID', message: 'Wallet history provider returned incomplete data.' })
}

function uint(value: unknown) {
    if (typeof value !== 'string' || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(value)) return null
    return BigInt(value)
}

// Adapt receipt-backed Alchemy history into the existing history normalizer's
// transaction/transfer input. Never use the transfer API's floating-point value.
export function receiptHistoryRow(
    tx: Record<string, unknown>, receipt: Record<string, unknown>,
    indexed: Record<string, unknown>[], wallet: string,
) {
    const metadata = new Map(indexed.flatMap(item => {
        const raw = isRecord(item.rawContract) ? item.rawContract : {}
        const address = normalizeAddress(raw.address)
        return address ? [[address, { symbol: item.asset, decimals: uint(raw.decimal) }] as const] : []
    }))
    const erc20: Record<string, unknown>[] = []
    const logs = Array.isArray(receipt.logs) ? receipt.logs.filter(isRecord) : []
    for (const log of logs) {
        const topics = Array.isArray(log.topics) ? log.topics : []
        if (topics[0] !== TRANSFER || topics.length !== 3) continue
        const from = normalizeAddress(`0x${String(topics[1]).slice(-40)}`)
        const to = normalizeAddress(`0x${String(topics[2]).slice(-40)}`)
        const amount = uint(log.data)
        if ((from !== wallet && to !== wallet) || amount === null || amount === 0n) continue
        const address = normalizeAddress(log.address)
        const meta = address ? metadata.get(address) : null
        const decimals = meta?.decimals != null && meta.decimals <= 255n ? Number(meta.decimals) : null
        erc20.push({ address, from_address: from, to_address: to,
            value: amount.toString(), token_symbol: meta?.symbol ?? null,
            token_decimals: decimals,
            value_formatted: decimals === null ? null : formatUnits(amount, decimals),
        })
    }
    const amount = uint(tx.value) ?? 0n
    const native = amount > 0n ? [{ from_address: tx.from, to_address: tx.to,
        value: amount.toString(), value_formatted: formatUnits(amount, 18) }] : []
    const firstMetadata = indexed.map(item => item.metadata).find(isRecord)
    return {
        hash: tx.hash, from_address: tx.from, to_address: tx.to, input: tx.input,
        value: amount.toString(), block_number: uint(tx.blockNumber)?.toString(),
        block_timestamp: firstMetadata?.blockTimestamp,
        receipt_status: uint(receipt.status)?.toString() ?? '0',
        authorization_list: tx.authorizationList,
        erc20_transfers: erc20, native_transfers: native,
        category: 'contract interaction', provider: 'alchemy-receipts',
        swap_evidence: receiptHasSwapEvidence(receipt),
        contract_interactions: [...new Set(logs.map(log => normalizeAddress(log.address)).filter(Boolean))],
    }
}

export async function alchemyWalletHistoryRequest({ chainId, walletAddress }: {
    chainId: number; walletAddress: string
}) {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) throw invalid()
    const indexed = new Map<string, Record<string, unknown>>()
    let truncated = false
    let pages = 0
    // Separate zero-value contract calls from token logs so transfer spam cannot
    // consume the entire discovery budget before approvals/swaps are discovered.
    for (const direction of ['fromAddress', 'toAddress']) {
        for (const category of ['external', 'erc20']) {
            let pageKey: string | undefined
            const seen = new Set<string>()
            for (let page = 0; page < MAX_PAGES; page++) {
                const payload = await alchemyRpc({ jsonrpc: '2.0', id: 1,
                    method: 'alchemy_getAssetTransfers', params: [{
                        fromBlock: '0x0', toBlock: 'latest', [direction]: wallet,
                        category: [category], excludeZeroValue: false,
                        withMetadata: true, order: 'desc', maxCount: '0x64',
                        ...(pageKey ? { pageKey } : {}),
                    }],
                }, undefined, chainId)
                if (!isRecord(payload) || !Array.isArray(payload.transfers)) throw invalid()
                pages++
                for (const item of payload.transfers.filter(isRecord)) {
                    if (typeof item.uniqueId !== 'string') throw invalid()
                    indexed.set(item.uniqueId, item)
                }
                if (!payload.pageKey) break
                if (typeof payload.pageKey !== 'string' || seen.has(payload.pageKey)) throw invalid()
                pageKey = payload.pageKey
                seen.add(pageKey)
                if (page === MAX_PAGES - 1) truncated = true
            }
        }
    }
    const groups = new Map<string, Record<string, unknown>[]>()
    for (const item of indexed.values()) {
        const hash = String(item.hash).toLowerCase()
        if (!/^0x[0-9a-f]{64}$/.test(hash)) throw invalid()
        groups.set(hash, [...(groups.get(hash) ?? []), item])
    }
    const entries = [...groups.entries()].sort((a, b) => Number(b[1][0].blockNum) - Number(a[1][0].blockNum))
    if (entries.length > MAX_TRANSACTIONS) truncated = true
    const rows = []
    for (let offset = 0; offset < Math.min(entries.length, MAX_TRANSACTIONS); offset += 5) {
        const batch = entries.slice(offset, Math.min(offset + 5, MAX_TRANSACTIONS))
        const requests: JsonRpcRequest[] = batch.flatMap(([hash]) => [
            { jsonrpc: '2.0', id: `${hash}:tx`, method: 'eth_getTransactionByHash', params: [hash] },
            { jsonrpc: '2.0', id: `${hash}:receipt`, method: 'eth_getTransactionReceipt', params: [hash] },
        ])
        const responses = await alchemyRpcBatch(requests, undefined, chainId)
        for (const [hash, transfers] of batch) {
            const tx = responses.get(`${hash}:tx`)
            const receipt = responses.get(`${hash}:receipt`)
            if (tx?.error || receipt?.error || !isRecord(tx?.result) || !isRecord(receipt?.result)) throw invalid()
            rows.push(receiptHistoryRow(tx.result, receipt.result, transfers, wallet))
        }
    }
    return { result: rows, pages, truncated, source: 'alchemy-receipts',
        // BNB's transfer index does not cover internal-only native receipts.
        limitations: ['internal-native-transfers-unavailable'],
    }
}
