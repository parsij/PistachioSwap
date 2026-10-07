// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CURATED_EVM_CHAIN_IDS } from '../../../web3/curatedEvmChains.js'

const status = vi.hoisted(() => vi.fn())
vi.mock('../../cross-chain/services/crossChainRoutes.js', async (original) => ({
    ...await original(), fetchCrossChainRouteStatus: status,
}))

const wallet = '0x1111111111111111111111111111111111111111'
const hash = `0x${'ef'.repeat(32)}`

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    status.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }))))
})

async function reloadSubmittedOperation() {
    const store = await import('./optimisticBalances.js')
    store.beginOptimisticWalletTransaction({
        walletAddress: wallet, transactionHash: hash,
        operation: 'swapping', settlementMode: 'external', referenceId: 'saved-route',
        changes: [10, 8453].map((chainId, index) => ({
            chainId, deltaRaw: index === 0 ? -75n : 70n,
            token: { chainId, address: '0x0000000000000000000000000000000000000000', decimals: 18, symbol: 'ETH' },
        })),
    })
    // No form route pointer exists. Fresh modules hydrate only the operation.
    vi.resetModules()
    const restored = await import('./optimisticBalances.js')
    expect(restored.getOptimisticWalletTransactions(wallet)[0].referenceId).toBe('saved-route')
    const { reconcilePendingWalletOperations } = await import('./reconcilePendingWalletOperations.js')
    await reconcilePendingWalletOperations(wallet)
    return restored.getWalletOperationDisplayState(wallet)
}

it('settles a completed route after reloading with no form route pointer', async () => {
    status.mockResolvedValue({ status: 'completed' })
    expect((await reloadSubmittedOperation()).status).toBe('confirmed')
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ routeId: 'saved-route' }))
})

it('keeps the swap pending when only the source transaction has submitted', async () => {
    status.mockResolvedValue({ status: 'submitted', sourceTransactionHash: hash })
    expect((await reloadSubmittedOperation()).status).toBe('pending')
})

it('keeps the swap pending during a temporary status outage', async () => {
    status.mockRejectedValue(new Error('unavailable'))
    expect((await reloadSubmittedOperation()).status).toBe('pending')
})

const destinationHash = `0x${'ab'.repeat(32)}`
async function checkRoute(overrides = {}, receiptStatus = '0x1', receiptHash = destinationHash) {
    const store = await import('./optimisticBalances.js')
    store.beginOptimisticWalletTransaction({ walletAddress: wallet, transactionHash: hash, operation: 'swapping',
        settlementMode: 'external', referenceId: 'bsc-op', changes: [56, 10].map((chainId, index) => ({ chainId,
            tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: index === 0 ? -75n : 70n })) })
    status.mockResolvedValue({ publicRouteId: 'bsc-op', status: 'destination-confirming',
        sourceChainId: 56, destinationChainId: 10, sourceTransactionHash: hash, destinationTransactionHash: destinationHash, ...overrides })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: receiptStatus
        ? { status: receiptStatus, transactionHash: receiptHash } : null })))
    vi.stubGlobal('fetch', fetch)
    const { reconcilePendingWalletOperations } = await import('./reconcilePendingWalletOperations.js')
    await reconcilePendingWalletOperations(wallet)
    return { store, fetch, display: store.getWalletOperationDisplayState(wallet) }
}

it('completes BSC to OP from the exact destination receipt even when provider status lags', async () => {
    const { display, fetch } = await checkRoute()
    expect(display.status).toBe('confirmed')
    const destinationCall = fetch.mock.calls.find(([, options]) => JSON.parse(options.body).params[0] === destinationHash)
    expect(JSON.parse(destinationCall[1].body)).toMatchObject({ method: 'eth_getTransactionReceipt', params: [destinationHash] })
    expect(destinationCall[0]).toContain('optimism')
})

it('does not complete a bridge when only the BSC deposit succeeded', async () => {
    const { display } = await checkRoute({ destinationTransactionHash: null }, '0x1', hash)
    expect(display.status).toBe('source-confirmed')
})

it('waits for the destination receipt even if provider prematurely says completed', async () => {
    expect((await checkRoute({ status: 'completed' }, null)).display.status).toBe('pending')
})

it('does not mistake a source receipt for the destination receipt', async () => {
    expect((await checkRoute({}, '0x1', hash)).display.status).toBe('source-confirmed')
})

it('marks a reverted destination as failed', async () => {
    expect((await checkRoute({}, '0x0')).display.status).toBe('failed')
})

it.each([
    { sourceTransactionHash: destinationHash },
    { destinationChainId: 8453 },
    { publicRouteId: 'unrelated-route' },
])('does not use an unrelated route or chain receipt: %j', async (overrides) => {
    const { display, fetch } = await checkRoute(overrides)
    expect(display.status).toBe('pending')
    expect(fetch.mock.calls.every(([, options]) => JSON.parse(options.body).params[0] === hash)).toBe(true)
})

it('expires the pending indicator and optimistic deltas at 15 minutes without inventing success', async () => {
    vi.useFakeTimers()
    const { store } = await checkRoute({}, null)
    vi.advanceTimersByTime(15 * 60_000 - 1)
    expect(store.getWalletOperationDisplayState(wallet).status).toBe('pending')
    vi.advanceTimersByTime(1)
    store.expirePendingWalletTransactions()
    expect(store.getWalletOperationDisplayState(wallet)).toBeNull()
    expect(store.getOptimisticWalletDeltas(wallet)).toHaveLength(0)
    vi.resetModules()
    const restored = await import('./optimisticBalances.js')
    expect(restored.getWalletOperationDisplayState(wallet)).toBeNull()
})

it('marks a reverted submitted source hash as failed without claiming bridge completion', async () => {
    expect((await checkRoute({ destinationTransactionHash: null }, '0x0', hash)).display.status).toBe('failed')
})

it.each(CURATED_EVM_CHAIN_IDS)(
    'verifies the submitted source hash on chain %s even when route status is unavailable', async (chainId) => {
        vi.useFakeTimers()
        const store = await import('./optimisticBalances.js')
        store.beginOptimisticWalletTransaction({ walletAddress: wallet, transactionHash: hash, operation: 'swapping',
            settlementMode: 'external', referenceId: 'all-chains', changes: [
                { chainId, tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: -75n },
                { chainId: chainId === 10 ? 56 : 10, tokenAddress: '0x0000000000000000000000000000000000000000', deltaRaw: 70n },
            ] })
        const fetch = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1,
            result: { status: '0x1', transactionHash: hash } })))
        vi.stubGlobal('fetch', fetch)
        status.mockRejectedValue(new Error('provider status unavailable'))
        const { reconcilePendingWalletOperations } = await import('./reconcilePendingWalletOperations.js')
        await reconcilePendingWalletOperations(wallet)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(JSON.parse(fetch.mock.calls[0][1].body).params).toEqual([hash])
        expect(store.getWalletOperationDisplayState(wallet).status).toBe('source-confirmed')
        expect(store.getOptimisticWalletTransactions(wallet)).toHaveLength(1)
        vi.advanceTimersByTime(5_000)
        expect(store.getWalletOperationDisplayState(wallet)).toBeNull()
        expect(store.getOptimisticWalletTransactions(wallet)).toHaveLength(1)
        vi.resetModules()
        const restored = await import('./optimisticBalances.js')
        expect(restored.getWalletOperationDisplayState(wallet)).toBeNull()
        expect(restored.getOptimisticWalletTransactions(wallet)).toHaveLength(1)
        restored.finishOptimisticWalletTransaction(hash)
        expect(restored.getWalletOperationDisplayState(wallet).status).toBe('confirmed')
        vi.advanceTimersByTime(5_000)
    },
)
