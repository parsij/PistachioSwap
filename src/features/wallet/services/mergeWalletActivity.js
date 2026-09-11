const priority = { swapped: 5, sent: 4, received: 4, approved: 3, contract: 2, unknown: 1 }
const statusPriority = { pending: 1, confirmed: 2, failed: 3 }
const CROSS_CHAIN_PAIR_WINDOW_MS = 5 * 60 * 1_000
const CROSS_CHAIN_DESTINATION_WINDOW_MS = 30 * 60 * 1_000

export function activityKey(item) {
    return item?.hash
        ? `${Number(item.chainId)}:${String(item.hash).toLowerCase()}`
        : String(item?.id ?? '')
}

function tokenAddress(token) {
    return String(token?.address ?? '').trim().toLowerCase()
}

function tokenMatches(left, right) {
    const leftAddress = tokenAddress(left)
    const rightAddress = tokenAddress(right)
    return Boolean(leftAddress && rightAddress && leftAddress === rightAddress)
}

function timestampMs(item) {
    const value = Date.parse(item?.timestamp ?? '')
    return Number.isFinite(value) ? value : null
}

function withinWindow(left, right, windowMs) {
    const a = timestampMs(left)
    const b = timestampMs(right)
    return a !== null && b !== null && Math.abs(a - b) <= windowMs
}

function parseDecimal(value) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim())
    if (!match) return null
    return {
        digits: BigInt(`${match[1]}${match[2] ?? ''}`),
        scale: (match[2] ?? '').length,
    }
}

function approximatelySameAmount(leftValue, rightValue) {
    const left = parseDecimal(leftValue)
    const right = parseDecimal(rightValue)
    if (!left || !right) return false
    const scale = Math.max(left.scale, right.scale)
    const leftUnits = left.digits * 10n ** BigInt(scale - left.scale)
    const rightUnits = right.digits * 10n ** BigInt(scale - right.scale)
    if (leftUnits === rightUnits) return true
    const larger = leftUnits > rightUnits ? leftUnits : rightUnits
    const difference = leftUnits > rightUnits
        ? leftUnits - rightUnits
        : rightUnits - leftUnits
    // The semantic route quote can differ slightly from the final bridge output.
    return larger > 0n && difference * 100n <= larger
}

function isContractBackedTokenTransfer(item) {
    const token = tokenAddress(item?.token)
    const transactionTarget = String(item?.to ?? '').trim().toLowerCase()
    return Boolean(
        token &&
        transactionTarget &&
        /^0x[a-f0-9]{40}$/.test(transactionTarget) &&
        transactionTarget !== token,
    )
}

function mergeSameTransaction(localItems, remoteItems) {
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
        const itemTypePriority = priority[item.type] ?? 0
        const existingTypePriority = priority[existing.type] ?? 0
        const sameType = itemTypePriority === existingTypePriority
        const preferred = remoteProvesFailure ||
            itemTypePriority > existingTypePriority ||
            (sameType && (statusPriority[item.status] ?? 0) >= (statusPriority[existing.status] ?? 0))
            ? item
            : existing
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
}

function suppressDestinationReceives(items) {
    const consumed = new Set()
    for (const swap of items) {
        if (swap.type !== 'swapped' || !swap.destinationChainId || !swap.buyToken || !swap.buyAmount) continue
        const candidate = items.find((item) =>
            item !== swap &&
            !consumed.has(item) &&
            item.type === 'received' &&
            Number(item.chainId) === Number(swap.destinationChainId) &&
            tokenMatches(item.token, swap.buyToken) &&
            approximatelySameAmount(item.amount, swap.buyAmount) &&
            withinWindow(item, swap, CROSS_CHAIN_DESTINATION_WINDOW_MS))
        if (candidate) consumed.add(candidate)
    }
    return items.filter((item) => !consumed.has(item))
}

function collapseHistoricalCrossChainPairs(items) {
    const consumed = new Set()
    const synthetic = []
    const sent = items.filter((item) =>
        item.type === 'sent' &&
        item.status !== 'failed' &&
        item.token &&
        isContractBackedTokenTransfer(item))
    const received = items.filter((item) =>
        item.type === 'received' &&
        item.status !== 'failed' &&
        item.token &&
        isContractBackedTokenTransfer(item))

    for (const outgoing of sent) {
        if (consumed.has(outgoing)) continue
        const incoming = received.find((candidate) =>
            !consumed.has(candidate) &&
            candidate.walletAddress === outgoing.walletAddress &&
            Number(candidate.chainId) !== Number(outgoing.chainId) &&
            withinWindow(candidate, outgoing, CROSS_CHAIN_PAIR_WINDOW_MS))
        if (!incoming) continue

        consumed.add(outgoing)
        consumed.add(incoming)
        synthetic.push({
            id: `cross-chain:${outgoing.id}:${incoming.id}`,
            walletAddress: outgoing.walletAddress,
            type: 'swapped',
            chainId: outgoing.chainId,
            destinationChainId: incoming.chainId,
            hash: outgoing.hash,
            timestamp: outgoing.timestamp,
            sellToken: outgoing.token,
            buyToken: incoming.token,
            sellAmount: outgoing.amount,
            buyAmount: incoming.amount,
            recipient: outgoing.walletAddress,
            provider: 'Cross-chain',
            source: 'merged',
            status: 'confirmed',
            blockNumber: outgoing.blockNumber ?? null,
            from: outgoing.from ?? null,
            to: outgoing.to ?? null,
            detectedContract: outgoing.to ?? null,
            classificationReason: 'Correlated cross-chain contract outflow and destination inflow',
        })
    }

    return [
        ...items.filter((item) => !consumed.has(item)),
        ...synthetic,
    ]
}

export function mergeWalletActivity(localItems, remoteItems, limit = 50) {
    const merged = mergeSameTransaction(localItems, remoteItems)
    const withoutDuplicateDestinationReceives = suppressDestinationReceives(merged)
    const collapsed = collapseHistoricalCrossChainPairs(withoutDuplicateDestinationReceives)
    return collapsed
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, limit)
}
