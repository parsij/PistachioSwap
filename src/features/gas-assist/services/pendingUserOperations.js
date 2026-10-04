const KEY = 'pistachioswap:pending-userops:v1'
const HASH = /^0x[0-9a-f]{64}$/iu
const ADDRESS = /^0x[0-9a-f]{40}$/iu

function normalize(value) {
    if (!value || typeof value.orderId !== 'string' || !value.orderId || value.orderId.length > 128 ||
        !HASH.test(value.userOpHash) || !ADDRESS.test(value.walletAddress) ||
        value.chainId !== 56 || !Number.isFinite(value.timestamp)) return null
    return {
        orderId: value.orderId, userOpHash: value.userOpHash.toLowerCase(),
        walletAddress: value.walletAddress.toLowerCase(), chainId: 56,
        timestamp: value.timestamp, ambiguous: value.ambiguous === true,
        routeId: typeof value.routeId === 'string' ? value.routeId.slice(0, 128) : null,
    }
}
export function pendingUserOperations(walletAddress) {
    try {
        const stored = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]')
        if (!Array.isArray(stored)) return []
        return stored.map(normalize).filter((item) => item &&
            (!walletAddress || item.walletAddress === walletAddress.toLowerCase()))
    } catch { return [] }
}
export function persistPendingUserOperation(value) {
    const record = normalize(value)
    if (!record) throw new Error('Invalid public operation recovery record.')
    const all = pendingUserOperations().filter((item) => item.orderId !== record.orderId)
    // Never evict an unresolved operation to make room for a new one.
    if (all.length >= 100) throw new Error('Resolve pending Gas Assist operations before submitting another.')
    globalThis.localStorage.setItem(KEY, JSON.stringify([...all, record]))
    return record
}
export function removePendingUserOperation(orderId) {
    try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify(
            pendingUserOperations().filter((item) => item.orderId !== orderId),
        ))
    } catch { /* Backend retains public state independently. */ }
}
