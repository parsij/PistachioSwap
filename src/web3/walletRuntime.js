import { useCallback, useEffect, useSyncExternalStore } from 'react'

const idleBalance = Object.freeze({
    data: undefined,
    value: null,
    formatted: null,
    status: 'idle',
    isError: false,
    isSuccess: false,
    isLoading: false,
    isPending: false,
    error: null,
    refetch: async () => {},
})

const idleReceipt = Object.freeze({
    isSuccess: false,
    isError: false,
    isLoading: false,
    isPending: false,
    data: undefined,
    error: undefined,
})

const disconnected = {
    ready: false,
    open: null,
    switchNetwork: async () => {},
    account: { address: undefined, isConnected: false },
    wagmiAccount: {
        address: undefined,
        addresses: undefined,
        chainId: undefined,
        connector: null,
        isConnected: false,
        status: 'disconnected',
    },
    chainId: 56,
    config: null,
    publicClient: undefined,
    getPublicClient: () => undefined,
    sendTransaction: async () => {
        throw new Error('Connect a wallet first.')
    },
    writeContract: async () => {
        throw new Error('Connect a wallet first.')
    },
    disconnect: async () => {},
    connection: { connector: null },
    walletClient: null,
}

let state = { ...disconnected }
const listeners = new Set()
let runtimeLoader = null
let runtimeLoadPromise = null

const balanceQueries = new Map()
const balanceRefs = new Map()
const balanceResults = new Map()
const receiptQueries = new Map()
const receiptRefs = new Map()
const receiptResults = new Map()
const queryListeners = new Set()
let querySnapshot = { balances: new Map(), receipts: new Map() }

function emit() {
    for (const listener of listeners) listener()
}

function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getState() {
    return state
}

function sameValue(left, right) {
    if (left === right) return true
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return false
    }
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => left[key] === right[key])
}

export function patchWalletRuntime(partial) {
    const next = { ...state, ...partial }
    if (sameValue(state, next)) return
    state = next
    emit()
}

export function resetWalletRuntime() {
    state = { ...disconnected }
    runtimeLoader = null
    runtimeLoadPromise = null
    balanceQueries.clear()
    balanceRefs.clear()
    balanceResults.clear()
    receiptQueries.clear()
    receiptRefs.clear()
    receiptResults.clear()
    querySnapshot = { balances: new Map(), receipts: new Map() }
    emit()
    emitQueries()
}

export function registerWalletRuntimeLoader(loader) {
    runtimeLoader = loader
}

export function waitForWalletRuntime() {
    if (getState().ready) return Promise.resolve()
    return new Promise((resolve) => {
        const unsubscribe = subscribe(() => {
            if (getState().ready) {
                unsubscribe()
                resolve()
            }
        })
    })
}

export async function ensureWalletRuntime() {
    if (getState().ready) return
    if (!runtimeLoadPromise && runtimeLoader) {
        runtimeLoadPromise = Promise.resolve()
            .then(() => runtimeLoader())
            .catch((error) => {
                runtimeLoadPromise = null
                throw error
            })
    }
    if (runtimeLoadPromise) await runtimeLoadPromise
    if (!getState().ready) await waitForWalletRuntime()
}

function emitQueries() {
    querySnapshot = {
        balances: new Map(balanceQueries),
        receipts: new Map(receiptQueries),
    }
    for (const listener of queryListeners) listener()
    emit()
}

export function subscribeWalletQueries(listener) {
    queryListeners.add(listener)
    return () => queryListeners.delete(listener)
}

export function getWalletQueries() {
    return querySnapshot
}

export function publishBalanceResult(key, result) {
    const next = {
        data: result.data,
        value: result.data?.value ?? result.value ?? null,
        formatted: result.data?.formatted ?? result.formatted ?? null,
        status: result.status,
        isError: Boolean(result.isError),
        isSuccess: Boolean(result.isSuccess),
        isLoading: Boolean(result.isLoading),
        isPending: Boolean(result.isPending),
        error: result.error ?? null,
        refetch: result.refetch ?? idleBalance.refetch,
    }
    const previous = balanceResults.get(key)
    if (previous && sameValue(previous, next)) return
    balanceResults.set(key, next)
    emit()
}

export function publishReceiptResult(key, result) {
    const next = {
        isSuccess: Boolean(result.isSuccess),
        isError: Boolean(result.isError),
        isLoading: Boolean(result.isLoading),
        isPending: Boolean(result.isPending),
        data: result.data,
        error: result.error,
    }
    const previous = receiptResults.get(key)
    if (previous && sameValue(previous, next)) return
    receiptResults.set(key, next)
    emit()
}

function serializeQuery(params) {
    return JSON.stringify(params ?? null)
}

function useRuntime() {
    return useSyncExternalStore(subscribe, getState, getState)
}

export function useAppKit() {
    const open = useCallback(async (options) => {
        await ensureWalletRuntime()
        const next = getState().open
        if (typeof next !== 'function') {
            throw new Error('Wallet connection is unavailable.')
        }
        return next(options)
    }, [])
    return { open }
}

export function useAppKitAccount() {
    return useRuntime().account
}

export function useAppKitNetwork() {
    const runtime = useRuntime()
    return {
        chainId: runtime.chainId,
        switchNetwork: runtime.switchNetwork,
    }
}

export function useAccount() {
    return useRuntime().wagmiAccount
}

export function useChainId() {
    return useRuntime().chainId
}

export function useConfig() {
    return useRuntime().config
}

export function usePublicClient({ chainId } = {}) {
    const runtime = useRuntime()
    return runtime.getPublicClient(chainId) ?? runtime.publicClient
}

export function useSendTransaction() {
    const runtime = useRuntime()
    return { mutateAsync: runtime.sendTransaction }
}

export function useWriteContract() {
    const runtime = useRuntime()
    return { mutateAsync: runtime.writeContract }
}

export function useDisconnect() {
    const runtime = useRuntime()
    return {
        mutate: runtime.disconnect,
        mutateAsync: runtime.disconnect,
    }
}

export function useConnection() {
    return useRuntime().connection
}

export function useWalletClient() {
    return { data: useRuntime().walletClient }
}

export function useBalance(options) {
    const address = options?.address
    const chainId = options?.chainId
    const enabled = options?.query?.enabled
    const key = serializeQuery({ address, chainId, enabled })
    useEffect(() => {
        const count = (balanceRefs.get(key) ?? 0) + 1
        balanceRefs.set(key, count)
        balanceQueries.set(key, { address, chainId, enabled })
        emitQueries()
        return () => {
            const remaining = (balanceRefs.get(key) ?? 1) - 1
            if (remaining <= 0) {
                balanceRefs.delete(key)
                balanceQueries.delete(key)
                balanceResults.delete(key)
            } else {
                balanceRefs.set(key, remaining)
            }
            emitQueries()
        }
    }, [key, address, chainId, enabled])
    return useSyncExternalStore(
        subscribe,
        () => balanceResults.get(key) ?? idleBalance,
        () => idleBalance,
    )
}

export function useWaitForTransactionReceipt(options) {
    const hash = options?.hash
    const chainId = options?.chainId
    const enabled = options?.query?.enabled
    const key = serializeQuery({ hash, chainId, enabled })
    useEffect(() => {
        const count = (receiptRefs.get(key) ?? 0) + 1
        receiptRefs.set(key, count)
        receiptQueries.set(key, { hash, chainId, enabled })
        emitQueries()
        return () => {
            const remaining = (receiptRefs.get(key) ?? 1) - 1
            if (remaining <= 0) {
                receiptRefs.delete(key)
                receiptQueries.delete(key)
                receiptResults.delete(key)
            } else {
                receiptRefs.set(key, remaining)
            }
            emitQueries()
        }
    }, [key, hash, chainId, enabled])
    return useSyncExternalStore(
        subscribe,
        () => receiptResults.get(key) ?? idleReceipt,
        () => idleReceipt,
    )
}
