import {
    useCallback,
    useRef,
    useState,
} from 'react'

import {
    runReadOnlySwapSimulation,
    simulationErrorMessage,
} from '../../../services/simulationError.js'
import {
    isUserRejectedError,
} from '../../../services/swapTransaction.js'
import {
    getValidatedExecutableTransaction,
} from '../services/executableTransaction.js'
import {
    validateRefreshedQuote,
} from '../services/refreshedQuoteValidation.js'

/**
 * Purpose: orchestrates one confirmed same-chain swap from approval through
 * quote refresh, simulation, Permit2 recovery, and wallet submission.
 *
 * The simulation may return a transaction containing a live buffered gas
 * estimate. That returned transaction must replace the original provider
 * transaction for both simulation recovery and wallet submission.
 */
export function useSameChainExecution({
                                          account,
                                          chainId,
                                          sellToken,
                                          buyToken,
                                          quote,
                                          quoteSnapshot,
                                          quoteEndpoint,
                                          requireSuccessfulSimulation,
                                          prepareSwapApproval,
                                          getLastPreparationResult,
                                          invalidatePermit2Readiness,
                                          fetchQuote,
                                          getCurrentRequestKey,
                                          applyRefreshedQuote,
                                          publicClient,
                                          simulateTransaction =
                                          runReadOnlySwapSimulation,
                                          sendTransaction,
                                          transactionStatus,
                                          reviewOperation,
                                          setReviewOperation,
                                          setReviewError,
                                          setVisibleStatus,
                                          setTransactionStatus,
                                          setTransactionHash,
                                          setReviewConfirmationPending,
                                          diagnostic,
                                          requestKeySuffix,
                                          quoteDiagnostic,
                                          approvalMetadataDiagnostic,
                                          transactionDiagnostic,
                                          executionErrorSnapshot,
                                      }) {
    const confirmationPendingRef =
        useRef(false)

    const [
        isConfirming,
        setIsConfirming,
    ] = useState(false)

    const resetSameChainExecution =
        useCallback(() => {
            confirmationPendingRef.current =
                false

            setReviewConfirmationPending?.(
                false,
            )

            setIsConfirming(false)
        }, [
            setReviewConfirmationPending,
        ])

    const confirmSameChainSwap =
        useCallback(async () => {
            if (
                confirmationPendingRef.current
            ) {
                diagnostic(
                    'review.confirm.blocked',
                    {
                        reason:
                            'confirm-already-pending',

                        operation:
                        reviewOperation,
                    },
                    'warn',
                )

                return null
            }

            confirmationPendingRef.current =
                true

            setReviewConfirmationPending?.(
                true,
            )

            setIsConfirming(true)

            let confirmationPhase =
                'approval'

            let waitingForReceipt =
                false

            try {
                setReviewError(null)

                setReviewOperation(
                    'checking-approval',
                )

                diagnostic(
                    'approval.prepare.invoke',
                    {
                        quote:
                            quoteDiagnostic(
                                quote,
                            ),
                    },
                )

                const approvalReady =
                    await prepareSwapApproval()

                const approvalResult =
                    getLastPreparationResult?.() ??
                    {
                        approvalReady,
                        approvalTransactionSubmitted:
                            false,
                    }

                let executionQuote =
                    quote

                const refreshValidatedQuote =
                    async ({
                               previousQuote,

                               requirePancakePermit2 =
                               false,

                               staleMessage =
                               'The quote changed during approval. Request a fresh quote.',

                               mismatchMessage,
                           }) => {
                        const snapshot =
                            quoteSnapshot

                        const refreshRequestKey =
                            snapshot
                                ?.requestKey ??
                            null

                        if (
                            !snapshot ||
                            !refreshRequestKey
                        ) {
                            throw new Error(
                                staleMessage,
                            )
                        }

                        const candidate =
                            await fetchQuote({
                                endpoint:
                                quoteEndpoint,

                                request:
                                snapshot.request,

                                forceRefresh:
                                    true,
                            })

                        if (
                            getCurrentRequestKey() !==
                            refreshRequestKey
                        ) {
                            throw new Error(
                                staleMessage,
                            )
                        }

                        return validateRefreshedQuote({
                            refreshedQuote:
                            candidate,

                            previousQuote,

                            snapshot,

                            account,

                            chainId,

                            sellToken:
                            sellToken.address,

                            buyToken:
                            buyToken.address,

                            requirePancakePermit2,

                            mismatchMessage,
                        })
                    }

                if (
                    approvalResult
                        .approvalTransactionSubmitted
                ) {
                    confirmationPhase =
                        'quote-refresh'

                    setReviewOperation(
                        'refreshing-quote',
                    )

                    diagnostic(
                        'quote.refresh.after-approval.start',
                        {
                            requestKeySuffix:
                                requestKeySuffix(
                                    quoteSnapshot
                                        ?.requestKey,
                                ),

                            quote:
                                quoteDiagnostic(
                                    quote,
                                ),
                        },
                    )

                    executionQuote =
                        await refreshValidatedQuote({
                            previousQuote:
                            quote,
                        })

                    applyRefreshedQuote(
                        executionQuote,
                        quoteSnapshot.inputKey,
                    )

                    diagnostic(
                        'quote.refresh.after-approval.applied',
                        {
                            requestKeySuffix:
                                requestKeySuffix(
                                    quoteSnapshot
                                        .requestKey,
                                ),

                            quote:
                                quoteDiagnostic(
                                    executionQuote,
                                ),
                        },
                    )
                }

                if (!approvalReady) {
                    setReviewError(
                        'Approval was not completed. Confirm approval to continue.',
                    )

                    diagnostic(
                        'approval.prepare.incomplete',
                        {
                            approvalReady,
                        },
                        'warn',
                    )

                    return null
                }

                diagnostic(
                    'approval.prepare.ready',
                    {
                        approvalReady,
                    },
                )

                let transaction =
                    getValidatedExecutableTransaction({
                        quoteResponse:
                        executionQuote,

                        expectedChainId:
                        chainId,

                        expectedSellToken:
                        sellToken.address,

                        expectedBuyToken:
                        buyToken.address,

                        expectedAccount:
                        account,
                    })

                diagnostic(
                    'transaction.revalidated',
                    {
                        transaction:
                            transactionDiagnostic(
                                transaction,
                            ),
                    },
                )

                if (
                    requireSuccessfulSimulation
                ) {
                    try {
                        confirmationPhase =
                            'simulation'

                        setReviewOperation(
                            'simulating',
                        )

                        const simulatedTransaction =
                            await simulateTransaction({
                                publicClient,
                                account,
                                transaction,

                                onEvent: (
                                    event,
                                    details = {},
                                ) =>
                                    diagnostic(
                                        event,
                                        {
                                            ...details,

                                            transaction:
                                                transactionDiagnostic(
                                                    transaction,
                                                ),
                                        },
                                    ),
                            })

                        /*
                         * runReadOnlySwapSimulation returns a transaction with
                         * a live buffered gas limit. Preserve compatibility
                         * with custom test simulators that return undefined.
                         */
                        if (
                            simulatedTransaction &&
                            typeof simulatedTransaction ===
                            'object'
                        ) {
                            transaction =
                                simulatedTransaction

                            diagnostic(
                                'transaction.gas.prepared',
                                {
                                    transaction:
                                        transactionDiagnostic(
                                            transaction,
                                        ),
                                },
                            )
                        }
                    } catch (error) {
                        const decoded =
                            error?.decoded ??
                            null

                        const permit2Execution =
                            executionQuote
                                ?.selectedQuote
                                ?.approval
                                ?.mode ===
                            'permit2-allowance' ||
                            String(
                                executionQuote
                                    ?.selectedQuote
                                    ?.provider ??
                                '',
                            )
                                .trim()
                                .toLowerCase() ===
                            'pancakeswap'

                        if (
                            decoded
                                ?.errorName ===
                            'AllowanceExpired' &&
                            permit2Execution
                        ) {
                            diagnostic(
                                'approval.recovery.started',
                                {
                                    reason:
                                        'simulation-allowance-expired',

                                    recoveryAttempt:
                                        1,
                                },
                                'warn',
                            )

                            diagnostic(
                                'approval.permit2.recovery.start',
                                {
                                    reason:
                                        'simulation-allowance-expired',
                                },
                                'warn',
                            )

                            try {
                                confirmationPhase =
                                    'quote-refresh'

                                setReviewOperation(
                                    'refreshing-quote',
                                )

                                let refreshedQuote =
                                    await refreshValidatedQuote({
                                        previousQuote:
                                        executionQuote,

                                        requirePancakePermit2:
                                            true,

                                        staleMessage:
                                            'The quote changed during authorization renewal.',

                                        mismatchMessage:
                                            'The refreshed PancakeSwap quote no longer matches this swap.',
                                    })

                                diagnostic(
                                    'approval.metadata.recovery-input',
                                    approvalMetadataDiagnostic(
                                        refreshedQuote,
                                    ),
                                )

                                invalidatePermit2Readiness?.()

                                confirmationPhase =
                                    'approval'

                                setReviewOperation(
                                    'checking-pancake-authorization',
                                )

                                const recoveryReady =
                                    await prepareSwapApproval(
                                        refreshedQuote,
                                    )

                                const recoveryResult =
                                    getLastPreparationResult?.() ??
                                    {
                                        approvalReady:
                                        recoveryReady,

                                        approvalTransactionSubmitted:
                                            false,
                                    }

                                if (
                                    !recoveryReady
                                ) {
                                    throw new Error(
                                        'PancakeSwap authorization could not be renewed.',
                                    )
                                }

                                if (
                                    recoveryResult
                                        .approvalTransactionSubmitted
                                ) {
                                    confirmationPhase =
                                        'quote-refresh'

                                    setReviewOperation(
                                        'refreshing-quote',
                                    )

                                    refreshedQuote =
                                        await refreshValidatedQuote({
                                            previousQuote:
                                            refreshedQuote,

                                            requirePancakePermit2:
                                                true,

                                            staleMessage:
                                                'The quote changed during authorization renewal.',

                                            mismatchMessage:
                                                'The refreshed PancakeSwap quote no longer matches this swap.',
                                        })
                                }

                                executionQuote =
                                    refreshedQuote

                                transaction =
                                    getValidatedExecutableTransaction({
                                        quoteResponse:
                                        executionQuote,

                                        expectedChainId:
                                        chainId,

                                        expectedSellToken:
                                        sellToken.address,

                                        expectedBuyToken:
                                        buyToken.address,

                                        expectedAccount:
                                        account,
                                    })

                                applyRefreshedQuote(
                                    executionQuote,
                                    quoteSnapshot.inputKey,
                                )

                                diagnostic(
                                    'approval.permit2.recovery.quote-refreshed',
                                    {
                                        requestKeySuffix:
                                            requestKeySuffix(
                                                quoteSnapshot
                                                    .requestKey,
                                            ),

                                        quote:
                                            quoteDiagnostic(
                                                executionQuote,
                                            ),
                                    },
                                )

                                confirmationPhase =
                                    'simulation'

                                setReviewOperation(
                                    'simulating',
                                )

                                const recoveredSimulationTransaction =
                                    await simulateTransaction({
                                        publicClient,
                                        account,
                                        transaction,

                                        onEvent: (
                                            event,
                                            details = {},
                                        ) =>
                                            diagnostic(
                                                event,
                                                {
                                                    ...details,

                                                    recoveryAttempt:
                                                        1,

                                                    transaction:
                                                        transactionDiagnostic(
                                                            transaction,
                                                        ),
                                                },
                                            ),
                                    })

                                if (
                                    recoveredSimulationTransaction &&
                                    typeof recoveredSimulationTransaction ===
                                    'object'
                                ) {
                                    transaction =
                                        recoveredSimulationTransaction

                                    diagnostic(
                                        'transaction.gas.prepared',
                                        {
                                            recoveryAttempt:
                                                1,

                                            transaction:
                                                transactionDiagnostic(
                                                    transaction,
                                                ),
                                        },
                                    )
                                }

                                diagnostic(
                                    'approval.permit2.recovery.succeeded',
                                    {
                                        recoveryAttempt:
                                            1,
                                    },
                                )
                            } catch (
                                recoveryError
                                ) {
                                const recoveryDecoded =
                                    recoveryError
                                        ?.decoded ??
                                    null

                                const message =
                                    recoveryDecoded
                                        ? simulationErrorMessage(
                                            recoveryDecoded,
                                        )
                                        : recoveryError instanceof
                                        Error
                                            ? recoveryError.message
                                            : 'PancakeSwap authorization could not be renewed.'

                                setTransactionStatus(
                                    'failed',
                                )

                                setVisibleStatus(
                                    message,
                                )

                                setReviewError(
                                    message,
                                )

                                diagnostic(
                                    'approval.permit2.recovery.failed',
                                    {
                                        recoveryAttempt:
                                            1,

                                        visibleMessage:
                                        message,

                                        decoded:
                                            recoveryDecoded
                                                ? {
                                                    contractFamily:
                                                    recoveryDecoded
                                                        .contractFamily,

                                                    errorName:
                                                    recoveryDecoded
                                                        .errorName,

                                                    safeArguments:
                                                    recoveryDecoded
                                                        .safeArguments,
                                                }
                                                : null,

                                        error:
                                            executionErrorSnapshot(
                                                recoveryError,
                                            ),
                                    },
                                    'error',
                                )

                                return null
                            }
                        } else {
                            setTransactionStatus(
                                'failed',
                            )

                            const message =
                                simulationErrorMessage(
                                    decoded,
                                )

                            setVisibleStatus(
                                message,
                            )

                            setReviewError(
                                message,
                            )

                            diagnostic(
                                'simulation.failed',
                                {
                                    visibleMessage:
                                    message,

                                    decoded:
                                        decoded
                                            ? {
                                                contractFamily:
                                                decoded.contractFamily,

                                                errorName:
                                                decoded.errorName,

                                                safeArguments:
                                                decoded.safeArguments,

                                                routerErrorName:
                                                    decoded.routerErrorName ??
                                                    null,

                                                commandIndex:
                                                    decoded.commandIndex ??
                                                    null,
                                            }
                                            : null,

                                    routerTarget:
                                    transaction.to,

                                    chainId,

                                    token:
                                        executionQuote
                                            ?.selectedQuote
                                            ?.sellToken ??
                                        null,

                                    spender:
                                        executionQuote
                                            ?.selectedQuote
                                            ?.approval
                                            ?.spender ??
                                        null,

                                    requiredAmount:
                                        executionQuote
                                            ?.selectedQuote
                                            ?.approval
                                            ?.requiredAmount ??
                                        null,

                                    error:
                                        executionErrorSnapshot(
                                            error,
                                        ),
                                },
                                'error',
                            )

                            return null
                        }
                    }
                } else {
                    diagnostic(
                        'simulation.skipped',
                        {
                            reason:
                                'config-disabled',
                        },
                        'warn',
                    )
                }

                setReviewOperation(
                    'submitting',
                )

                confirmationPhase =
                    'submission'

                setTransactionHash(null)

                setTransactionStatus(
                    'pending',
                )

                setVisibleStatus(
                    'Confirm the transaction in your wallet.',
                )

                diagnostic(
                    'transaction.send.start',
                    {
                        transaction:
                            transactionDiagnostic(
                                transaction,
                            ),
                    },
                )

                /*
                 * `transaction` now contains the live buffered gas returned by
                 * the simulation instead of Uniswap's original fixed value.
                 */
                const hash =
                    await sendTransaction({
                        ...transaction,
                        chainId,
                    })

                setTransactionHash(hash)

                setTransactionStatus(
                    'submitted',
                )

                waitingForReceipt =
                    true

                setReviewOperation(
                    'waiting-confirmation',
                )

                setVisibleStatus(
                    'Transaction submitted. Waiting for confirmation.',
                )

                diagnostic(
                    'transaction.send.submitted',
                    {
                        hash,
                        chainId,
                    },
                )

                return hash
            } catch (error) {
                if (
                    isUserRejectedError(error)
                ) {
                    setTransactionStatus(
                        'rejected',
                    )

                    const message =
                        confirmationPhase ===
                        'approval'
                            ? 'Approval was rejected in your wallet.'
                            : 'Transaction rejected.'

                    setVisibleStatus(
                        message,
                    )

                    setReviewError(
                        message,
                    )

                    diagnostic(
                        confirmationPhase ===
                        'approval'
                            ? 'approval.wallet-prompt.rejected'
                            : 'transaction.rejected',

                        {
                            error:
                                executionErrorSnapshot(
                                    error,
                                ),
                        },

                        'warn',
                    )

                    return null
                }

                setTransactionStatus(
                    'failed',
                )

                const message =
                    error instanceof Error
                        ? error.message
                        : 'The wallet could not submit the transaction.'

                setVisibleStatus(
                    message,
                )

                setReviewError(
                    message,
                )

                diagnostic(
                    'transaction.failed',
                    {
                        visibleMessage:
                        message,

                        error:
                            executionErrorSnapshot(
                                error,
                            ),
                    },
                    'error',
                )

                return null
            } finally {
                if (!waitingForReceipt) {
                    setReviewOperation(
                        'idle',
                    )
                }

                confirmationPendingRef.current =
                    false

                setReviewConfirmationPending?.(
                    false,
                )

                setIsConfirming(false)

                diagnostic(
                    'review.confirm.finished',
                    {
                        transactionStatus,
                    },
                )
            }
        }, [
            account,
            approvalMetadataDiagnostic,
            applyRefreshedQuote,
            buyToken,
            chainId,
            diagnostic,
            executionErrorSnapshot,
            fetchQuote,
            getCurrentRequestKey,
            getLastPreparationResult,
            invalidatePermit2Readiness,
            prepareSwapApproval,
            publicClient,
            quote,
            quoteDiagnostic,
            quoteEndpoint,
            quoteSnapshot,
            requestKeySuffix,
            requireSuccessfulSimulation,
            reviewOperation,
            sellToken,
            sendTransaction,
            setReviewConfirmationPending,
            setReviewError,
            setReviewOperation,
            setTransactionHash,
            setTransactionStatus,
            setVisibleStatus,
            simulateTransaction,
            transactionDiagnostic,
            transactionStatus,
        ])

    return {
        confirmSameChainSwap,
        isConfirming,
        resetSameChainExecution,
    }
}