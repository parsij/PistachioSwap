const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_PENDING_AGE_MS = 30 * 60 * 1_000
const VALID_OPERATIONS = new Set(['sending', 'swapping'])

const pendingTransactions = new Map()
const listeners = new Set()
let revision = 0

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
    if (changed) notify()
}

export function beginOptimisticWalletTransaction({
    walletAddress,
    transactionHash,
    changes,
    operation,
} = {}) {
    pruneExpired()
    const wallet = normalizeAddress(walletAddress)
    const hash = normalizeHash(transactionHash)
    if (!wallet || !hash || !Array.isArray(changes)) return false

    const normalizedChanges = changes.flatMap((change) => {
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
            token: change?.token && typeof change.token === 'object'
                ? { ...change.token, chainId, address }
                : null,
        }]
    })

    if (normalizedChanges.length === 0) return false
    pendingTransactions.set(hash, {
        walletAddress: wallet,
        transactionHash: hash,
        changes: normalizedChanges,
        operation: operationForChanges(operation, normalizedChanges),
        createdAt: Date.now(),
    })
    notify()
    return true
}

export function finishOptimisticWalletTransaction(transactionHash) {
    const hash = normalizeHash(transactionHash)
    if (!hash || !pendingTransactions.delete(hash)) return false
    notify()
    return true
}

export function rollbackOptimisticWalletTransaction(transactionHash) {
    return finishOptimisticWalletTransaction(transactionHash)
}

export function subscribeOptimisticWalletBalances(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getOptimisticWalletBalanceRevision() {
    return revision
}

export function getOptimisticWalletTransactions(walletAddress) {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) return []
    return [...pendingTransactions.values()]
        .filter((transaction) => transaction.walletAddress === wallet)
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .map((transaction) => ({
            walletAddress: transaction.walletAddress,
            transactionHash: transaction.transactionHash,
            operation: transaction.operation,
            createdAt: transaction.createdAt,
            changes: transaction.changes.map((change) => ({ ...change })),
        }))
}

export function getOptimisticWalletDeltas(walletAddress) {
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
    MAX_PENDING_AGE_MS,
    normalizeAddress,
    normalizeHash,
    operationForChanges,
    tokenAddress,
}
