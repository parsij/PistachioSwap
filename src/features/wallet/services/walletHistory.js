import {
    buildReceiptHistoryRow,
    classifyReceiptHistoryRow,
    WALLET_HISTORY_CLASSIFIER_VERSION,
} from './walletHistoryClassifier.js'
import {
    readWalletHistoryCache,
    writeWalletHistoryCache,
} from './walletHistoryCache.js'

export const DIRECT_WALLET_HISTORY_CHAIN_IDS = Object.freeze([
    1,
    10,
    56,
    100,
    137,
    8453,
    42161,
    43114,
    59144,
])

const ALCHEMY_ENDPOINTS = Object.freeze({
    1: 'https://eth-mainnet.g.alchemy.com/v2',
    10: 'https://opt-mainnet.g.alchemy.com/v2',
    56: 'https://bnb-mainnet.g.alchemy.com/v2',
    100: 'https://gnosis-mainnet.g.alchemy.com/v2',
    137: 'https://polygon-mainnet.g.alchemy.com/v2',
    8453: 'https://base-mainnet.g.alchemy.com/v2',
    42161: 'https://arb-mainnet.g.alchemy.com/v2',
    43114: 'https://avax-mainnet.g.alchemy.com/v2',
    59144: 'https://linea-mainnet.g.alchemy.com/v2',
})

const REFRESH_TTL_MS = 10 * 60 * 1000
const REORG_BUFFER_BLOCKS = 64
const MAX_TRANSFER_PAGES = 5
const TRANSFER_PAGE_SIZE_HEX = '0x64'
const MAX_CACHED_ACTIVITIES = 200
const HYDRATION_BATCH_SIZE = 8

function viteEnv() {
    return import.meta.env ?? {}
}

function normalizeWalletAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function normalizeChainIds(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map(Number)
        .filter(value => DIRECT_WALLET_HISTORY_CHAIN_IDS.includes(value)))]
        .slice(0, DIRECT_WALLET_HISTORY_CHAIN_IDS.length)
}

function alchemyEndpoint(chainId) {
    return ALCHEMY_ENDPOINTS[Number(chainId)] ?? null
}

function keyFromConfiguredRpc(chainId) {
    const env = viteEnv()
    const configured = Number(chainId) === 56
        ? env.VITE_BSC_PUBLIC_RPC_URL
        : env[`VITE_EVM_${Number(chainId)}_PUBLIC_RPC_URL`]
    const text = String(configured ?? '').trim()
    if (!text) return null
    try {
        const url = new URL(text)
        const expected = new URL(alchemyEndpoint(chainId))
        if (url.origin !== expected.origin) return null
        const match = url.pathname.match(/^\/v2\/([^/]+)\/?$/)
        return match?.[1] ? decodeURIComponent(match[1]) : null
    } catch {
        return null
    }
}

function configuredAlchemyKey(chainId) {
    const env = viteEnv()
    const perChain = String(
        env[`VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_${Number(chainId)}`] ?? '',
    ).trim()
    const shared = String(env.VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY ?? '').trim()
    return perChain || shared || keyFromConfiguredRpc(chainId)
}

function sleep(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, milliseconds)
        if (!signal) return
        const abort = () => {
            clearTimeout(timeout)
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
    })
}

async function alchemyFetch(chainId, body, { signal } = {}) {
    const endpoint = alchemyEndpoint(chainId)
    const apiKey = configuredAlchemyKey(chainId)
    if (!endpoint || !apiKey) {
        throw new Error('Direct wallet history is not configured for this network.')
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(endpoint, {
            method: 'POST',
            cache: 'no-store',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
        })

        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
            await sleep(350, signal)
            continue
        }
        if (!response.ok) {
            throw new Error(`Direct wallet history provider returned HTTP ${response.status}.`)
        }

        const payload = await response.json().catch(() => null)
        if (!payload) throw new Error('Direct wallet history response was invalid.')
        return payload
    }
    throw new Error('Direct wallet history provider is unavailable.')
}

async function alchemyRpc(chainId, method, params, { signal } = {}) {
    const payload = await alchemyFetch(chainId, {
        jsonrpc: '2.0',
        id: `${method}:${Date.now()}:${Math.random()}`,
        method,
        params,
    }, { signal })
    if (payload.error || !('result' in payload)) {
        throw new Error(payload.error?.message || 'Direct wallet history RPC failed.')
    }
    return payload.result
}

async function alchemyRpcBatch(chainId, requests, { signal } = {}) {
    if (!Array.isArray(requests) || requests.length === 0) return new Map()
    const payload = await alchemyFetch(chainId, requests.map(request => ({
        jsonrpc: '2.0',
        ...request,
    })), { signal })
    if (!Array.isArray(payload)) throw new Error('Direct wallet history batch response was invalid.')
    return new Map(payload.map(item => [String(item?.id), item]))
}

function blockNumber(value) {
    const text = String(value ?? '').trim()
    if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(text)) return null
    try {
        const number = Number(BigInt(text))
        return Number.isSafeInteger(number) ? number : null
    } catch {
        return null
    }
}

function blockTag(value) {
    return `0x${BigInt(Math.max(0, Number(value) || 0)).toString(16)}`
}

async function transferStream({
    chainId,
    walletAddress,
    direction,
    category,
    fromBlock,
    signal,
}) {
    const transfers = []
    const seenPageKeys = new Set()
    let pageKey
    let truncated = false

    for (let page = 0; page < MAX_TRANSFER_PAGES; page += 1) {
        const params = {
            fromBlock: blockTag(fromBlock),
            toBlock: 'latest',
            [direction]: walletAddress,
            category: [category],
            excludeZeroValue: false,
            withMetadata: true,
            order: 'desc',
            maxCount: TRANSFER_PAGE_SIZE_HEX,
            ...(pageKey ? { pageKey } : {}),
        }
        const result = await alchemyRpc(chainId, 'alchemy_getAssetTransfers', [params], { signal })
        if (!result || !Array.isArray(result.transfers)) {
            throw new Error('Direct wallet history transfer response was invalid.')
        }
        transfers.push(...result.transfers)

        if (!result.pageKey) break
        if (typeof result.pageKey !== 'string' || seenPageKeys.has(result.pageKey)) {
            throw new Error('Direct wallet history pagination was invalid.')
        }
        seenPageKeys.add(result.pageKey)
        pageKey = result.pageKey
        if (page === MAX_TRANSFER_PAGES - 1) truncated = true
    }
    return { transfers, truncated }
}

async function discoverTransfers({ chainId, walletAddress, fromBlock, signal }) {
    const streams = await Promise.all([
        ['fromAddress', 'external'],
        ['fromAddress', 'erc20'],
        ['toAddress', 'external'],
        ['toAddress', 'erc20'],
    ].map(([direction, category]) => transferStream({
        chainId,
        walletAddress,
        direction,
        category,
        fromBlock,
        signal,
    })))

    const unique = new Map()
    for (const { transfers } of streams) {
        for (const transfer of transfers) {
            const hash = String(transfer?.hash ?? '').toLowerCase()
            if (!/^0x[a-f0-9]{64}$/.test(hash)) continue
            const identity = String(transfer?.uniqueId ?? [
                hash,
                transfer?.category,
                transfer?.from,
                transfer?.to,
                transfer?.value,
                transfer?.blockNum,
            ].join(':'))
            unique.set(identity, transfer)
        }
    }
    return {
        transfers: [...unique.values()],
        truncated: streams.some(stream => stream.truncated),
    }
}

function groupTransfersByHash(transfers) {
    const groups = new Map()
    for (const transfer of transfers) {
        const hash = String(transfer?.hash ?? '').toLowerCase()
        if (!/^0x[a-f0-9]{64}$/.test(hash)) continue
        groups.set(hash, [...(groups.get(hash) ?? []), transfer])
    }
    return [...groups.entries()].sort((left, right) => {
        const leftBlock = Math.max(...left[1].map(item => blockNumber(item?.blockNum) ?? 0))
        const rightBlock = Math.max(...right[1].map(item => blockNumber(item?.blockNum) ?? 0))
        return rightBlock - leftBlock
    })
}

async function hydrateActivities({ chainId, walletAddress, transfers, signal }) {
    const entries = groupTransfersByHash(transfers).slice(0, MAX_CACHED_ACTIVITIES)
    const activities = []
    let partial = false

    for (let offset = 0; offset < entries.length; offset += HYDRATION_BATCH_SIZE) {
        const batch = entries.slice(offset, offset + HYDRATION_BATCH_SIZE)
        const requests = batch.flatMap(([hash]) => [
            { id: `${hash}:tx`, method: 'eth_getTransactionByHash', params: [hash] },
            { id: `${hash}:receipt`, method: 'eth_getTransactionReceipt', params: [hash] },
        ])
        const responses = await alchemyRpcBatch(chainId, requests, { signal })

        for (const [hash, indexedTransfers] of batch) {
            const transaction = responses.get(`${hash}:tx`)
            const receipt = responses.get(`${hash}:receipt`)
            if (transaction?.error || receipt?.error ||
                !transaction?.result || !receipt?.result) {
                partial = true
                continue
            }
            const row = buildReceiptHistoryRow({
                chainId,
                walletAddress,
                transaction: transaction.result,
                receipt: receipt.result,
                indexedTransfers,
            })
            const activity = row
                ? classifyReceiptHistoryRow(chainId, walletAddress, row)
                : null
            if (activity) activities.push(activity)
        }
    }
    return { activities, partial }
}

function activityBlockNumber(activity) {
    const value = Number(activity?.blockNumber)
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function sortActivities(items) {
    return [...items].sort((left, right) => {
        const timestampDifference = Date.parse(right.timestamp ?? '') - Date.parse(left.timestamp ?? '')
        if (Number.isFinite(timestampDifference) && timestampDifference !== 0) {
            return timestampDifference
        }
        return activityBlockNumber(right) - activityBlockNumber(left)
    })
}

function mergeRefreshedActivities(cached, refreshed, fromBlock) {
    const merged = new Map()
    for (const activity of cached ?? []) {
        if (activityBlockNumber(activity) < fromBlock && activity?.hash) {
            merged.set(String(activity.hash).toLowerCase(), activity)
        }
    }
    for (const activity of refreshed) {
        if (activity?.hash) merged.set(String(activity.hash).toLowerCase(), activity)
    }
    return sortActivities([...merged.values()]).slice(0, MAX_CACHED_ACTIVITIES)
}

function cacheIsCurrent(record) {
    return record?.classifierVersion === WALLET_HISTORY_CLASSIFIER_VERSION &&
        Array.isArray(record.activities)
}

function cacheIsFresh(record, now = Date.now()) {
    return cacheIsCurrent(record) &&
        Number.isFinite(Number(record.lastRefreshAt)) &&
        now - Number(record.lastRefreshAt) >= 0 &&
        now - Number(record.lastRefreshAt) < REFRESH_TTL_MS
}

async function refreshChainHistory({ chainId, walletAddress, force, signal }) {
    const cached = await readWalletHistoryCache({ walletAddress, chainId })
    if (!force && cacheIsFresh(cached)) {
        return {
            items: cached.activities,
            source: 'indexeddb-cache',
            truncated: cached.truncated === true,
            refreshed: false,
        }
    }

    const latestBlock = blockNumber(await alchemyRpc(chainId, 'eth_blockNumber', [], { signal }))
    if (latestBlock === null) throw new Error('Direct wallet history block height was invalid.')

    const previousBlock = cacheIsCurrent(cached)
        ? Number(cached.lastScannedBlock) || 0
        : 0
    const fromBlock = previousBlock > 0
        ? Math.max(0, previousBlock - REORG_BUFFER_BLOCKS)
        : 0

    const discovery = await discoverTransfers({
        chainId,
        walletAddress,
        fromBlock,
        signal,
    })
    const hydrated = await hydrateActivities({
        chainId,
        walletAddress,
        transfers: discovery.transfers,
        signal,
    })
    const items = mergeRefreshedActivities(
        cacheIsCurrent(cached) ? cached.activities : [],
        hydrated.activities,
        fromBlock,
    )
    const truncated = discovery.truncated || hydrated.partial

    await writeWalletHistoryCache({
        walletAddress,
        chainId,
        activities: items,
        lastScannedBlock: latestBlock,
        lastRefreshAt: Date.now(),
        classifierVersion: WALLET_HISTORY_CLASSIFIER_VERSION,
        truncated,
    })

    return {
        items,
        source: 'alchemy-browser',
        truncated,
        refreshed: true,
    }
}

export async function readCachedWalletHistory({
    walletAddress,
    chainIds,
    limit = 50,
} = {}) {
    const wallet = normalizeWalletAddress(walletAddress)
    if (!wallet) return { items: [], partial: false, coverage: [] }
    const normalizedChainIds = normalizeChainIds(chainIds)
    const records = await Promise.all(normalizedChainIds.map(async chainId => ({
        chainId,
        record: await readWalletHistoryCache({ walletAddress: wallet, chainId }),
    })))
    const coverage = records.map(({ chainId, record }) => ({
        chainId,
        source: record ? 'indexeddb-cache' : 'none',
        truncated: record?.truncated === true,
        cached: Boolean(record),
    }))
    const items = sortActivities(records.flatMap(({ record }) =>
        cacheIsCurrent(record) ? record.activities : []))
        .slice(0, Math.max(1, Math.min(50, Number(limit) || 50)))
    return {
        items,
        partial: coverage.some(entry => entry.truncated),
        coverage,
    }
}

export async function fetchWalletHistory({
    walletAddress,
    chainIds,
    limit = 50,
    signal,
    force = false,
} = {}) {
    const wallet = normalizeWalletAddress(walletAddress)
    if (!wallet) throw new Error('A valid wallet address is required.')
    const normalizedChainIds = normalizeChainIds(chainIds)
    if (normalizedChainIds.length === 0) {
        return { items: [], partial: false, coverage: [] }
    }

    const settled = await Promise.allSettled(normalizedChainIds.map(async chainId => ({
        chainId,
        result: await refreshChainHistory({
            chainId,
            walletAddress: wallet,
            force,
            signal,
        }),
    })))

    const items = []
    const coverage = []
    let partial = false
    for (let index = 0; index < settled.length; index += 1) {
        const chainId = normalizedChainIds[index]
        const entry = settled[index]
        if (entry.status === 'fulfilled') {
            items.push(...entry.value.result.items)
            coverage.push({
                chainId,
                source: entry.value.result.source,
                truncated: entry.value.result.truncated,
                refreshed: entry.value.result.refreshed,
            })
            if (entry.value.result.truncated) partial = true
            continue
        }

        partial = true
        const cached = await readWalletHistoryCache({ walletAddress: wallet, chainId })
        if (cacheIsCurrent(cached)) items.push(...cached.activities)
        coverage.push({
            chainId,
            source: cacheIsCurrent(cached) ? 'indexeddb-cache' : 'unavailable',
            truncated: cached?.truncated === true,
            refreshed: false,
            error: 'Direct browser history unavailable',
        })
    }

    return {
        items: sortActivities(items)
            .slice(0, Math.max(1, Math.min(50, Number(limit) || 50))),
        partial,
        coverage,
        source: 'browser-direct',
    }
}

export const walletHistoryInternals = {
    ALCHEMY_ENDPOINTS,
    DIRECT_WALLET_HISTORY_CHAIN_IDS,
    HYDRATION_BATCH_SIZE,
    MAX_CACHED_ACTIVITIES,
    MAX_TRANSFER_PAGES,
    REFRESH_TTL_MS,
    REORG_BUFFER_BLOCKS,
    alchemyEndpoint,
    blockNumber,
    blockTag,
    cacheIsFresh,
    configuredAlchemyKey,
    groupTransfersByHash,
    keyFromConfiguredRpc,
    mergeRefreshedActivities,
    normalizeChainIds,
}
