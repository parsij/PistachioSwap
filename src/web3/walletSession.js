export const WALLET_SESSION_FLAG = 'pistachioswap.wallet-session'

function readItem(storage, key) {
    try {
        return storage?.getItem?.(key) ?? null
    } catch {
        return null
    }
}

function writeItem(storage, key, value) {
    try {
        storage?.setItem?.(key, value)
    } catch {
        // Private mode and quota errors must not break connect/disconnect.
    }
}

function removeItem(storage, key) {
    try {
        storage?.removeItem?.(key)
    } catch {
        // See writeItem.
    }
}

function hasWagmiConnections(raw) {
    if (!raw) return false
    try {
        const parsed = JSON.parse(raw)
        const state = parsed?.state ?? parsed
        if (state?.current) return true
        const connections = state?.connections
        if (Array.isArray(connections)) return connections.length > 0
        if (Array.isArray(connections?.value)) return connections.value.length > 0
        if (connections && typeof connections === 'object') {
            return Object.keys(connections).length > 0
        }
    } catch {
        return String(raw).length > 2
    }
    return false
}

function hasAppKitSessionHint(storage) {
    try {
        const keys = typeof storage?.key === 'function' && typeof storage.length === 'number'
            ? Array.from({ length: storage.length }, (_, index) => storage.key(index))
            : []
        return keys.some((key) => (
            typeof key === 'string'
            && key.startsWith('@appkit/')
            && /(connected|connection|account|caip|connector)/i.test(key)
            && Boolean(readItem(storage, key))
        ))
    } catch {
        return false
    }
}

/**
 * True when a previous AppKit/Wagmi session should be restored on this visit.
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function hasPersistedWalletSession(storage = globalThis.localStorage) {
    if (!storage) return false
    if (readItem(storage, WALLET_SESSION_FLAG) === '1') return true
    if (hasWagmiConnections(readItem(storage, 'wagmi.store'))) return true
    return hasAppKitSessionHint(storage)
}

export function rememberWalletSession(storage = globalThis.localStorage) {
    writeItem(storage, WALLET_SESSION_FLAG, '1')
}

export function forgetWalletSession(storage = globalThis.localStorage) {
    removeItem(storage, WALLET_SESSION_FLAG)
}
