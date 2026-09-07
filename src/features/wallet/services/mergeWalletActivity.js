const priority = { swapped: 5, sent: 4, received: 4, approved: 3, contract: 2, unknown: 1 }

export function activityKey(item) {
    return item?.hash
        ? `${Number(item.chainId)}:${String(item.hash).toLowerCase()}`
        : String(item?.id ?? '')
}

export function mergeWalletActivity(localItems, remoteItems, limit = 50) {
    const merged = new Map()
    for (const item of [...localItems, ...remoteItems]) {
        const key = activityKey(item)
        if (!key) continue
        const existing = merged.get(key)
        if (!existing) {
            merged.set(key, item)
            continue
        }
        const remoteProvesFailure = item.source === 'remote' && item.status === 'failed'
        const preferred = remoteProvesFailure || (priority[item.type] ?? 0) >= (priority[existing.type] ?? 0) ? item : existing
        const other = preferred === item ? existing : item
        const result = { ...other, ...preferred, source: 'merged' }
        for (const field of ['token', 'sellToken', 'buyToken']) {
            result[field] = preferred[field] || other[field]
                ? { ...other[field], ...Object.fromEntries(Object.entries(preferred[field] ?? {}).filter(([, value]) => value != null)) }
                : null
        }
        for (const field of ['amount', 'sellAmount', 'buyAmount', 'recipient', 'sender', 'blockNumber', 'from', 'to', 'detectedContract', 'classificationReason']) {
            result[field] = preferred[field] ?? other[field] ?? null
        }
        merged.set(key, result)
    }
    return [...merged.values()]
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, limit)
}
