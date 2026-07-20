import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { formatTokenAmount, getProviderDisplayName } from '../services/crossChainRoutes.js'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { formatCostUsd } from '../../swap/model/swapDisplay.js'

/**
 * Renders the existing Radix cross-chain review portal from a prepared route view model.
 * @param {{open: boolean, route: object|null, reducedMotion: boolean, activeAmountSide: string, sellToken: object|null, buyToken: object|null, costs: object, preparation: object, routeError: string|null, executionError: string|null, confirmDisabled: boolean, onClose: () => void, onConfirm: () => void}} props Review contract.
 * @returns {import('react').ReactElement|null} Portaled review dialog or null.
 * @sideEffects Radix moves focus and mounts in the app-shell portal; callbacks own wallet/transaction work.
 */
export default function CrossChainReviewDialog({
    open,
    route,
    reducedMotion,
    activeAmountSide,
    sellToken,
    buyToken,
    costs,
    preparation,
    routeError,
    executionError,
    confirmDisabled,
    onClose,
    onConfirm,
}) {
    if (!open || !route) return null
    const portalContainer = typeof document === 'undefined'
        ? undefined
        : document.querySelector('.app-shell') ?? undefined
    const confirmLabel = preparation.status === 'preparing'
        ? 'Preparing estimate...'
        : preparation.status === 'refreshing'
            ? 'Refreshing route...'
            : 'Confirm swap'

    return (
        <Dialog.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
            <Dialog.Portal container={portalContainer}>
                <Dialog.Overlay asChild>
                    <motion.div
                        className="cross-chain-review-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    />
                </Dialog.Overlay>
                <Dialog.Content asChild aria-describedby={undefined}>
                    <motion.section
                        className="cross-chain-review-dialog"
                        initial={reducedMotion ? false : { opacity: 0 }}
                        animate={reducedMotion ? undefined : { opacity: 1 }}
                        exit={reducedMotion ? undefined : { opacity: 0 }}
                        aria-busy={['preparing', 'refreshing'].includes(preparation.status)}
                    >
                        <header>
                            <Dialog.Title>Review cross-chain swap</Dialog.Title>
                            <Dialog.Close asChild>
                                <button type="button" aria-label="Close review"><X aria-hidden="true" /></button>
                            </Dialog.Close>
                        </header>
                        <div className="cross-chain-review-scroll">
                            <dl className="cross-chain-review">
                                <div>
                                    <dt>{activeAmountSide === 'buy' ? 'You pay at most' : 'You pay'}</dt>
                                    <dd>{formatTokenAmount(route.inputAmount, sellToken?.decimals)} {sellToken?.symbol}</dd>
                                </div>
                                <div>
                                    <dt>{activeAmountSide === 'buy' ? 'You receive' : 'You receive at least'}</dt>
                                    <dd>{formatTokenAmount(
                                        activeAmountSide === 'buy' ? route.outputAmount : route.minimumOutputAmount,
                                        buyToken?.decimals,
                                    )} {buyToken?.symbol}</dd>
                                </div>
                                {(costs.total || costs.route) && (
                                    <div>
                                        <dt>{costs.total ? 'Estimated total cost' : 'Estimated route cost'}</dt>
                                        <dd>{costs.total ?? costs.route}</dd>
                                    </div>
                                )}
                                <div>
                                    <dt>Source gas</dt>
                                    <dd>{costs.sourceGas ?? (
                                        preparation.status === 'preparing'
                                            ? 'Estimating...'
                                            : preparation.status === 'refreshing'
                                                ? 'Refreshing...'
                                                : preparation.gasEstimateUnavailable
                                                    ? 'Estimate unavailable'
                                                    : 'Calculated at confirmation'
                                    )}</dd>
                                </div>
                                {costs.provider !== null && <div><dt>Relay/provider costs</dt><dd>{formatCostUsd(costs.provider)}</dd></div>}
                                {costs.appFee !== null && <div><dt>PistachioSwap fee</dt><dd>{costs.appFee}</dd></div>}
                                <div><dt>Source chain</dt><dd>{getCuratedEvmChain(route.sourceChainId)?.name ?? route.sourceChainId}</dd></div>
                                <div><dt>Destination chain</dt><dd>{getCuratedEvmChain(route.destinationChainId)?.name ?? route.destinationChainId}</dd></div>
                                <div><dt>Provider</dt><dd>{getProviderDisplayName(route.provider)}</dd></div>
                                <div><dt>Estimated arrival</dt><dd>~{route.durationSeconds} seconds</dd></div>
                                <div><dt>Minimum received</dt><dd>{formatTokenAmount(route.minimumOutputAmount, buyToken?.decimals)} {buyToken?.symbol}</dd></div>
                                {route.expiresAt && <div><dt>Expires</dt><dd>{route.expiresAt}</dd></div>}
                            </dl>
                            <p className="cross-chain-cost-note">Final network cost may change with gas prices.</p>
                            {preparation.status === 'refreshing' && (
                                <p className="cross-chain-cost-note" role="status">
                                    Approval confirmed. Fetching fresh execution calldata before the swap transaction.
                                </p>
                            )}
                            {preparation.gasEstimateUnavailable && (
                                <p className="cross-chain-cost-note">Source gas estimate unavailable. Final gas will be shown by your wallet.</p>
                            )}
                            {preparation.insufficientNativeGas && (
                                <p className="cross-chain-error" role="status">Not enough {costs.nativeSymbol} for network gas.</p>
                            )}
                            {routeError && <p className="cross-chain-error" role="status">{routeError}</p>}
                            {executionError && !routeError && <p className="cross-chain-error" role="status">{executionError}</p>}
                        </div>
                        <div className="cross-chain-review-actions">
                            <button type="button" onClick={onClose}>Cancel</button>
                            <button type="button" className="primary" disabled={confirmDisabled} onClick={onConfirm}>
                                {confirmLabel}
                            </button>
                        </div>
                    </motion.section>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
