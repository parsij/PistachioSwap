const STORAGE_KEY = 'pistachioswap:wallet-activity:v1'
const CHANGE_EVENT = 'pistachioswap:wallet-activity-change'
const MAX_ITEMS_PER_WALLET = 100
const VALID_TYPES = new Set([
    'swapped',
    'approved',
    'sent',
    'received',
    'contract',
])

function browserStorage() {
    try {
        return globalThis.localStorage ?? null
    } catch {
        return null
    }
}

function normalizeWalletAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function normalizeHash(value) {
    const hash = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{64}$/.test(hash) ? hash : null
}

function cleanText(value, maximumLength = 120) {
    const text = String(value ?? '').trim()
    return text ? text.slice(0, maximumLength) : null
}

function cleanAmount(value) {
    const text = String(value ?? '').trim()
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? text : null
}

function cleanToken(token) {
    if (!token || typeof token !== 'object' || Array.isArray(token)) return null
    const address = String(token.address ?? '').trim().toLowerCase()
    const validAddress = /^0x[a-f0-9]{40}$/.test(address) ? address : null

    return {
        address: validAddress,
        symbol: cleanText(token.symbol, 24),
        name: cleanText(token.name, 80),
        decimals: Number.isInteger(Number(token.decimals))
            ? Number(token.decimals)
            : null,
        isNative: token.isNative === true,
        logoURI:
            cleanText(
                token.logoURI ??
                token.logoUri ??
                token.logo ??
                token.thumbnail,
                500,
            ),
    }
}

function readStore() {
    const storage = browserStorage()
    if (!storage) return {}

    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {}
    } catch {
        return {}
    }
}

function writeStore(store) {
    const storage = browserStorage()
    if (!storage) return false

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(store))
        return true
    } catch {
        return false
    }
}

function createId(type, chainId, hash) {
    if (hash) return `${type}:${chainId}:${hash}`
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    return `${type}:${chainId}:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

function emitChange(walletAddress) {
    if (typeof globalThis.dispatchEvent !== 'function') return
    globalThis.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
        detail: { walletAddress },
    }))
}

function normalizeActivity(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null

    const walletAddress = normalizeWalletAddress(input.walletAddress)
    const type = VALID_TYPES.has(input.type) ? input.type : null
    const chainId = Number(input.chainId)
    const hash = normalizeHash(input.hash)
    const parsedTimestamp = Date.parse(input.timestamp ?? '')

    if (!walletAddress || !type || !Number.isSafeInteger(chainId) || chainId <= 0) {
        return null
    }

    return {
        id: cleanText(input.id, 180) ?? createId(type, chainId, hash),
        walletAddress,
        type,
        chainId,
        hash,
        timestamp: Number.isFinite(parsedTimestamp)
            ? new Date(parsedTimestamp).toISOString()
            : new Date().toISOString(),
        token: cleanToken(input.token),
        sellToken: cleanToken(input.sellToken),
        buyToken: cleanToken(input.buyToken),
        amount: cleanAmount(input.amount),
        sellAmount: cleanAmount(input.sellAmount),
        buyAmount: cleanAmount(input.buyAmount),
        recipient: normalizeWalletAddress(input.recipient),
        provider: cleanText(input.provider, 40),
    }
}

export function recordWalletActivity(input) {
    const activity = normalizeActivity(input)
    if (!activity) return null

    const store = readStore()
    const current = Array.isArray(store[activity.walletAddress])
        ? store[activity.walletAddress]
        : []
    const dedupeKey = activity.hash
        ? `${activity.type}:${activity.chainId}:${activity.hash}`
        : activity.id

    const next = [
        activity,
        ...current.filter((item) => {
            const itemKey = item?.hash
                ? `${item.type}:${item.chainId}:${String(item.hash).toLowerCase()}`
                : item?.id
            return itemKey !== dedupeKey
        }),
    ].slice(0, MAX_ITEMS_PER_WALLET)

    store[activity.walletAddress] = next
    if (writeStore(store)) emitChange(activity.walletAddress)
    return activity
}

export function readWalletActivity({
    walletAddress,
    limit = 50,
} = {}) {
    const normalizedAddress = normalizeWalletAddress(walletAddress)
    if (!normalizedAddress) return []

    const safeLimit = Number.isSafeInteger(Number(limit))
        ? Math.max(0, Math.min(MAX_ITEMS_PER_WALLET, Number(limit)))
        : 50
    const stored = readStore()[normalizedAddress]
    if (!Array.isArray(stored)) return []

    return stored
        .map(normalizeActivity)
        .filter(Boolean)
        .sort((left, right) =>
            Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, safeLimit)
}

export function subscribeWalletActivity(listener) {
    if (typeof listener !== 'function' ||
        typeof globalThis.addEventListener !== 'function') {
        return () => {}
    }

    const handleLocalChange = () => listener()
    const handleStorage = (event) => {
        if (event.key === STORAGE_KEY) listener()
    }

    globalThis.addEventListener(CHANGE_EVENT, handleLocalChange)
    globalThis.addEventListener('storage', handleStorage)

    return () => {
        globalThis.removeEventListener(CHANGE_EVENT, handleLocalChange)
        globalThis.removeEventListener('storage', handleStorage)
    }
}

export const walletActivityInternals = {
    CHANGE_EVENT,
    STORAGE_KEY,
    cleanToken,
    normalizeActivity,
    normalizeWalletAddress,
}
