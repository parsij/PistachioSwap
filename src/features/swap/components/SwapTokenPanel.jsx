import { motion } from 'motion/react'
import SwapAmountInput from './SwapAmountInput.jsx'
import SwapQuickAmounts from './SwapQuickAmounts.jsx'
import { AnimatedSwapTokenButton } from './SwapTokenButton.jsx'

/**
 * Renders one sell or buy token panel from a semantic panel view model.
 * @param {{side: 'sell'|'buy', label: string, token: object|null, chainId: number, amount: object, secondaryValue: string, layoutIdentity: string, motionConfig: object, onOpenTokenSelector: () => void, onToggleDenomination: () => void, loading?: boolean, quickAmounts?: object, balance?: object}} props Panel contract.
 * @returns {import('react').ReactElement} Existing motion panel markup.
 * @sideEffects Emits input, selector, denomination, balance, and hover/focus callbacks only.
 */
export default function SwapTokenPanel(props) {
    const {
        side, label, token, chainId, amount, secondaryValue, layoutIdentity,
        motionConfig, onOpenTokenSelector, onToggleDenomination, loading = false,
        quickAmounts, balance, highlighted = false, invalid = false,
    } = props
    const isSell = side === 'sell'
    const panelClassName = [
        'swap-panel', `${side}-panel`,
        token ? 'panel-outlined' : 'panel-highlighted',
        invalid ? 'panel-insufficient' : '',
    ].filter(Boolean).join(' ')
    const amountClassName = [
        'sell-amount-input',
        !isSell ? 'buy-amount-input' : '',
        invalid ? 'sell-amount-insufficient' : '',
    ].filter(Boolean).join(' ')

    return (
        <motion.section
            layout
            className={panelClassName}
            transition={{ layout: motionConfig.sharedLayout }}
            onPointerEnter={quickAmounts?.onShow}
            onPointerLeave={quickAmounts?.onHide}
            onFocusCapture={quickAmounts?.onShow}
            onBlurCapture={quickAmounts?.onBlur}
            data-highlighted={highlighted || undefined}
        >
            <span className={`panel-label ${side}-label`}>{label}</span>
            {isSell && quickAmounts && (
                <SwapQuickAmounts
                    visible={quickAmounts.visible}
                    token={token}
                    spendableAmount={quickAmounts.spendableAmount}
                    onSelect={quickAmounts.onSelect}
                />
            )}
            <motion.div
                layoutId={`amount-${layoutIdentity}`}
                className={`${side}-amount-position`}
                transition={{ layout: motionConfig.sharedLayout }}
            >
                {loading ? (
                    <span className="buy-amount-loading" role="status" aria-label="Finding cross-chain route" />
                ) : (
                    <SwapAmountInput
                        value={amount.value}
                        denomination={amount.denomination}
                        label={label}
                        invalid={invalid}
                        className={amountClassName}
                        onChange={amount.onChange}
                    />
                )}
            </motion.div>
            <div className={`${side}-token-position`}>
                <AnimatedSwapTokenButton token={token} chainId={chainId} onClick={onOpenTokenSelector} />
            </div>
            <button
                type="button"
                className={`${side}-fiat-value denomination-toggle`}
                onClick={onToggleDenomination}
                aria-label={amount.denomination === 'TOKEN'
                    ? `Show ${label} amount in USD`
                    : `Show ${label} amount in ${token?.symbol ?? 'token'}`}
            >
                {secondaryValue}
            </button>
            {isSell && token && balance && (
                <button
                    type="button"
                    className={['sell-balance', invalid ? 'sell-balance-insufficient' : ''].filter(Boolean).join(' ')}
                    onClick={balance.onUseMaximum}
                    aria-label={`Use maximum ${token.symbol} balance`}
                >
                    {token.balance}{' '}{token.symbol}
                </button>
            )}
            {isSell && balance?.notice && (
                <p className="wallet-balance-status" role="status" aria-live="polite">
                    <span>{balance.notice}</span>
                    {balance.onRetry && <button type="button" onClick={balance.onRetry}>Retry</button>}
                </p>
            )}
        </motion.section>
    )
}
