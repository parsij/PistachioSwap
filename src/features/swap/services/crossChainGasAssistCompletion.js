/**
 * A historical Gas Assist completion is not a submission by the current swap
 * form. Recovery may finish hours after the user opened another quote.
 */
export async function finishCrossChainGasAssistUi({
    order,
    closeReview,
    setTransactionStatus,
    setStatusMessage,
    refreshWalletBalances,
}) {
    if (order?.recoveredFromStorage) {
        try {
            await refreshWalletBalances()
        } catch (error) {
            console.error('[pistachio-swap] Historical Gas Assist balance refresh failed', error)
        }
        return
    }
    try {
        closeReview()
        setTransactionStatus('submitted')
        setStatusMessage('Cross-chain swap submitted with Gas Assist.')
        await refreshWalletBalances()
    } catch (error) {
        console.error('[pistachio-swap] Cross-chain Gas Assist status update failed', error)
        setStatusMessage('The sponsored cross-chain transaction was sent. Refresh activity to follow its status.')
    }
}
