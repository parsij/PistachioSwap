import { describe, expect, it, vi } from 'vitest'
import { finishCrossChainGasAssistUi } from './crossChainGasAssistCompletion.js'

function context(order = {}) {
    return {
        order,
        closeReview: vi.fn(),
        setTransactionStatus: vi.fn(),
        setStatusMessage: vi.fn(),
        refreshWalletBalances: vi.fn().mockResolvedValue(undefined),
    }
}

describe('cross-chain Gas Assist recovery cannot mutate a new quote', () => {
    it('refreshes balances for an old verified swap without closing review or announcing a new submission', async () => {
        const state = context({
            id: 'three-hours-old', recoveredFromStorage: true,
            crossChainRouteId: 'old-route', status: 'completed',
        })
        await finishCrossChainGasAssistUi(state)
        expect(state.refreshWalletBalances).toHaveBeenCalledOnce()
        expect(state.closeReview).not.toHaveBeenCalled()
        expect(state.setTransactionStatus).not.toHaveBeenCalled()
        expect(state.setStatusMessage).not.toHaveBeenCalled()
    })

    it('keeps the historical completion isolated even if the balance refresh fails', async () => {
        const state = context({ recoveredFromStorage: true })
        state.refreshWalletBalances.mockRejectedValue(new Error('temporary RPC failure'))
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            await expect(finishCrossChainGasAssistUi(state)).resolves.toBeUndefined()
            expect(state.closeReview).not.toHaveBeenCalled()
            expect(state.setTransactionStatus).not.toHaveBeenCalled()
            expect(state.setStatusMessage).not.toHaveBeenCalled()
        } finally {
            log.mockRestore()
        }
    })

    it('still closes review and marks a genuinely new confirmed submission', async () => {
        const state = context({ id: 'new-order', recoveredFromStorage: false })
        await finishCrossChainGasAssistUi(state)
        expect(state.closeReview).toHaveBeenCalledOnce()
        expect(state.setTransactionStatus).toHaveBeenCalledWith('submitted')
        expect(state.setStatusMessage).toHaveBeenCalledWith('Cross-chain swap submitted with Gas Assist.')
        expect(state.refreshWalletBalances).toHaveBeenCalledOnce()
    })
})
