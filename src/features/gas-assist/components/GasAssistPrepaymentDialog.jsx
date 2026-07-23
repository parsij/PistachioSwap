import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    CheckCircle2,
    ChevronDown,
    LoaderCircle,
    ShieldCheck,
    X,
} from 'lucide-react'
import { formatUnits } from 'viem'

import GasAssistError from './GasAssistError.jsx'
import TokenIcon from '../../tokens/components/TokenIcon.jsx'
import './gasAssist.css'

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

function statusContent({ phase, order, orderExpired }) {
    if (orderExpired) {
        return {
            tone: 'error',
            title: 'Quote expired',
            detail: 'Create a fresh Gas Assist quote to continue.',
        }
    }
    if (phase === 'authenticating') {
        return { title: 'Checking your wallet', detail: 'Confirm the wallet authentication request.' }
    }
    if (phase === 'package-preparing') {
        return { title: 'Preparing your swap', detail: 'Building the exact fee, approval, and swap transactions.' }
    }
    if (phase === 'package-signing') {
        return { title: 'Confirm in Pistachio Wallet', detail: 'Review and confirm the three exact transactions. Nothing is broadcast until all are signed.' }
    }
    if (['payment-confirming', 'payment-submitting'].includes(phase) ||
        ['payment-submitting', 'payment-submitted'].includes(order?.status)) {
        return { title: 'Starting your gasless swap', detail: 'Confirming the Gas Assist fee before the approval and swap continue automatically.' }
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
    return (
        <section className={`gas-assist-compact-status ${status.tone ?? ''}`} role="status" aria-live="polite">
            <span className="gas-assist-status-icon" aria-hidden="true">
                {complete ? <CheckCircle2 /> : <LoaderCircle />}
            </span>
            <div>
                <strong>{status.title}</strong>
                <p>{status.detail}</p>
            </div>
        </section>
    )
}

function TechnicalDetails({ order, sellToken, buyToken, paymentToken, error }) {
    if (!order && !error) return null
    return (
        <details className="gas-assist-technical">
            <summary>
                <span>Transaction details</span>
                <ChevronDown aria-hidden="true" />
            </summary>
            <div className="gas-assist-technical-content">
                {order && paymentToken && (
                    <div className="gas-assist-details">
                        <div><span>Gross input</span><strong>{formatRaw(order.grossInputAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong></div>
                        <div><span>Net swap input</span><strong>{formatRaw(order.netSwapAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong></div>
                        <div><span>Exact Gas Assist fee</span><strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {paymentToken.symbol}</strong></div>
                        <div><span>Total fee value</span><strong>{formatUsdMicros(order.totalPrepaymentUsdMicros)}</strong></div>
                        <div><span>Network-fee reserve</span><strong>{formatUsdMicros(order.gasReserveUsdMicros)}</strong></div>
                        <div><span>Service fee</span><strong>{formatUsdMicros(order.fixedServiceFeeUsdMicros)}</strong></div>
                        <div><span>Trade fee</span><strong>{formatUsdMicros(order.platformFeeUsdMicros)}</strong></div>
                        <div><span>Minimum output</span><strong>{formatRaw(order.minimumOutputRaw, buyToken?.decimals)} {buyToken?.symbol}</strong></div>
                        {providerFeeRows(order.providerFees).map(([label, value]) => (
                            <div key={`${label}:${value}`}><span>{label}</span><strong>{value}</strong></div>
                        ))}
                        <div><span>Quote expires</span><strong><Countdown expiresAt={order.expiresAt} /></strong></div>
                        {order.paymentTransactionHash && <div><span>Fee transaction</span><code>{order.paymentTransactionHash}</code></div>}
                        {order.approvalTransactionHash && <div><span>Approval transaction</span><code>{order.approvalTransactionHash}</code></div>}
                        {order.swapTransactionHash && <div><span>Swap transaction</span><code>{order.swapTransactionHash}</code></div>}
                    </div>
                )}
                {error && (
                    <div className="gas-assist-debug-error">
                        <div><span>Error code</span><strong>{error.code ?? 'UNKNOWN_ERROR'}</strong></div>
                        {error.stage && <div><span>Stage</span><strong>{error.stage}</strong></div>}
                        {error.requestId && <div><span>Request ID</span><code>{error.requestId}</code></div>}
                    </div>
                )}
                <p className="gas-assist-technical-note">
                    Pistachio Wallet signs the exact fee transfer, exact approval, and exact swap before the backend broadcasts them in order. They are separate blockchain transactions.
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
}) {
    const [expired, setExpired] = useState(false)
    const order = sponsorship.order
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

    useEffect(() => setExpired(false), [order?.id])

    if (!sponsorship.open) return null

    const walletBusy = sponsorship.phase === 'authenticating' ||
        sponsorship.phase === 'continuation-loading' ||
        sponsorship.phase.endsWith('-preparing') ||
        sponsorship.phase.endsWith('-signing')
    const waitingForChain = ['payment-confirming', 'approval-confirming', 'swap-confirming'].includes(sponsorship.phase) ||
        ['payment-submitting', 'payment-submitted', 'approval-submitted', 'swap-submitted'].includes(order?.status)
    const orderExpired = expired || Boolean(order?.expiresAt && Date.parse(order.expiresAt) <= Date.now())
    const requiredAction = order?.currentRequiredAction
    const showPayment = sponsorship.phase === 'review' || requiredAction === 'prepare-payment'
    const showApproval = requiredAction === 'prepare-approval'
    const showContinuationRequest = requiredAction === 'prepare-sponsored-swap'
    const showContinuationSign = sponsorship.phase === 'continuation-ready'
    const status = statusContent({ phase: sponsorship.phase, order, orderExpired })
    const visibleError = sponsorship.error
    const technicalError = sponsorship.error ?? sponsorship.lastPollError

    let primaryAction = null
    let primaryLabel = null
    if (!orderExpired && showPayment && sponsorship.signPackage) {
        primaryAction = sponsorship.signPackage
        primaryLabel = 'Swap without BNB'
    } else if (!orderExpired && showPayment && sponsorship.signPayment) {
        primaryAction = sponsorship.signPayment
        primaryLabel = 'Continue without BNB'
    } else if (!orderExpired && showApproval) {
        primaryAction = sponsorship.signApproval
        primaryLabel = 'Continue'
    } else if (!orderExpired && showContinuationRequest) {
        primaryAction = sponsorship.requestContinuation
        primaryLabel = 'Continue'
    } else if (!orderExpired && showContinuationSign) {
        primaryAction = sponsorship.signContinuation
        primaryLabel = 'Confirm swap'
    }

    const canRetry = ['failed', 'cancelled', 'unsupported'].includes(sponsorship.phase) || orderExpired

    return (
        <Dialog.Root open onOpenChange={(open) => !open && sponsorship.close()}>
            <Dialog.Portal>
                <Dialog.Overlay className="gas-assist-overlay" />
                <Dialog.Content className="gas-assist-dialog gas-assist-prepayment-dialog">
                    <div className="gas-assist-heading gas-assist-simple-heading">
                        <div>
                            <div className="gas-assist-kicker"><ShieldCheck aria-hidden="true" /> No BNB needed</div>
                            <Dialog.Title>Swap without gas</Dialog.Title>
                            <Dialog.Description>PistachioSwap covers the network fee and deducts one clear fee from your sell token.</Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button className="gas-assist-close" type="button" disabled={walletBusy} aria-label="Close">
                                <X aria-hidden="true" />
                            </button>
                        </Dialog.Close>
                    </div>

                    {order && paymentToken && (
                        <div className="gas-assist-swap-summary">
                            <div className="gas-assist-summary-token">
                                <TokenIcon token={sellToken} />
                                <div>
                                    <span>You pay</span>
                                    <strong>{formatRaw(order.grossInputAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong>
                                </div>
                            </div>
                            <div className="gas-assist-summary-token">
                                <TokenIcon token={buyToken} />
                                <div>
                                    <span>You receive</span>
                                    <strong>{formatRaw(order.expectedOutputRaw, buyToken?.decimals)} {buyToken?.symbol}</strong>
                                </div>
                            </div>
                            <div className="gas-assist-summary-fee">
                                <span>Gas Assist fee</span>
                                <strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {paymentToken.symbol}</strong>
                                <small>{formatUsdMicros(order.totalPrepaymentUsdMicros)}</small>
                            </div>
                            <Countdown expiresAt={order.expiresAt} onExpired={() => setExpired(true)} />
                        </div>
                    )}

                    {status && sponsorship.phase !== 'review' && <CompactStatus status={status} />}
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
                            One tap starts the flow. Pistachio Wallet will ask you to confirm the exact fee, approval, and swap before anything is sent.
                        </p>
                    )}
                    {canRetry && sponsorship.retryStart && (
                        <button className="gas-assist-secondary" type="button" onClick={sponsorship.retryStart} disabled={walletBusy}>
                            Try again
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
                        error={technicalError}
                    />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
