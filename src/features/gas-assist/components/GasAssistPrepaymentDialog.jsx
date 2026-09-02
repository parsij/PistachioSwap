import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    CheckCircle2,
    ChevronDown,
    CircleAlert,
    LoaderCircle,
    ShieldCheck,
    X,
} from 'lucide-react'
import { formatUnits } from 'viem'

import GasAssistError from './GasAssistError.jsx'
import TokenIcon from '../../tokens/components/TokenIcon.jsx'
import {
    GAS_ASSIST_REVIEW_TITLE,
    GAS_ASSIST_SWAP_ACTION,
} from '../model/gasAssistCopy.js'
import './gasAssist.css'
import { getTokenDisplaySymbol } from '../../tokens/services/tokenDisplay.js'
import { getGasAssistFeeBreakdown } from '../model/gasAssistFee.js'

function trimDecimal(value, maximumFractionDigits = 6) {
    const [whole, fraction = ''] = String(value).split('.')
    if (!fraction) return whole
    const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '')
    return trimmed ? `${whole}.${trimmed}` : whole
}

function formatUsdMicros(value) {
    if (value === null || value === undefined || !/^\d+$/.test(String(value))) return 'Unavailable'
    const micros = BigInt(value)
    const whole = micros / 1_000_000n
    const fraction = (micros % 1_000_000n)
        .toString()
        .padStart(6, '0')
        .slice(0, 4)
        .replace(/0+$/, '')
    return `$${fraction ? `${whole}.${fraction}` : whole}`
}

function formatRaw(value, decimals) {
    try {
        return trimDecimal(formatUnits(BigInt(value), Number(decimals)))
    } catch {
        return 'Unavailable'
    }
}

function Countdown({ expiresAt, onExpired }) {
    const [remaining, setRemaining] = useState(0)
    const notifiedRef = useRef(false)

    useEffect(() => {
        notifiedRef.current = false
        let timer = null
        const update = () => {
            const parsed = Date.parse(expiresAt)
            const next = Number.isFinite(parsed)
                ? Math.max(0, Math.ceil((parsed - Date.now()) / 1_000))
                : 0
            setRemaining(next)
            if (next === 0) {
                if (!notifiedRef.current) {
                    notifiedRef.current = true
                    onExpired?.()
                }
                if (timer !== null) window.clearInterval(timer)
            }
        }
        update()
        if (!notifiedRef.current) timer = window.setInterval(update, 1_000)
        return () => {
            if (timer !== null) window.clearInterval(timer)
        }
    }, [expiresAt, onExpired])

    return <span>{remaining}s</span>
}

function providerFeeRows(fees) {
    if (!fees || typeof fees !== 'object') return []
    return ['gasFee', 'zeroExFee'].flatMap((key) => {
        const fee = fees[key]
        return fee?.amount != null
            ? [[key === 'gasFee' ? 'Provider gas fee' : 'Provider fee', `${fee.amount} base units`]]
            : []
    })
}

function packageExecutionInFlight(phase, order) {
    if (order?.preSignedPackage) return true
    return [
        'package-preparing',
        'package-signing',
        'payment-confirming',
        'payment-submitting',
        'approval-confirming',
        'swap-confirming',
        'continuation-loading',
        'continuation-ready',
        'swap-signing',
    ].includes(phase) || [
        'payment-prepared',
        'payment-submitting',
        'payment-submitted',
        'payment-confirmed',
        'approval-submitted',
        'approval-confirmed',
        'swap-submitted',
        'atomic-prepared',
        'atomic-submitting',
        'atomic-submitted',
    ].includes(order?.status)
}

function statusContent({ phase, order, orderExpired }) {
    if (orderExpired) {
        return {
            tone: 'error',
            title: 'Quote expired',
            detail: 'Create a fresh Gas Assist quote to continue.',
        }
    }
    if (phase === 'preview-loading') {
        return { title: 'Loading your review', detail: 'Getting the latest route and exact Gas Assist fee.' }
    }
    if (phase === 'authenticating') {
        return { title: 'Confirm with your passkey', detail: 'One passkey check authorizes this exact sponsored transaction.' }
    }
    if (phase === 'package-preparing') {
        return { title: 'Preparing your swap', detail: 'Building one sponsored transaction for the fee, approval, and swap.' }
    }
    if (phase === 'package-signing') {
        return { title: 'Confirm with your passkey', detail: 'One passkey check authorizes this exact sponsored transaction. If it fails, no fee is taken.' }
    }
    if (['atomic-submitting', 'atomic-submitted'].includes(order?.status) ||
        (phase === 'swap-confirming' && order?.atomicExecution)) {
        return { title: 'Confirming your swap', detail: 'Confirming the one sponsored transaction on BNB Chain.' }
    }
    if (['payment-confirming', 'payment-submitting'].includes(phase) ||
        ['payment-submitting', 'payment-submitted'].includes(order?.status)) {
        return { title: 'Starting your swap', detail: 'Confirming the Gas Assist fee on BNB Chain.' }
    }
    if (phase === 'approval-confirming' || order?.status === 'approval-submitted') {
        return { title: 'Approving the token', detail: 'The backend is confirming the exact token allowance.' }
    }
    if (phase === 'swap-confirming' || order?.status === 'swap-submitted') {
        return { title: 'Completing your swap', detail: 'The final swap transaction is waiting for confirmation.' }
    }
    if (phase === 'continuation-loading') {
        return { title: 'Preparing the final swap', detail: 'Refreshing the exact route and transaction.' }
    }
    if (phase === 'continuation-ready' || phase === 'swap-signing') {
        return { title: 'Confirm the final swap', detail: 'Review the exact sponsored swap in Pistachio Wallet.' }
    }
    if (phase === 'completed') {
        return { tone: 'success', title: 'Swap complete', detail: 'Your sponsored swap was confirmed.' }
    }
    if (phase === 'cancelled') {
        return { tone: 'neutral', title: 'Nothing was sent', detail: 'The wallet request was cancelled.' }
    }
    if (phase === 'failed' || phase === 'unsupported') {
        return { tone: 'error', title: 'Swap could not continue', detail: 'Review the message below or try again.' }
    }
    return null
}

function CompactStatus({ status }) {
    if (!status) return null
    const complete = status.tone === 'success'
    const failed = status.tone === 'error'
    return (
        <section className={`gas-assist-compact-status ${status.tone ?? ''}`} role="status" aria-live="polite">
            <span className="gas-assist-status-icon" aria-hidden="true">
                {complete ? <CheckCircle2 /> : failed ? <CircleAlert /> : <LoaderCircle />}
            </span>
            <div>
                <strong>{status.title}</strong>
                <p>{status.detail}</p>
            </div>
        </section>
    )
}

function ReviewSkeleton() {
    return (
        <div className="gas-assist-review-skeleton" role="status" aria-live="polite" aria-label="Loading Gas Assist review">
            <div className="gas-assist-skeleton-token"><span /><div><i /><b /></div></div>
            <div className="gas-assist-skeleton-token"><span /><div><i /><b /></div></div>
            <div className="gas-assist-skeleton-fee"><i /><b /></div>
        </div>
    )
}

function uniqueTransactionHashes(order) {
    return [...new Set(
        [
            order.atomicTransactionHash,
            order.paymentTransactionHash,
            order.approvalTransactionHash,
            order.swapTransactionHash,
        ]
            .filter(Boolean)
            .map((value) => String(value).toLowerCase()),
    )]
}

function TechnicalDetails({ order, sellToken, buyToken, paymentToken, purpose }) {
    if (!order) return null
    const fees = getGasAssistFeeBreakdown(order)
    const hashes = uniqueTransactionHashes(order)
    const atomic = purpose !== 'cross-chain-gas' && (
        order.atomicExecution === true ||
        hashes.length === 1
    )
    return (
        <details className="gas-assist-technical">
            <summary>
                <span>Transaction details</span>
                <ChevronDown aria-hidden="true" />
            </summary>
            <div className="gas-assist-technical-content">
                {order && paymentToken && (
                    <div className="gas-assist-details">
                        <div><span>Gross input</span><strong>{formatRaw(order.grossInputAmountRaw, sellToken?.decimals)} {getTokenDisplaySymbol(sellToken)}</strong></div>
                        <div><span>Net swap input</span><strong>{formatRaw(order.netSwapAmountRaw, sellToken?.decimals)} {getTokenDisplaySymbol(sellToken)}</strong></div>
                        <div><span>Exact Gas Assist fee</span><strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {getTokenDisplaySymbol(paymentToken)}</strong></div>
                        <div><span>Total Gas Assist fee value</span><strong>{formatUsdMicros(fees?.totalFeeUsdMicros)}</strong></div>
                        {purpose === 'cross-chain-gas' && fees?.routeCostUsdMicros != null && fees.allInCostUsdMicros != null && (
                            <div><span>Total cross-chain cost (all-in)</span><strong>{formatUsdMicros(fees.allInCostUsdMicros)}</strong></div>
                        )}
                        {purpose === 'cross-chain-gas' && fees?.routeCostUsdMicros != null && (
                            <div><span>Route costs</span><strong>{formatUsdMicros(fees.routeCostUsdMicros)}</strong></div>
                        )}
                        <div><span>Network-fee reserve</span><strong>{formatUsdMicros(order.gasReserveUsdMicros)}</strong></div>
                        {fees?.estimatedSponsoredGasUsdMicros != null && (
                            <div><span>Estimated sponsored gas</span><strong>{formatUsdMicros(fees.estimatedSponsoredGasUsdMicros)}</strong></div>
                        )}
                        <div><span>Service fee</span><strong>{formatUsdMicros(order.fixedServiceFeeUsdMicros)}</strong></div>
                        <div><span>Trade fee</span><strong>{formatUsdMicros(order.platformFeeUsdMicros)}</strong></div>
                        <div><span>Minimum output</span><strong>{formatRaw(order.minimumOutputRaw, buyToken?.decimals)} {getTokenDisplaySymbol(buyToken)}</strong></div>
                        {providerFeeRows(order.providerFees).map(([label, value]) => (
                            <div key={`${label}:${value}`}><span>{label}</span><strong>{value}</strong></div>
                        ))}
                        <div><span>Quote expires</span><strong><Countdown expiresAt={order.expiresAt} /></strong></div>
                        {atomic && hashes[0] && (
                            <div><span>Transaction</span><code>{hashes[0]}</code></div>
                        )}
                        {!atomic && order.paymentTransactionHash && <div><span>Fee transaction</span><code>{order.paymentTransactionHash}</code></div>}
                        {!atomic && order.approvalTransactionHash && <div><span>Approval transaction</span><code>{order.approvalTransactionHash}</code></div>}
                        {!atomic && order.swapTransactionHash && <div><span>Swap transaction</span><code>{order.swapTransactionHash}</code></div>}
                    </div>
                )}
                <p className="gas-assist-technical-note">
                    Pistachio Wallet signs one direct EIP-7702 BNB Chain transaction. The disclosed fee goes to PistachioSwap, the swap principal goes directly through the quoted router, and everything reverts if the swap fails.
                </p>
            </div>
        </details>
    )
}

/** Renders a compact prepaid Gas Assist review while preserving optional technical diagnostics. */
export default function GasAssistPrepaymentDialog({
    sponsorship,
    sellToken,
    buyToken,
    purpose = 'swap',
}) {
    const [expired, setExpired] = useState(false)
    const order = sponsorship?.order
    const paymentToken = useMemo(() => {
        if (!order) return null
        if (order.paymentToken?.toLowerCase() === sellToken?.address?.toLowerCase()) return sellToken
        if (order.paymentToken?.toLowerCase() === buyToken?.address?.toLowerCase()) return buyToken
        return {
            address: order.paymentToken,
            symbol: order.paymentTokenSymbol ?? 'Token',
            decimals: order.paymentTokenDecimals,
        }
    }, [buyToken, order, sellToken])
    const feeBreakdown = useMemo(() => getGasAssistFeeBreakdown(order), [order])

    useEffect(() => setExpired(false), [order?.expiresAt, order?.id])

    if (!sponsorship?.open) return null

    const walletBusy = sponsorship.phase === 'preview-loading' ||
        sponsorship.phase === 'authenticating' ||
        sponsorship.phase === 'continuation-loading' ||
        sponsorship.phase.endsWith('-preparing') ||
        sponsorship.phase.endsWith('-signing')
    const waitingForChain = ['payment-confirming', 'approval-confirming', 'swap-confirming'].includes(sponsorship.phase) ||
        ['payment-submitting', 'payment-submitted', 'approval-submitted', 'swap-submitted', 'atomic-submitting', 'atomic-submitted'].includes(order?.status)
    const orderExpired = !packageExecutionInFlight(sponsorship.phase, order) &&
        (expired || Boolean(order?.expiresAt && Date.parse(order.expiresAt) <= Date.now()))
    const requiredAction = order?.currentRequiredAction
    const showPayment = sponsorship.phase === 'review' &&
        (!requiredAction || requiredAction === 'prepare-payment')
    const showApproval = requiredAction === 'prepare-approval'
    const showContinuationRequest = requiredAction === 'prepare-sponsored-swap'
    const showContinuationSign = sponsorship.phase === 'continuation-ready'
    const status = statusContent({ phase: sponsorship.phase, order, orderExpired })
    const visibleError = orderExpired ? null : sponsorship.error
    const terminalFailure = ['failed', 'cancelled', 'unsupported'].includes(sponsorship.phase)

    let primaryAction = null
    let primaryLabel = null
    if (!terminalFailure && !orderExpired && showPayment && sponsorship.signPackage) {
        primaryAction = sponsorship.signPackage
        primaryLabel = GAS_ASSIST_SWAP_ACTION
    } else if (!terminalFailure && !orderExpired && showPayment && sponsorship.signPayment) {
        primaryAction = sponsorship.signPayment
        primaryLabel = GAS_ASSIST_SWAP_ACTION
    } else if (!terminalFailure && !orderExpired && showApproval) {
        primaryAction = sponsorship.signApproval
        primaryLabel = 'Continue'
    } else if (!terminalFailure && !orderExpired && showContinuationRequest) {
        primaryAction = sponsorship.requestContinuation
        primaryLabel = 'Continue'
    } else if (!terminalFailure && !orderExpired && showContinuationSign) {
        primaryAction = sponsorship.signContinuation
        primaryLabel = 'Confirm swap'
    }

    const canRetry = terminalFailure || orderExpired
    const retryAction = orderExpired
        ? sponsorship.refreshQuote ?? sponsorship.retryStart
        : sponsorship.retryStart
    const retryLabel = orderExpired
        ? (sponsorship.refreshing ? 'Refreshing quote…' : 'Refresh quote')
        : 'Try again'

    return (
        <Dialog.Root open onOpenChange={(open) => !open && !walletBusy && !waitingForChain && sponsorship.close()}>
            <Dialog.Portal>
                <Dialog.Overlay className="gas-assist-overlay" />
                <Dialog.Content className="gas-assist-dialog gas-assist-prepayment-dialog">
                    <div className="gas-assist-heading gas-assist-simple-heading">
                        <div>
                            <div className="gas-assist-kicker"><ShieldCheck aria-hidden="true" /> No BNB needed</div>
                            <Dialog.Title>{GAS_ASSIST_REVIEW_TITLE}</Dialog.Title>
                            <Dialog.Description>{purpose === 'cross-chain-gas'
                                ? 'PistachioSwap sponsors the exact source-chain transaction with MegaFuel and deducts one clear fee from your sell token. No BNB is sent to your wallet.'
                                : 'PistachioSwap covers the network fee and deducts one clear fee from your sell token.'}</Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button className="gas-assist-close" type="button" disabled={walletBusy || waitingForChain} aria-label="Close">
                                <X aria-hidden="true" />
                            </button>
                        </Dialog.Close>
                    </div>

                    {!order && sponsorship.phase === 'preview-loading' && <ReviewSkeleton />}
                    {order && paymentToken && (
                        <div className="gas-assist-swap-summary">
                            <div className="gas-assist-summary-token">
                                <TokenIcon token={sellToken} />
                                <div>
                                    <span>You pay</span>
                                    <strong>{formatRaw(order.grossInputAmountRaw, sellToken?.decimals)} {getTokenDisplaySymbol(sellToken)}</strong>
                                </div>
                            </div>
                            <div className="gas-assist-summary-token">
                                <TokenIcon token={buyToken} />
                                <div>
                                    <span>You receive</span>
                                    <strong>{formatRaw(order.expectedOutputRaw, buyToken?.decimals)} {getTokenDisplaySymbol(buyToken)}</strong>
                                </div>
                            </div>
                            <div className="gas-assist-summary-fee">
                                <span>{purpose === 'cross-chain-gas' ? 'Gas Assist fee (included)' : 'Gas Assist fee (all-in)'}</span>
                                <strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {getTokenDisplaySymbol(paymentToken)}</strong>
                                <small>{formatUsdMicros(feeBreakdown?.totalFeeUsdMicros)} · network reserve + PistachioSwap fee</small>
                            </div>
                            {purpose === 'cross-chain-gas' && feeBreakdown?.routeCostUsdMicros != null && feeBreakdown.allInCostUsdMicros != null && (
                                <div className="gas-assist-summary-fee">
                                    <span>Total cross-chain cost (all-in)</span>
                                    <strong>{formatUsdMicros(feeBreakdown.allInCostUsdMicros)}</strong>
                                    <small>Route costs + Gas Assist fee</small>
                                </div>
                            )}
                            <Countdown expiresAt={order.expiresAt} onExpired={() => setExpired(true)} />
                        </div>
                    )}

                    {status &&
                        sponsorship.phase !== 'preview-loading' &&
                        (sponsorship.phase !== 'review' || orderExpired) && (
                        <CompactStatus status={status} />
                    )}
                    {visibleError && <GasAssistError error={visibleError} />}

                    {primaryAction && (
                        <button
                            className="gas-assist-primary gas-assist-swap-button"
                            type="button"
                            onClick={primaryAction}
                            disabled={walletBusy || waitingForChain}
                        >
                            {walletBusy ? 'Preparing…' : primaryLabel}
                        </button>
                    )}
                    {primaryAction && sponsorship.signPackage && showPayment && (
                        <p className="gas-assist-one-tap-note">
                            {purpose === 'cross-chain-gas'
                                ? 'One tap starts the flow. Pistachio Wallet will ask you to confirm the sponsored source swap.'
                                : 'One tap starts the flow. Pistachio Wallet will ask you to confirm one sponsored transaction. If it fails, no fee is taken.'}
                        </p>
                    )}
                    {canRetry && retryAction && (
                        <button
                            className="gas-assist-secondary"
                            type="button"
                            onClick={retryAction}
                            disabled={walletBusy || sponsorship.refreshing}
                            aria-busy={sponsorship.refreshing || undefined}
                        >
                            {sponsorship.refreshing && <LoaderCircle aria-hidden="true" />}
                            {retryLabel}
                        </button>
                    )}
                    {sponsorship.phase === 'completed' && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.close}>Done</button>
                    )}

                    <TechnicalDetails
                        order={order}
                        sellToken={sellToken}
                        buyToken={buyToken}
                        paymentToken={paymentToken}
                        purpose={purpose}
                    />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
