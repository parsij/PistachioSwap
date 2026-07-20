import { useEffect, useRef } from 'react'
import { isQuoteExpired, isUserRejectedError } from '../../../services/swapTransaction.js'
import {
    approvalMetadataDiagnostic,
    executionErrorSnapshot,
    quoteDiagnostic,
    requestKeySuffix,
} from '../../../shared/logging/swapDiagnostics.js'

/**
 * Routes the primary CTA to wallet connection, network switch, route refresh, Gas Assist, cross-chain review, or same-chain review.
 * @param {object} config Derived action and feature-owned callbacks.
 * @returns {{performPrimaryAction: () => Promise<void>, confirmSameChainSwap: () => Promise<unknown>}} Semantic CTA operations.
 * @sideEffects May open AppKit, switch networks, refresh routes/quotes, or open feature dialogs; confirmation delegates to the execution hook.
 * @security Rechecks same-chain eligibility and quote expiry before opening review.
 */
export function useSwapPrimaryAction(config) {
    const actionDiagnosticRef = useRef(null)
    const {
        action, activeQuoteStatus, transactionStatus, routingMode, crossChainMode, executionMode, gaslessMode,
        reviewEligibility, insufficientFunds, economicallyInvalid, quoteSnapshot, quoteInputKey, quote,
        activeChain, activeChainName, openAppKit, switchNetwork, crossChain, gasAssist, prepaid,
        refreshSameChainQuote, clearSameChainQuoteForRefresh, openSameChainReview, setReviewError,
        setReviewOperation, setVisibleStatus, confirmExecution, diagnostic,
    } = config

    useEffect(() => {
        if (routingMode === crossChainMode || executionMode === gaslessMode) return
        const payload = {
            actionType: action.type,
            label: action.label,
            enabled: action.enabled,
            quoteStatus: activeQuoteStatus,
            transactionStatus,
            insufficientFunds,
            economicallyInvalid,
            reviewEligibility,
            requestKeySuffix: requestKeySuffix(quoteSnapshot?.requestKey),
            quoteInputKeySuffix: requestKeySuffix(quoteInputKey),
        }
        const signature = JSON.stringify(payload)
        if (actionDiagnosticRef.current === signature) return
        actionDiagnosticRef.current = signature
        diagnostic('cta.derived', payload)
    }, [
        action.enabled,
        action.label,
        action.type,
        activeQuoteStatus,
        crossChainMode,
        diagnostic,
        economicallyInvalid,
        executionMode,
        gaslessMode,
        insufficientFunds,
        quoteInputKey,
        quoteSnapshot?.requestKey,
        reviewEligibility,
        routingMode,
        transactionStatus,
    ])

    async function performPrimaryAction() {
        setVisibleStatus(null)
        diagnostic('primary-action.clicked', {
            actionType: action.type,
            label: action.label,
            enabled: action.enabled,
            reviewConfirmed: false,
            quoteStatus: activeQuoteStatus,
            transactionStatus,
            reviewEligibility: routingMode !== crossChainMode && executionMode !== gaslessMode ? reviewEligibility : null,
            requestKeySuffix: requestKeySuffix(quoteSnapshot?.requestKey),
        })
        if (action.type === 'connect') {
            diagnostic('primary-action.route', { route: 'connect-wallet' })
            try {
                await openAppKit({ view: 'Connect' })
            } catch {
                setVisibleStatus('Wallet connection is unavailable. Check the Reown origin settings.')
            }
            return
        }
        if (action.type === 'switch-network') {
            diagnostic('primary-action.route', { route: 'switch-network', targetChainId: activeChain?.id ?? null })
            try {
                if (!activeChain) throw new Error('This token network is not enabled.')
                await switchNetwork(activeChain)
            } catch (error) {
                setVisibleStatus(isUserRejectedError(error)
                    ? 'Network switch cancelled.'
                    : `Unable to switch to ${activeChainName ?? 'the token network'}.`)
            }
            return
        }
        if (action.type === 'refresh-quote') {
            diagnostic('primary-action.route', { route: 'refresh-quote', hasCrossChainRequest: Boolean(crossChain.request) })
            await crossChain.refreshExpiredRoute()
            return
        }
        if (action.type !== 'swap' && !String(action.type).startsWith('review-blocked:')) {
            diagnostic('primary-action.blocked', { reason: 'unsupported-action-type', actionType: action.type, label: action.label }, 'warn')
            return
        }
        if (transactionStatus === 'pending' || transactionStatus === 'submitted') {
            setVisibleStatus('A swap is already being processed.')
            diagnostic('primary-action.blocked', { reason: 'transaction-already-processing', transactionStatus }, 'warn')
            return
        }
        if (routingMode === crossChainMode) {
            if (crossChain.routeExpired) {
                await crossChain.refreshExpiredRoute()
                return
            }
            crossChain.openReview()
            return
        }
        if (executionMode === gaslessMode) {
            diagnostic('primary-action.route', {
                route: 'gas-assist', prepaidRequired: prepaid.required, gasAssistQuoteStatus: gasAssist.quoteStatus,
            })
            if (prepaid.required && prepaid.enabled) {
                prepaid.start()
                return
            }
            if (!gasAssist.quote || Date.parse(gasAssist.quote.expiresAt) <= Date.now()) {
                setVisibleStatus('The Gas Assist quote expired. Refreshing the price.')
                refreshSameChainQuote()
                return
            }
            gasAssist.open()
            return
        }
        diagnostic('review.eligibility.checked', {
            canReview: reviewEligibility.canReview,
            blockingReason: reviewEligibility.blockingReason,
            blockingMessage: reviewEligibility.blockingMessage,
            quote: quoteDiagnostic(quote),
        }, reviewEligibility.canReview ? 'debug' : 'warn')
        if (!reviewEligibility.canReview) {
            if (reviewEligibility.blockingReason === 'missing-permit2-approval-metadata') {
                diagnostic('approval.metadata.invalid-before-review', approvalMetadataDiagnostic(quote), 'error')
            }
            setVisibleStatus(reviewEligibility.blockingMessage)
            setReviewError(reviewEligibility.blockingMessage)
            if (reviewEligibility.blockingReason === 'quote-expired') clearSameChainQuoteForRefresh()
            return
        }
        if (isQuoteExpired(quote)) {
            diagnostic('review.blocked', { reason: 'quote-expired-second-check', quote: quoteDiagnostic(quote) }, 'warn')
            clearSameChainQuoteForRefresh()
            setVisibleStatus('The quote expired. Refreshing the price.')
            return
        }
        try {
            setReviewError(null)
            setReviewOperation('idle')
            openSameChainReview()
            diagnostic('review.open.requested', {
                requestKeySuffix: requestKeySuffix(quoteSnapshot?.requestKey), quote: quoteDiagnostic(quote),
            })
        } catch (error) {
            diagnostic('review.open.failed', { error: executionErrorSnapshot(error) }, 'error')
            setVisibleStatus('Unable to open swap review. Refresh the quote and try again.')
        }
    }

    async function confirmSameChainSwap() {
        setVisibleStatus(null)
        diagnostic('review.confirm.clicked', {
            actionType: action.type,
            label: action.label,
            enabled: action.enabled,
            reviewConfirmed: true,
            quoteStatus: activeQuoteStatus,
            transactionStatus,
            reviewEligibility,
            requestKeySuffix: requestKeySuffix(quoteSnapshot?.requestKey),
        })
        return confirmExecution()
    }

    return { performPrimaryAction, confirmSameChainSwap }
}
