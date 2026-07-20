/**
 * Renders native-balance, execution-mode, and current visible swap status messages.
 * @param {{nativeBalanceError: boolean, nativeSymbol: string, executionMessage: string|null, showExecutionMessage: boolean, statusMessage: string|null}} props Status view model.
 * @returns {import('react').ReactElement} Status message fragment.
 * @sideEffects None; `aria-live` announces the current visible status.
 */
export default function TransactionStatus({
    nativeBalanceError,
    nativeSymbol,
    executionMessage,
    showExecutionMessage,
    statusMessage,
}) {
    return (
        <>
            {nativeBalanceError && (
                <p className="swap-status" role="status">
                    Unable to verify the {nativeSymbol} balance. Quoting is disabled.
                </p>
            )}
            {executionMessage && showExecutionMessage && (
                <p className="swap-status" role="status">{executionMessage}</p>
            )}
            {statusMessage && (
                <p className="swap-status" role="status" aria-live="polite">{statusMessage}</p>
            )}
        </>
    )
}
