import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { motion } from 'motion/react'

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
    sellAmount, buyToken, sellToken, maximumSold, minimumReceived, quoteProvider,
    slippageLabel, reviewError, confirmDisabled, confirmLabel, onConfirm,
}) {
    return <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal container={document.body}>
            <Dialog.Overlay className="swap-review-overlay" onClick={() => onOpenChange(false)} />
            <Dialog.Content ref={contentRef} className="swap-review-dialog" aria-describedby={undefined}>
                <motion.div className="swap-review-surface" initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}>
                    <header className="swap-review-header"><Dialog.Title className="swap-review-title">Review swap</Dialog.Title></header>
                    <Dialog.Close className="swap-review-close" aria-label="Close review" disabled={confirmDisabled}><X aria-hidden="true" /></Dialog.Close>
                    <dl className="swap-review-details">
                        {activeAmountSide === 'buy' ? <><div className="swap-review-detail-row"><dt>You receive</dt><dd>{buyAmount} {buyToken?.symbol}</dd></div><div className="swap-review-detail-row"><dt>You pay at most</dt><dd>{maximumSold ?? `${sellAmount} ${sellToken?.symbol}`}</dd></div></> : <><div className="swap-review-detail-row"><dt>You pay</dt><dd>{sellAmount} {sellToken?.symbol}</dd></div><div className="swap-review-detail-row"><dt>You receive at least</dt><dd>{minimumReceived ?? `${buyAmount} ${buyToken?.symbol}`}</dd></div></>}
                        <div className="swap-review-detail-row"><dt>Provider</dt><dd>{quoteProvider ?? 'Best route'}</dd></div>
                        <div className="swap-review-detail-row"><dt>Max slippage</dt><dd>{slippageLabel}</dd></div>
                    </dl>
                    {reviewError && <p className="swap-review-status" role="status">{reviewError}</p>}
                    <div className="swap-review-actions"><button type="button" className="swap-review-cancel" onClick={() => onOpenChange(false)} disabled={confirmDisabled}>Cancel</button><button type="button" className="swap-review-confirm" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button></div>
                </motion.div>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
}
