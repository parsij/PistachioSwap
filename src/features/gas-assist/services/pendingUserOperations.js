const KEY = 'pistachioswap:pending-userops:v1'
const HASH = /^0x[0-9a-f]{64}$/iu
const ADDRESS = /^0x[0-9a-f]{40}$/iu

function safeLogoUri(value) {
    if (typeof value !== 'string') return null
    const uri = value.trim()
    // Images only. Never persist data:, javascript:, protocol-relative URLs,
    // or arbitrarily long untrusted values into a recoverable review.
    if (uri.length === 0 || uri.length > 1024 || /[\s\u0000-\u001f]/u.test(uri)) return null
    return /^https:\/\/[^/]+/iu.test(uri) || /^\/(?!\/)/u.test(uri) ? uri : null
}

function tokenDisplayIdentity(value, prefix) {
    const chainId = value[`${prefix}TokenChainId`]
    const address = value[`${prefix}TokenAddress`]
    if (!Number.isSafeInteger(chainId) || chainId <= 0 ||
        typeof address !== 'string' || !ADDRESS.test(address)) return {}
    const logoURI = safeLogoUri(value[`${prefix}TokenLogoURI`])
    return {
        [`${prefix}TokenChainId`]: chainId,
        [`${prefix}TokenAddress`]: address.toLowerCase(),
        ...(logoURI ? { [`${prefix}TokenLogoURI`]: logoURI } : {}),
    }
}

function validUnsigned(value) {
    return /^\d{1,80}$/.test(String(value ?? ''))
}

function displaySnapshot(value) {
    if (!value || typeof value !== 'object') return null
    const rawFields = ['grossInputAmountRaw', 'expectedOutputRaw', 'paymentAmountRaw']
    const decimalFields = ['sellTokenDecimals', 'buyTokenDecimals', 'paymentTokenDecimals']
    if (!rawFields.every(field => validUnsigned(value[field])) ||
        !decimalFields.every(field => Number.isInteger(value[field]) &&
            value[field] >= 0 && value[field] <= 255)) return null

    const symbol = (value) => {
        const text = String(value ?? '').trim()
        return /^[\p{L}\p{N}._$-]{1,32}$/u.test(text) ? text : 'Token'
    }
    return {
        grossInputAmountRaw: String(value.grossInputAmountRaw),
        expectedOutputRaw: String(value.expectedOutputRaw),
        paymentAmountRaw: String(value.paymentAmountRaw),
        sellTokenDecimals: value.sellTokenDecimals,
        buyTokenDecimals: value.buyTokenDecimals,
        paymentTokenDecimals: value.paymentTokenDecimals,
        sellTokenSymbol: symbol(value.sellTokenSymbol),
        buyTokenSymbol: symbol(value.buyTokenSymbol),
        paymentTokenSymbol: symbol(value.paymentTokenSymbol),
        ...tokenDisplayIdentity(value, 'sell'),
        ...tokenDisplayIdentity(value, 'buy'),
        totalPrepaymentUsdMicros: validUnsigned(value.totalPrepaymentUsdMicros)
            ? String(value.totalPrepaymentUsdMicros) : null,
    }
}

function normalize(value) {
    if (!value || typeof value.orderId !== 'string' || !value.orderId || value.orderId.length > 128 ||
        !HASH.test(value.userOpHash) || !ADDRESS.test(value.walletAddress) ||
        (!Number.isSafeInteger(value.chainId) || value.chainId <= 0) || !Number.isFinite(value.timestamp)) return null
    return {
        orderId: value.orderId, userOpHash: value.userOpHash.toLowerCase(),
        walletAddress: value.walletAddress.toLowerCase(), chainId: value.chainId,
        timestamp: value.timestamp, ambiguous: value.ambiguous === true,
        routeId: typeof value.routeId === 'string' ? value.routeId.slice(0, 128) : null,
        dismissed: value.dismissed === true,
        reviewDisplay: displaySnapshot(value.reviewDisplay),
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
    const allStored = pendingUserOperations()
    const previous = allStored.find(item => item.orderId === record.orderId &&
        item.walletAddress === record.walletAddress && item.userOpHash === record.userOpHash)
    // A late bundler acknowledgment must not reopen a deliberately dismissed
    // operation by overwriting a newer UI preference with an old snapshot.
    if (previous?.dismissed) record.dismissed = true
    if (!record.reviewDisplay && previous?.reviewDisplay) {
        record.reviewDisplay = previous.reviewDisplay
    }
    const all = allStored.filter((item) => item.orderId !== record.orderId)
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

/**
 * Dismiss a submitted operation's UI only. The public operation ID remains
 * persisted so recovery continues on reload without re-signing or resending.
 */
export function dismissPendingUserOperation(orderId, walletAddress) {
    try {
        const stored = pendingUserOperations()
        const normalizedWallet = String(walletAddress ?? '').toLowerCase()
        const exists = stored.some(item =>
            item.orderId === orderId && item.walletAddress === normalizedWallet)
        if (!exists) return false
        globalThis.localStorage?.setItem(KEY, JSON.stringify(stored.map(item =>
            item.orderId === orderId && item.walletAddress === normalizedWallet
                ? { ...item, dismissed: true }
                : item,
        )))
        return true
    } catch {
        return false
    }
}
