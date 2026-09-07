const DATABASE_NAME = 'pistachioswap-wallet-history'
const DATABASE_VERSION = 1
const STORE_NAME = 'walletChains'

function normalizeWalletAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function cacheKey(walletAddress, chainId) {
    const wallet = normalizeWalletAddress(walletAddress)
    const normalizedChainId = Number(chainId)
    if (!wallet || !Number.isSafeInteger(normalizedChainId) || normalizedChainId <= 0) {
        return null
    }
    return `${normalizedChainId}:${wallet}`
}

function indexedDb() {
    try {
        return globalThis.indexedDB ?? null
    } catch {
        return null
    }
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
    })
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    })
}

async function openDatabase() {
    const factory = indexedDb()
    if (!factory) return null

    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
    }
    return requestResult(request)
}

export async function readWalletHistoryCache({ walletAddress, chainId } = {}) {
    const key = cacheKey(walletAddress, chainId)
    if (!key) return null

    let database
    try {
        database = await openDatabase()
        if (!database) return null
        const transaction = database.transaction(STORE_NAME, 'readonly')
        const done = transactionDone(transaction)
        const record = await requestResult(transaction.objectStore(STORE_NAME).get(key))
        await done
        if (!record || !Array.isArray(record.activities)) return null
        return record
    } catch {
        return null
    } finally {
        database?.close?.()
    }
}

export async function writeWalletHistoryCache({
    walletAddress,
    chainId,
    activities,
    lastScannedBlock,
    lastRefreshAt = Date.now(),
    classifierVersion,
    truncated = false,
} = {}) {
    const key = cacheKey(walletAddress, chainId)
    if (!key || !Array.isArray(activities)) return false

    let database
    try {
        database = await openDatabase()
        if (!database) return false
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        const done = transactionDone(transaction)
        transaction.objectStore(STORE_NAME).put({
            key,
            walletAddress: normalizeWalletAddress(walletAddress),
            chainId: Number(chainId),
            activities,
            lastScannedBlock: Number.isSafeInteger(Number(lastScannedBlock))
                ? Number(lastScannedBlock)
                : 0,
            lastRefreshAt: Number.isFinite(Number(lastRefreshAt))
                ? Number(lastRefreshAt)
                : Date.now(),
            classifierVersion: Number(classifierVersion) || 0,
            truncated: truncated === true,
        })
        await done
        return true
    } catch {
        return false
    } finally {
        database?.close?.()
    }
}

export async function deleteWalletHistoryCache({ walletAddress, chainId } = {}) {
    const key = cacheKey(walletAddress, chainId)
    if (!key) return false

    let database
    try {
        database = await openDatabase()
        if (!database) return false
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        const done = transactionDone(transaction)
        transaction.objectStore(STORE_NAME).delete(key)
        await done
        return true
    } catch {
        return false
    } finally {
        database?.close?.()
    }
}

export const walletHistoryCacheInternals = {
    DATABASE_NAME,
    DATABASE_VERSION,
    STORE_NAME,
    cacheKey,
}
