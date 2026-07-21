import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { formatUnits } from 'viem'

import GasAssistError from './GasAssistError.jsx'
import TokenIcon from '../../tokens/components/TokenIcon.jsx'
import './gasAssist.css'

function formatUsdMicros(value) {
    if (value === null || value === undefined || !/^\d+$/.test(String(value))) return 'Unavailable'
    const micros = BigInt(value)
    const whole = micros / 1_000_000n
    const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
    return `$${fraction ? `${whole}.${fraction}` : whole}`
}

function formatRaw(value, decimals) {
    try {
        return formatUnits(BigInt(value), Number(decimals))
    } catch {
        return 'Unavailable'
    }
}

function Countdown({ expiresAt, onExpired }) {
    const [remaining, setRemaining] = useState(0)
    useEffect(() => {
        const update = () => {
            const next = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000))
            setRemaining(next)
            if (next === 0) onExpired?.()
        }
        update()
        const timer = window.setInterval(update, 1_000)
        return () => window.clearInterval(timer)
    }, [expiresAt, onExpired])
    return <span>{remaining}s</span>
}

function providerFeeRows(fees) {
    if (!fees || typeof fees !== 'object') return []
    return ['gasFee', 'zeroExFee'].flatMap((key) => {
        const fee = fees[key]
        return fee?.amount != null
            ? [[key === 'gasFee' ? '0x gas fee' : '0x fee', `${fee.amount} base units`]]
            : []
    })
}

function ConfirmationProgress({ title, detail, transactionHash, confirmationCount }) {
    return (
        <section className="gas-assist-confirmation" role="status" aria-live="polite">
            <div className="gas-assist-confirmation-heading">
                <span className="gas-assist-confirmation-dot" aria-hidden="true" />
                <strong>{title}</strong>
            </div>
            <p>{detail}</p>
            <div className="gas-assist-progress-track" aria-hidden="true"><span /></div>
            {Number.isFinite(Number(confirmationCount)) && Number(confirmationCount) > 0 && (
                <small>{confirmationCount} confirmation{Number(confirmationCount) === 1 ? '' : 's'} observed</small>
            )}
            {transactionHash && <code>{transactionHash}</code>}
        </section>
    )
}

/** Renders prepaid sponsorship review/status and invokes only supplied semantic actions. */
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
            symbol: order.paymentTokenSymbol ?? 'Payment token',
            decimals: order.paymentTokenDecimals,
        }
    }, [buyToken, order, sellToken])
    if (!sponsorship.open) return null
    const paymentWaiting = ['payment-submitting', 'payment-submitted'].includes(order?.status) ||
        sponsorship.phase === 'payment-confirming'
    const approvalWaiting = order?.status === 'approval-submitted' || sponsorship.phase === 'approval-confirming'
    const swapWaiting = order?.status === 'swap-submitted' || sponsorship.phase === 'swap-confirming'
    const waitingForConfirmation = paymentWaiting || approvalWaiting || swapWaiting
    const busy = sponsorship.phase.endsWith('-preparing') || sponsorship.phase.endsWith('-signing') ||
        sponsorship.phase === 'authenticating' || sponsorship.phase === 'continuation-loading' || waitingForConfirmation
    const orderExpired = expired || Boolean(order?.expiresAt && Date.parse(order.expiresAt) <= Date.now())
    const requiredAction = order?.currentRequiredAction
    const showPayment = sponsorship.phase === 'review' || requiredAction === 'prepare-payment'
    const showApproval = requiredAction === 'prepare-approval'
    const showContinuationRequest = requiredAction === 'prepare-sponsored-swap'
    const showContinuationSign = sponsorship.phase === 'continuation-ready'

    return (
        <Dialog.Root open onOpenChange={(open) => !open && sponsorship.close()}>
            <Dialog.Portal>
                <Dialog.Overlay className="gas-assist-overlay" />
                <Dialog.Content className="gas-assist-dialog gas-assist-prepayment-dialog">
                    <div className="gas-assist-heading">
                        <div>
                            <Dialog.Title>Gas Assist Prepayment</Dialog.Title>
                            <Dialog.Description>Pistachio Wallet exact-transaction sponsorship via NodeReal MegaFuel</Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button className="gas-assist-close" type="button" disabled={busy} aria-label="Close">
                                <X aria-hidden="true" />
                            </button>
                        </Dialog.Close>
                    </div>

                    {order && paymentToken && (
                        <>
                            <div className="gas-assist-token-row">
                                <TokenIcon token={paymentToken} />
                                <div>
                                    <strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {paymentToken.symbol}</strong>
                                    <span>Exact sponsorship payment · {String(order.paymentTokenReason).replaceAll('-', ' ')}</span>
                                </div>
                            </div>
                            <div className="gas-assist-details">
                                <div><span>Gross amount supplied</span><strong>{formatRaw(order.grossInputAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong></div>
                                <div><span>Exact sponsorship payment</span><strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {paymentToken.symbol}</strong></div>
                                <div><span>Payment transfer gas</span><strong>{formatUsdMicros(order.estimatedPaymentGasUsdMicros)}</strong></div>
                                <div><span>Approval gas</span><strong>{formatUsdMicros(order.estimatedApprovalGasUsdMicros)}</strong></div>
                                {BigInt(order.estimatedSwapGasUsdMicros ?? 0) > 0n && <div><span>Swap gas</span><strong>{formatUsdMicros(order.estimatedSwapGasUsdMicros)}</strong></div>}
                                <div><span>1.5× gas reserve</span><strong>{formatUsdMicros(order.gasReserveUsdMicros)}</strong></div>
                                <div><span>Fixed service fee</span><strong>{formatUsdMicros(order.fixedServiceFeeUsdMicros)}</strong></div>
                                <div><span>3% trade fee</span><strong>{formatUsdMicros(order.platformFeeUsdMicros)}</strong></div>
                                {BigInt(order.conversionCostUsdMicros ?? 0) > 0n && <div><span>Token-to-BNB conversion cost</span><strong>{formatUsdMicros(order.conversionCostUsdMicros)}</strong></div>}
                                <div><span>Total prepayment</span><strong>{formatUsdMicros(order.totalPrepaymentUsdMicros)}</strong></div>
                                <div><span>Net swap input</span><strong>{formatRaw(order.netSwapAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong></div>
                                <div><span>Expected output</span><strong>{formatRaw(order.expectedOutputRaw, buyToken?.decimals)} {buyToken?.symbol}</strong></div>
                                <div><span>Minimum output</span><strong>{formatRaw(order.minimumOutputRaw, buyToken?.decimals)} {buyToken?.symbol}</strong></div>
                                {providerFeeRows(order.providerFees).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                                <div><span>Current authorization expires</span><strong><Countdown expiresAt={order.expiresAt} onExpired={() => setExpired(true)} /></strong></div>
                            </div>
                            <div className="gas-assist-disclosure">
                                <strong>Pistachio Wallet signs only the exact backend-prepared token, recipient, amount, nonce, calldata, gas limit, and zero gas price.</strong>
                                <span>The backend rejects any changed or user-created transaction before it reaches MegaFuel.</span>
                                <span>Pistachio Wallet signs payment, exact approval, and swap before the first broadcast.</span>
                                <span>The backend stores all three raw transactions first, then broadcasts them sequentially after each on-chain confirmation.</span>
                                <span>They remain separate transactions and are not atomic.</span>
                            </div>
                        </>
                    )}

                    {paymentWaiting && (
                        <ConfirmationProgress
                            title="Waiting for exact payment confirmation"
                            detail="The backend is verifying that the treasury received the exact required token amount. Approval and swap sponsorship remain locked until this check passes."
                            transactionHash={order?.paymentTransactionHash}
                            confirmationCount={order?.confirmationCount}
                        />
                    )}
                    {approvalWaiting && (
                        <ConfirmationProgress
                            title="Waiting for sponsored approval confirmation"
                            detail="The action policy submitted the exact approval. The swap remains locked until the allowance is confirmed on-chain."
                            transactionHash={order?.approvalTransactionHash}
                            confirmationCount={order?.confirmationCount}
                        />
                    )}
                    {swapWaiting && (
                        <ConfirmationProgress
                            title="Waiting for sponsored swap confirmation"
                            detail="The action policy submitted the exact validated swap. PistachioSwap is waiting for the final receipt."
                            transactionHash={order?.swapTransactionHash}
                            confirmationCount={order?.confirmationCount}
                        />
                    )}
                    {order?.status === 'payment-confirmed' && showApproval && (
                        <p className="gas-assist-status gas-assist-confirmed" role="status">Exact payment confirmed. Approval sponsorship is now unlocked.</p>
                    )}
                    {sponsorship.phase === 'authenticating' && <p className="gas-assist-status" role="status">Authenticate Pistachio Wallet to request an authoritative review.</p>}
                    {sponsorship.phase === 'unsupported' && <GasAssistError error={sponsorship.error} />}
                    {sponsorship.error && sponsorship.phase !== 'unsupported' && <GasAssistError error={sponsorship.error} />}
                    {orderExpired && <p className="gas-assist-status" role="status">This order or action expired. Request a fresh review.</p>}
                    {sponsorship.phase === 'package-signing' && <p className="gas-assist-status" role="status">Confirm the payment, exact approval, and swap transactions. Nothing is broadcast until all three are stored.</p>}
                    {sponsorship.phase === 'payment-signing' && <p className="gas-assist-status" role="status">Confirm the exact payment transaction in Pistachio Wallet.</p>}
                    {sponsorship.phase === 'approval-signing' && <p className="gas-assist-status" role="status">Confirm the exact approval transaction in Pistachio Wallet.</p>}
                    {sponsorship.intentExpiresAt && (
                        <p className="gas-assist-status" role="status">
                            Current signing intent expires in <Countdown expiresAt={sponsorship.intentExpiresAt} />
                        </p>
                    )}
                    {sponsorship.phase === 'swap-signing' && <p className="gas-assist-status" role="status">Confirm the exact sponsored swap transaction in Pistachio Wallet.</p>}
                    {sponsorship.phase === 'completed' && <p className="gas-assist-status" role="status">Sponsored swap confirmed.</p>}

                    {!orderExpired && showPayment && sponsorship.signPackage && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signPackage} disabled={busy}>
                            Sign payment, approval, and swap
                        </button>
                    )}
                    {!orderExpired && showPayment && !sponsorship.signPackage && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signPayment} disabled={busy}>
                            Sign exact payment transaction
                        </button>
                    )}
                    {!orderExpired && showApproval && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signApproval} disabled={busy}>
                            Sign exact approval transaction
                        </button>
                    )}
                    {!orderExpired && showContinuationRequest && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.requestContinuation} disabled={busy}>
                            Prepare exact sponsored swap
                        </button>
                    )}
                    {!orderExpired && showContinuationSign && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signContinuation} disabled={busy}>
                            Sign exact sponsored swap
                        </button>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
