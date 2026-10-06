// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

const status = vi.hoisted(() => vi.fn())
vi.mock('../../cross-chain/services/crossChainRoutes.js', async (original) => ({
    ...await original(), fetchCrossChainRouteStatus: status,
}))

const wallet = '0x1111111111111111111111111111111111111111'
const hash = `0x${'ef'.repeat(32)}`

beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    status.mockReset()
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
