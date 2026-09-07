import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { toEventSelector } from 'viem'
import { normalizeWalletActivity } from '../src/features/wallet/services/walletActivity.js'
import { mergeWalletActivity } from '../src/features/wallet/services/mergeWalletActivity.js'
import { filterVisibleActivity } from '../src/features/wallet/services/visibleWalletActivity.js'

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    output: { type: 'string' },
    api: { type: 'string', default: 'http://127.0.0.1:3006' },
    verify: { type: 'boolean', default: false },
    local: { type: 'string' },
} })
const wallet = (positionals[0] ?? '').toLowerCase()
const chainId = Number(positionals[1] ?? 56)
if (!/^0x[0-9a-f]{40}$/.test(wallet) || chainId !== 56) {
    throw new Error('Supply a wallet address and chain ID 56.')
}
const rpcUrl = process.env.ACTIVITY_DIAGNOSTIC_RPC_URL ?? process.env.BSC_RPC_URL ?? process.env.ALCHEMY_BSC_RPC_URL
async function rpc(method, params) {
    const response = await fetch(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
    })
    const payload = await response.json()
    if (!response.ok || payload.error) throw new Error(`RPC ${method} failed (HTTP ${response.status}, code ${payload.error?.code ?? 'unknown'}).`)
    return payload.result
}

try {
    if (Number(await rpc('eth_chainId', [])) !== chainId) throw new Error('RPC chain mismatch.')
    const transfers = new Map()
    let pages = 0
    for (const direction of ['fromAddress', 'toAddress']) {
        for (const category of ['external', 'erc20']) {
            let pageKey
            for (let page = 0; page < 10; page++) {
                const result = await rpc('alchemy_getAssetTransfers', [{
                    fromBlock: '0x0', toBlock: 'latest', [direction]: wallet,
                    category: [category], excludeZeroValue: false,
                    withMetadata: true, order: 'desc', maxCount: '0x64',
                    ...(pageKey ? { pageKey } : {}),
                }])
                pages++
                for (const transfer of result.transfers) transfers.set(transfer.uniqueId, transfer)
                if (!result.pageKey) break
                if (result.pageKey === pageKey || page === 9) throw new Error('Discovery pagination did not complete within the bound.')
                pageKey = result.pageKey
            }
        }
    }
    const hashes = [...new Set([...transfers.values()].map(item => item.hash))]
    const transactions = []
    for (const hash of hashes) {
        const [tx, receipt] = await Promise.all([
            rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash]),
        ])
        if (!tx || !receipt) throw new Error(`Missing chain receipt for ${hash}`)
        transactions.push({ tx, receipt, transfers: [...transfers.values()].filter(item => item.hash === hash) })
    }
    const url = new URL('/v1/wallet-activity', values.api)
    url.search = new URLSearchParams({ address: wallet, chainIds: String(chainId), limit: '50' })
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    const api = await response.json()
    const local = values.local ? JSON.parse(await readFile(values.local, 'utf8')).map(normalizeWalletActivity).filter(Boolean) : []
    if (local.some(item => item.walletAddress !== wallet)) throw new Error('Local history belongs to a different wallet.')
    const remote = (api.items ?? []).map(normalizeWalletActivity).filter(Boolean)
    const merged = mergeWalletActivity(local, remote, 50)
    const visible = filterVisibleActivity(merged)
    const transferTopic = toEventSelector('Transfer(address,address,uint256)')
    const swapTopics = new Set([
        toEventSelector('Swap(address,uint256,uint256,uint256,uint256,address)'),
        toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)'),
        toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)'),
    ])
    const table = transactions.map(({ tx, receipt }) => {
        const balances = new Map()
        for (const log of receipt.logs) {
            if (log.topics[0] !== transferTopic || log.topics.length !== 3) continue
            const from = `0x${log.topics[1].slice(-40)}`
            const to = `0x${log.topics[2].slice(-40)}`
            const delta = (to === wallet ? 1n : 0n) - (from === wallet ? 1n : 0n)
            balances.set(log.address, (balances.get(log.address) ?? 0n) + delta * BigInt(log.data))
        }
        const flow = [...balances.values()]
        const successful = receipt.status === '0x1'
        const swap = successful && tx.from === wallet && flow.some(x => x < 0n) && flow.some(x => x > 0n) && receipt.logs.some(log => swapTopics.has(log.topics[0]))
        const send = successful && tx.from === wallet && (tx.input.startsWith('0xa9059cbb') || tx.input === '0x') && (flow.some(x => x < 0n) || BigInt(tx.value) > 0n)
        const receive = successful && tx.from !== wallet && (tx.input.startsWith('0xa9059cbb') || tx.input === '0x') && (flow.some(x => x > 0n) || (tx.to === wallet && BigInt(tx.value) > 0n))
        const expected = swap ? 'swapped' : send ? 'sent' : receive ? 'received' : null
        const backend = remote.find(item => item.hash === tx.hash)
        const frontend = visible.find(item => item.hash === tx.hash)
        return { hash: tx.hash, chainExists: true, backendReturns: !!backend, frontendWouldShow: !!frontend,
            expectedType: expected ?? 'not independently asserted', actualType: backend?.type ?? 'MISSING', frontendType: frontend?.type ?? 'MISSING' }
    })
    const counts = visible.reduce((result, item) => ({ ...result, [item.type]: (result[item.type] ?? 0) + 1 }), {})
    const totals = { remoteFetched: remote.length, localFetched: local.length, merged: merged.length, visible: visible.length,
        swaps: counts.swapped ?? 0, sends: counts.sent ?? 0, receives: counts.received ?? 0, approvals: counts.approved ?? 0,
        contractInteractions: counts.contract ?? 0, unknown: counts.unknown ?? 0, duplicatesRemoved: local.length + remote.length - merged.length }
    const evidence = { wallet, chainId, pages, transactions, api, merged, visible, table, totals }
    if (values.output) await writeFile(values.output, JSON.stringify(evidence, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ wallet, pages, transfers: transfers.size, chainTransactions: hashes.length, apiStatus: response.status, partial: api.partial, coverage: api.coverage, totals }))
    for (const { tx, receipt, transfers: movements } of transactions) {
        console.log(JSON.stringify({ hash: tx.hash, block: Number(tx.blockNumber), timestamp: movements[0]?.metadata?.blockTimestamp,
            from: tx.from, to: tx.to, selector: tx.input?.slice(0, 10), status: receipt.status,
            authorization: tx.authorizationList?.map(item => item.address),
            ...table.find(item => item.hash === tx.hash),
            movements: movements.map(item => ({ from: item.from, to: item.to, asset: item.asset, raw: item.rawContract })),
        }))
    }
    for (const item of visible) console.log(JSON.stringify({ normalized: item }))
    if (values.verify) {
        if (!response.ok || api.partial || remote.length < 2) throw new Error('Activity API acceptance failed: unavailable, partial, or almost empty.')
        const expected = table.filter(item => item.expectedType !== 'not independently asserted')
        const missing = expected.filter(item => item.actualType !== item.expectedType || item.frontendType !== item.expectedType)
        if (missing.length) throw new Error(`Activity acceptance failed for ${missing.length} independently identified transactions.`)
        if (!expected.some(item => item.expectedType === 'swapped') || !expected.some(item => item.expectedType === 'sent')) throw new Error('No independently proven swaps/sends were discovered.')
        if (remote.some((item, index) => index && Date.parse(item.timestamp) > Date.parse(remote[index - 1].timestamp))) throw new Error('API ordering is incorrect.')
        console.log(`ACCEPTANCE PASS: ${expected.length} independently identified transactions retain their types through API, frontend merge and visibility filtering.`)
    }
} catch (error) {
    // Never print fetch errors, which can contain credential-bearing RPC URLs.
    console.error(error instanceof Error && !error.cause ? error.message : 'Wallet diagnostic failed.')
    process.exitCode = 1
}
