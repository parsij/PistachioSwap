import {
    buildReceiptHistoryRow,
    classifyReceiptHistoryRow,
} from './walletHistoryClassifier.js'

const PAGE_SIZE = 100
const MAX_PAGES = 5
const HYDRATION_BATCH_SIZE = 8
const MAX_ACTIVITIES = 200

function viteEnv() {
    return import.meta.env ?? {}
}

function normalizeWalletAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function normalizeHash(value) {
    const hash = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{64}$/.test(hash) ? hash : null
}

function safeNumber(value) {
    try {
        const number = typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)
            ? Number(BigInt(value))
            : Number(value)
        return Number.isSafeInteger(number) && number >= 0 ? number : null
    } catch {
        return null
    }
}

function isoTimestamp(value) {
    if (value == null || value === '') return null
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
        const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000
        const date = new Date(milliseconds)
        return Number.isFinite(date.getTime()) ? date.toISOString() : null
    }
    const parsed = Date.parse(String(value))
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export function configuredThirdwebClientId() {
    return String(viteEnv().VITE_WALLET_HISTORY_THIRDWEB_CLIENT_ID ?? '').trim()
}

export function thirdwebHistoryConfigured() {
    return configuredThirdwebClientId().length > 0
}

function insightOrigin(chainId) {
    return `https://${Number(chainId)}.insight.thirdweb.com`
}

function rpcUrl(chainId) {
    const clientId = configuredThirdwebClientId()
    if (!clientId) throw new Error('Thirdweb browser history is not configured.')
    return `https://${Number(chainId)}.rpc.thirdweb.com/${encodeURIComponent(clientId)}`
}

function abortError(signal) {
    return signal?.reason ?? new DOMException('Aborted', 'AbortError')
}

async function sleep(milliseconds, signal) {
    if (signal?.aborted) throw abortError(signal)
    await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds)
        signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(abortError(signal))
        }, { once: true })
    })
}

async function fetchJson(url, options, signal) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(url, { ...options, signal, cache: 'no-store' })
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
            await sleep(350, signal)
            continue
        }
        if (!response.ok) {
            throw new Error(`Thirdweb browser history returned HTTP ${response.status}.`)
        }
        const payload = await response.json().catch(() => null)
        if (!payload || typeof payload !== 'object') {
            throw new Error('Thirdweb browser history response was invalid.')
        }
        return payload
    }
    throw new Error('Thirdweb browser history is unavailable.')
}

async function insightRequest(chainId, path, query, signal) {
    const clientId = configuredThirdwebClientId()
    if (!clientId) throw new Error('Thirdweb browser history is not configured.')
    const url = new URL(path, insightOrigin(chainId))
    for (const [name, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(name, String(value))
        }
    }
    return fetchJson(url, {
        headers: {
            accept: 'application/json',
            'x-client-id': clientId,
        },
    }, signal)
}

async function thirdwebRpc(chainId, method, params, signal) {
    const payload = await fetchJson(rpcUrl(chainId), {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `${method}:${Date.now()}:${Math.random()}`,
            method,
            params,
        }),
    }, signal)
    if (payload.error || !Object.prototype.hasOwnProperty.call(payload, 'result')) {
        throw new Error(payload.error?.message || 'Thirdweb browser RPC failed.')
    }
    return payload.result
}

function pageInfo(payload) {
    const data = Array.isArray(payload?.data) ? payload.data : []
    const totalPages = safeNumber(payload?.meta?.total_pages ?? payload?.meta?.totalPages)
    return { data, totalPages }
}

async function pagedInsight({ chainId, path, query, signal }) {
    const rows = []
    let truncated = false
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const payload = await insightRequest(chainId, path, {
            ...query,
            page,
            limit: PAGE_SIZE,
        }, signal)
        const { data, totalPages } = pageInfo(payload)
        rows.push(...data)
        const hasNext = totalPages !== null
            ? page + 1 < totalPages
            : data.length >= PAGE_SIZE
        if (!hasNext) break
        if (page === MAX_PAGES - 1) truncated = true
    }
    return { rows, truncated }
}

function transactionHash(row) {
    return normalizeHash(
        row?.transaction_hash ?? row?.transactionHash ?? row?.hash,
    )
}

function rowBlockNumber(row) {
    return safeNumber(row?.block_number ?? row?.blockNumber ?? row?.block_num)
}

function metadataEvidence(row) {
    const timestamp = isoTimestamp(
        row?.block_timestamp ?? row?.blockTimestamp ?? row?.timestamp,
    )
    return timestamp ? { metadata: { blockTimestamp: timestamp } } : null
}

function metadataObject(row) {
    if (row?.token_metadata && typeof row.token_metadata === 'object') {
        return row.token_metadata
    }
    if (row?.metadata && typeof row.metadata === 'object') return row.metadata
    return {}
}

function tokenEvidence(row) {
    const token = row?.token && typeof row.token === 'object' ? row.token : {}
    const tokenMetadata = metadataObject(row)
    const address = String(
        row?.contract_address ?? row?.token_address ?? token.address ??
        tokenMetadata.address ?? tokenMetadata.contract_address ?? '',
    ).trim().toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(address)) return metadataEvidence(row)
    const decimals = row?.token_decimals ?? row?.decimals ?? token.decimals ??
        tokenMetadata.decimals
    const symbol = row?.token_symbol ?? row?.symbol ?? token.symbol ??
        tokenMetadata.symbol
    return {
        rawContract: {
            address,
            decimal: decimals == null ? null : String(decimals),
        },
        asset: typeof symbol === 'string' ? symbol : null,
        metadata: {
            blockTimestamp: isoTimestamp(
                row?.block_timestamp ?? row?.blockTimestamp ?? row?.timestamp,
            ),
        },
    }
}

function addEvidence(map, hash, evidence, blockNumber) {
    if (!hash) return
    const current = map.get(hash) ?? { hash, blockNumber: 0, indexedTransfers: [] }
    if (evidence) current.indexedTransfers.push(evidence)
    if (Number.isSafeInteger(blockNumber) && blockNumber > current.blockNumber) {
        current.blockNumber = blockNumber
    }
    map.set(hash, current)
}

async function discoverThirdwebEvidence({ chainId, walletAddress, fromBlock, signal }) {
    const wallet = normalizeWalletAddress(walletAddress)
    if (!wallet) throw new Error('A valid wallet address is required.')

    const [transactions, tokenTransfers] = await Promise.all([
        pagedInsight({
            chainId,
            path: `/v1/wallets/${wallet}/transactions`,
            query: {
                sort_by: 'block_number',
                sort_order: 'desc',
                ...(fromBlock > 0 ? { filter_block_number_gte: fromBlock } : {}),
            },
            signal,
        }),
        pagedInsight({
            chainId,
            path: '/v1/tokens/transfers',
            query: {
                owner_address: wallet,
                token_type: 'erc20',
                sort_order: 'desc',
                ...(fromBlock > 0 ? { block_number_from: fromBlock } : {}),
            },
            signal,
        }),
    ])

    const evidence = new Map()
    for (const row of transactions.rows) {
        addEvidence(
            evidence,
            transactionHash(row),
            metadataEvidence(row),
            rowBlockNumber(row),
        )
    }
    for (const row of tokenTransfers.rows) {
        addEvidence(
            evidence,
            transactionHash(row),
            tokenEvidence(row),
            rowBlockNumber(row),
        )
    }

    return {
        groups: [...evidence.values()]
            .sort((left, right) => right.blockNumber - left.blockNumber)
            .slice(0, MAX_ACTIVITIES),
        truncated: transactions.truncated || tokenTransfers.truncated,
    }
}

async function hydrateThirdwebActivities({ chainId, walletAddress, groups, signal }) {
    const activities = []
    let partial = false

    for (let offset = 0; offset < groups.length; offset += HYDRATION_BATCH_SIZE) {
        const batch = groups.slice(offset, offset + HYDRATION_BATCH_SIZE)
        const hydrated = await Promise.all(batch.map(async group => {
            try {
                const [transaction, receipt] = await Promise.all([
                    thirdwebRpc(chainId, 'eth_getTransactionByHash', [group.hash], signal),
                    thirdwebRpc(chainId, 'eth_getTransactionReceipt', [group.hash], signal),
                ])
                if (!transaction || !receipt) return null
                const row = buildReceiptHistoryRow({
                    chainId,
                    walletAddress,
                    transaction,
                    receipt,
                    indexedTransfers: group.indexedTransfers,
                    provider: 'thirdweb-browser',
                })
                return row
                    ? classifyReceiptHistoryRow(chainId, walletAddress, row)
                    : null
            } catch {
                partial = true
                return null
            }
        }))
        activities.push(...hydrated.filter(Boolean))
    }

    return { activities, partial }
}

export async function fetchThirdwebChainActivities({
    chainId,
    walletAddress,
    fromBlock = 0,
    signal,
} = {}) {
    if (!thirdwebHistoryConfigured()) {
        throw new Error('Thirdweb browser history is not configured.')
    }
    const latestHex = await thirdwebRpc(chainId, 'eth_blockNumber', [], signal)
    const latestBlock = safeNumber(latestHex)
    if (latestBlock === null) throw new Error('Thirdweb browser block height was invalid.')

    const discovery = await discoverThirdwebEvidence({
        chainId,
        walletAddress,
        fromBlock,
        signal,
    })
    const hydrated = await hydrateThirdwebActivities({
        chainId,
        walletAddress,
        groups: discovery.groups,
        signal,
    })

    return {
        activities: hydrated.activities,
        latestBlock,
        truncated: discovery.truncated || hydrated.partial,
        source: 'thirdweb-browser',
    }
}

export const thirdwebWalletHistoryInternals = {
    HYDRATION_BATCH_SIZE,
    MAX_ACTIVITIES,
    MAX_PAGES,
    PAGE_SIZE,
    configuredThirdwebClientId,
    insightOrigin,
    isoTimestamp,
    metadataObject,
    normalizeHash,
    pageInfo,
    rpcUrl,
    safeNumber,
    thirdwebHistoryConfigured,
    tokenEvidence,
    transactionHash,
}
