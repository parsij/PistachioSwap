import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { recordWalletActivity } from './walletActivity.js'

const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
const STORAGE_KEY = 'pistachioswap:pending-wallet-operations:v1'
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1_000
const SETTLED_DISPLAY_MS = 2_200
const VALID_OPERATIONS = new Set(['sending', 'swapping'])
const VALID_SETTLEMENT_MODES = new Set(['receipt', 'external'])

const pendingTransactions = new Map()
const settledOperations = new Map()
const receiptChecks = new Map()
const listeners = new Set()
let revision = 0

function browserStorage() {
    try {
        return globalThis.localStorage ?? null
    } catch {
        return null
    }
}

function normalizeAddress(value) {
    const text = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(text) ? text : null
}

function normalizeHash(value) {
    const text = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{64}$/.test(text) ? text : null
}

function normalizeChainId(value) {
    const numeric = Number(value)
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function normalizeReferenceId(value) {
    const text = String(value ?? '').trim()
    return text && text.length <= 200 ? text : null
}

function tokenAddress(change) {
    if (change?.token?.isNative === true) return NATIVE_TOKEN_ADDRESS
    return normalizeAddress(change?.tokenAddress ?? change?.token?.address)
}

function operationForChanges(operation, changes) {
    const requested = String(operation ?? '').trim().toLowerCase()
    if (VALID_OPERATIONS.has(requested)) return requested
    return changes.some((change) => BigInt(change.deltaRaw) > 0n)
        ? 'swapping'
        : 'sending'
}

function settlementModeForChanges(mode, changes) {
    const requested = String(mode ?? '').trim().toLowerCase()
    if (VALID_SETTLEMENT_MODES.has(requested)) return requested
    const chainIds = new Set(changes.map((change) => change.chainId))
    return chainIds.size > 1 ? 'external' : 'receipt'
}

function formatRawAmount(rawValue, decimalsValue) {
    let raw
    try {
        raw = BigInt(rawValue)
    } catch {
        return null
    }
    const decimals = Number(decimalsValue)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null
    if (raw < 0n) raw = -raw
    if (decimals === 0) return raw.toString()
    const padded = raw.toString().padStart(decimals + 1, '0')
    const whole = padded.slice(0, -decimals)
    const fraction = padded.slice(-decimals).replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}

function normalizePersistedToken(token, chainId, address) {
    if (!token || typeof token !== 'object' || Array.isArray(token)) return null
    const decimals = Number(token.decimals)
    const logoCandidates = Array.isArray(token.logoCandidates)
        ? token.logoCandidates
            .filter((value) => typeof value === 'string' && value.length <= 500)
            .slice(0, 12)
        : []
    const text = (value, maximumLength) => {
        if (typeof value !== 'string') return null
        const normalized = value.trim()
        return normalized ? normalized.slice(0, maximumLength) : null
    }
    return {
        chainId,
        address,
        symbol: text(token.symbol, 24),
        name: text(token.name, 80),
        decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
            ? decimals
            : null,
        isNative: token.isNative === true || address === NATIVE_TOKEN_ADDRESS,
        logoURI: text(token.logoURI ?? token.logoUri, 500),
        logoCandidates,
    }
}

function normalizeChanges(changes) {
    if (!Array.isArray(changes)) return []
    return changes.flatMap((change) => {
        const chainId = normalizeChainId(change?.chainId)
        const address = tokenAddress(change)
        let deltaRaw
        try {
            deltaRaw = BigInt(change?.deltaRaw ?? 0)
        } catch {
            return []
        }
        if (!chainId || !address || deltaRaw === 0n) return []
        return [{
            chainId,
            tokenAddress: address,
            deltaRaw: deltaRaw.toString(),
            token: normalizePersistedToken(change?.token, chainId, address),
        }]
    })
}

function normalizeStoredTransaction(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const walletAddress = normalizeAddress(value.walletAddress)
    const transactionHash = normalizeHash(value.transactionHash)
    const createdAt = Number(value.createdAt)
    const changes = normalizeChanges(value.changes)
    if (
        !walletAddress ||
        !transactionHash ||
        !Number.isFinite(createdAt) ||
        createdAt <= 0 ||
        changes.length === 0
    ) return null
    return {
        walletAddress,
        transactionHash,
        changes,
        operation: operationForChanges(value.operation, changes),
        settlementMode: settlementModeForChanges(value.settlementMode, changes),
        referenceId: normalizeReferenceId(value.referenceId),
        createdAt,
    }
}

function persistPendingTransactions() {
    const storage = browserStorage()
    if (!storage) return
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify([...pendingTransactions.values()]))
    } catch {
        // Persistence is a convenience layer. Submission must never depend on it.
    }
}

function hydratePendingTransactions() {
    const storage = browserStorage()
    if (!storage) return
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
        if (!Array.isArray(parsed)) return
        const now = Date.now()
        for (const value of parsed) {
            const transaction = normalizeStoredTransaction(value)
            if (!transaction || now - transaction.createdAt > MAX_PENDING_AGE_MS) continue
            pendingTransactions.set(transaction.transactionHash, transaction)
        }
        persistPendingTransactions()
    } catch {
        try {
            storage.removeItem(STORAGE_KEY)
        } catch {
            // Ignore unavailable browser storage.
        }
    }
}

function publishSemanticActivity(transaction, status) {
    try {
        const tokenChanges = transaction.changes.filter((change) => change.token)
        if (transaction.operation === 'swapping') {
            const sell = tokenChanges.find((change) => BigInt(change.deltaRaw) < 0n)
            const buy = tokenChanges.find((change) => BigInt(change.deltaRaw) > 0n)
            if (!sell || !buy) return
            recordWalletActivity({
                walletAddress: transaction.walletAddress,
                chainId: sell.chainId,
                destinationChainId: buy.chainId,
                type: 'swapped',
                hash: transaction.transactionHash,
                sellToken: sell.token,
                buyToken: buy.token,
                sellAmount: formatRawAmount(sell.deltaRaw, sell.token.decimals),
                buyAmount: formatRawAmount(buy.deltaRaw, buy.token.decimals),
                recipient: transaction.walletAddress,
                status,
            })
            return
        }

        if (transaction.operation === 'sending') {
            const sent = tokenChanges.find((change) => BigInt(change.deltaRaw) < 0n)
            if (!sent) return
            recordWalletActivity({
                walletAddress: transaction.walletAddress,
                chainId: sent.chainId,
                type: 'sent',
                hash: transaction.transactionHash,
                token: sent.token,
                amount: formatRawAmount(sent.deltaRaw, sent.token.decimals),
                status,
            })
        }
    } catch {
        // Activity is presentation state. Never interfere with a submitted tx.
    }
}

function notify() {
    revision += 1
    for (const listener of listeners) listener()
}

function pruneExpired(now = Date.now()) {
    let changed = false
    for (const [hash, transaction] of pendingTransactions) {
        if (now - transaction.createdAt <= MAX_PENDING_AGE_MS) continue
        pendingTransactions.delete(hash)
        changed = true
    }
    if (changed) {
        persistPendingTransactions()
        notify()
    }
}

function transactionSourceChainId(transaction) {
    const outgoing = transaction?.changes?.find((change) => {
        try {
            return BigInt(change.deltaRaw) < 0n
        } catch {
            return false
        }
    })
    return outgoing?.chainId ?? transaction?.changes?.[0]?.chainId ?? null
}

function configuredRpcUrl(chainId) {
    const numericChainId = normalizeChainId(chainId)
    if (!numericChainId) return null
    const env = import.meta.env ?? {}
    const configured = numericChainId === 56
        ? env.VITE_BSC_PUBLIC_RPC_URL
        : env[`VITE_EVM_${numericChainId}_PUBLIC_RPC_URL`]
    const explicit = String(configured ?? '').trim()
    if (explicit) return explicit
    const chain = getCuratedEvmChain(numericChainId)
    return chain?.rpcUrls?.default?.http?.[0] ?? null
}

async function receiptStatus(transaction, signal) {
    const chainId = transactionSourceChainId(transaction)
    const rpcUrl = configuredRpcUrl(chainId)
    if (!rpcUrl) return 'pending'
    const response = await fetch(rpcUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `pending-wallet:${transaction.transactionHash}`,
            method: 'eth_getTransactionReceipt',
            params: [transaction.transactionHash],
        }),
        signal,
    })
    if (!response.ok) return 'pending'
    const payload = await response.json().catch(() => null)
    const status = String(payload?.result?.status ?? '').toLowerCase()
    if (status === '0x1' || status === '1') return 'confirmed'
    if (status === '0x0' || status === '0') return 'failed'
    return 'pending'
}

function scheduleSettledRemoval(transactionHash) {
    globalThis.setTimeout(() => {
        if (!settledOperations.delete(transactionHash)) return
        notify()
    }, SETTLED_DISPLAY_MS)
}

hydratePendingTransactions()

export function beginOptimisticWalletTransaction({
    walletAddress,
    transactionHash,
    changes,
    operation,
    settlementMode,
    referenceId,
} = {}) {
    pruneExpired()
    const wallet = normalizeAddress(walletAddress)
    const hash = normalizeHash(transactionHash)
    const normalizedChanges = normalizeChanges(changes)
    if (!wallet || !hash || normalizedChanges.length === 0) return false

    const transaction = {
        walletAddress: wallet,
        transactionHash: hash,
        changes: normalizedChanges,
        operation: operationForChanges(operation, normalizedChanges),
        settlementMode: settlementModeForChanges(settlementMode, normalizedChanges),
        referenceId: normalizeReferenceId(referenceId),
        createdAt: Date.now(),
    }
    settledOperations.delete(hash)
    pendingTransactions.set(hash, transaction)
    persistPendingTransactions()
    publishSemanticActivity(transaction, 'pending')
    notify()
    return true
}

function settleOptimisticWalletTransaction(transactionHash, status) {
    const hash = normalizeHash(transactionHash)
    if (!hash) return false
    const transaction = pendingTransactions.get(hash)
    if (!transaction || !pendingTransactions.delete(hash)) return false

    persistPendingTransactions()
    publishSemanticActivity(transaction, status)
    settledOperations.set(hash, {
        ...transaction,
        status,
        settledAt: Date.now(),
    })
    notify()
    scheduleSettledRemoval(hash)
    return true
}

export function finishOptimisticWalletTransaction(transactionHash) {
    return settleOptimisticWalletTransaction(transactionHash, 'confirmed')
}

export function rollbackOptimisticWalletTransaction(transactionHash) {
    return settleOptimisticWalletTransaction(transactionHash, 'failed')
}

export function subscribeOptimisticWalletBalances(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getOptimisticWalletBalanceRevision() {
    return revision
}

export function getOptimisticWalletTransactions(walletAddress) {
    pruneExpired()
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) return []
    return [...pendingTransactions.values()]
        .filter((transaction) => transaction.walletAddress === wallet)
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .map((transaction) => ({
            walletAddress: transaction.walletAddress,
            transactionHash: transaction.transactionHash,
            operation: transaction.operation,
            settlementMode: transaction.settlementMode,
            referenceId: transaction.referenceId,
            createdAt: transaction.createdAt,
            changes: transaction.changes.map((change) => ({ ...change })),
        }))
}

export function findOptimisticWalletTransaction({
    walletAddress,
    referenceId,
} = {}) {
    const wallet = normalizeAddress(walletAddress)
    const reference = normalizeReferenceId(referenceId)
    if (!wallet || !reference) return null
    return [...pendingTransactions.values()].find((transaction) =>
        transaction.walletAddress === wallet &&
        transaction.referenceId === reference) ?? null
}

export function getWalletOperationDisplayState(walletAddress) {
    pruneExpired()
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) return null
    const pending = [...pendingTransactions.values()]
        .filter((transaction) => transaction.walletAddress === wallet)
        .map((transaction) => ({
            ...transaction,
            status: 'pending',
            displayAt: transaction.createdAt,
        }))
    const settled = [...settledOperations.values()]
        .filter((transaction) => transaction.walletAddress === wallet)
        .map((transaction) => ({
            ...transaction,
            displayAt: transaction.settledAt,
        }))
    return [...pending, ...settled]
        .toSorted((left, right) => right.displayAt - left.displayAt)[0] ?? null
}

export async function reconcilePersistedWalletTransactions(walletAddress, { signal } = {}) {
    pruneExpired()
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) return
    const transactions = [...pendingTransactions.values()].filter((transaction) =>
        transaction.walletAddress === wallet &&
        transaction.settlementMode === 'receipt')

    await Promise.all(transactions.map(async (transaction) => {
        const existing = receiptChecks.get(transaction.transactionHash)
        if (existing) return existing
        const check = receiptStatus(transaction, signal)
            .then((status) => {
                if (status === 'confirmed') {
                    finishOptimisticWalletTransaction(transaction.transactionHash)
                } else if (status === 'failed') {
                    rollbackOptimisticWalletTransaction(transaction.transactionHash)
                }
            })
            .catch(() => undefined)
            .finally(() => receiptChecks.delete(transaction.transactionHash))
        receiptChecks.set(transaction.transactionHash, check)
        return check
    }))
}

export function getOptimisticWalletDeltas(walletAddress) {
    pruneExpired()
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) return []

    const merged = new Map()
    for (const transaction of pendingTransactions.values()) {
        if (transaction.walletAddress !== wallet) continue
        for (const change of transaction.changes) {
            const key = `${change.chainId}:${change.tokenAddress}`
            const current = merged.get(key)
            merged.set(key, {
                chainId: change.chainId,
                tokenAddress: change.tokenAddress,
                deltaRaw: ((current?.deltaRaw ?? 0n) + BigInt(change.deltaRaw)),
                token: current?.token ?? change.token ?? null,
            })
        }
    }

    return [...merged.values()].map((change) => ({
        ...change,
        deltaRaw: change.deltaRaw.toString(),
    }))
}

export function applyOptimisticRawBalance(rawBalance, deltaRaw) {
    try {
        const next = BigInt(rawBalance ?? 0) + BigInt(deltaRaw ?? 0)
        return next > 0n ? next : 0n
    } catch {
        return BigInt(rawBalance ?? 0)
    }
}

export const optimisticBalanceInternals = {
    NATIVE_TOKEN_ADDRESS,
    STORAGE_KEY,
    MAX_PENDING_AGE_MS,
    SETTLED_DISPLAY_MS,
    configuredRpcUrl,
    formatRawAmount,
    normalizeAddress,
    normalizeHash,
    operationForChanges,
    settlementModeForChanges,
    tokenAddress,
    transactionSourceChainId,
}
