import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { getTokenDisplaySymbol } from '../../tokens/services/tokenDisplay.js'

/**
 * Purpose: renders the existing same-chain Radix review portal.
 * Inputs: explicit dialog state, quote display values, progress/error state,
 * callbacks, pending state, reduced-motion preference, and content ref.
 * Output: review dialog JSX.
 * Side effects: Radix manages focus and portal behavior; callbacks can close or confirm.
 * Errors: none. Security: confirmation is delegated only after explicit user action.
 */
export default function SameChainReviewDialog({
    open, onOpenChange, contentRef, reducedMotion, activeAmountSide, buyAmount,
    sellAmount, buyToken, sellToken, maximumSold, minimumReceived,
    slippageLabel, reviewError, confirmDisabled, confirmLabel, onConfirm,
}) {
    const waitingForConfirmation = confirmLabel === 'Waiting for confirmation...'
    const handleOpenChange = (nextOpen) => {
        if (!nextOpen && waitingForConfirmation) return
        onOpenChange(nextOpen)
    }

    return <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal container={document.body}>
            <Dialog.Overlay
                className="swap-review-overlay"
                onClick={() => !waitingForConfirmation && onOpenChange(false)}
            />
            <Dialog.Content ref={contentRef} className="swap-review-dialog" aria-describedby={undefined}>
                <motion.div className="swap-review-surface" initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}>
                    <header className="swap-review-header">
                        <Dialog.Title className="swap-review-title">
                            {waitingForConfirmation ? 'Swap submitted' : 'Review swap'}
                        </Dialog.Title>
                    </header>
                    {!waitingForConfirmation && (
                        <Dialog.Close className="swap-review-close" aria-label="Close review"><X aria-hidden="true" /></Dialog.Close>
                    )}
                    {waitingForConfirmation ? (
                        <div className="swap-review-details" role="status" aria-live="polite">
                            <div className="swap-review-detail-row">
                                <strong>Waiting for confirmation</strong>
                                <span>Your transaction is on-chain and PistachioSwap is waiting for the receipt.</span>
                            </div>
                            <p className="swap-review-status">
                                When it confirms, Recent Activity and your wallet token balances will refresh automatically.
                            </p>
                        </div>
                    ) : (
                        <dl className="swap-review-details">
                            {activeAmountSide === 'buy' ? <><div className="swap-review-detail-row"><dt>You receive</dt><dd>{buyAmount} {getTokenDisplaySymbol(buyToken)}</dd></div><div className="swap-review-detail-row"><dt>You pay at most</dt><dd>{maximumSold ?? `${sellAmount} ${getTokenDisplaySymbol(sellToken)}`}</dd></div></> : <><div className="swap-review-detail-row"><dt>You pay</dt><dd>{sellAmount} {getTokenDisplaySymbol(sellToken)}</dd></div><div className="swap-review-detail-row"><dt>You receive at least</dt><dd>{minimumReceived ?? `${buyAmount} ${getTokenDisplaySymbol(buyToken)}`}</dd></div></>}
                            <div className="swap-review-detail-row"><dt>Routing</dt><dd>Best available route</dd></div>
                            <div className="swap-review-detail-row"><dt>Max slippage</dt><dd>{slippageLabel}</dd></div>
                        </dl>
                    )}
                    {reviewError && <p className="swap-review-status" role="status">{reviewError}</p>}
                    <div className="swap-review-actions">
                        {!waitingForConfirmation && <button type="button" className="swap-review-cancel" onClick={() => onOpenChange(false)}>Cancel</button>}
                        <button type="button" className="swap-review-confirm" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
                    </div>
                </motion.div>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
}
