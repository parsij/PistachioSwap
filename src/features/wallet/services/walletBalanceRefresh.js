// History amounts are never balances. A confirmed history change only asks the
// balance reader to discover holdings again and verify them through RPC.
const listeners = new Set()

export function requestWalletBalanceRefresh(walletAddress) {
    const address = String(walletAddress ?? '').toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(address)) return
    for (const listener of listeners) listener(address)
}

export function subscribeWalletBalanceRefresh(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
