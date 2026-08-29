const removed = () => {
    throw new Error('Legacy 0x Gasless execution has been removed. Use atomic Gas Assist.')
}

const REMOVED_STATE = Object.freeze({
    config: null,
    quote: null,
    quoteStatus: 'idle',
    quoteError: null,
    dialog: Object.freeze({ open: false, state: 'removed' }),
    available: false,
    open: removed,
    close: () => undefined,
    confirm: removed,
})

/**
 * Deprecated compatibility shim. Production routing no longer imports this hook.
 * No 0x Gasless HTTP, EIP-712 signing, submission, or polling code remains.
 */
export function useZeroXGaslessSwap() {
    return REMOVED_STATE
}
