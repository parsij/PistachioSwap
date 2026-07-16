import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { formatUnits } from 'viem'

import GasAssistError from './GasAssistError.jsx'
import TokenIcon from '../TokenIcon.jsx'
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
    const busy = sponsorship.phase.endsWith('-preparing') || sponsorship.phase.endsWith('-signing') ||
        sponsorship.phase === 'authenticating' || sponsorship.phase === 'continuation-loading'
    const orderExpired = expired || Boolean(order?.expiresAt && Date.parse(order.expiresAt) <= Date.now())
    const requiredAction = order?.currentRequiredAction
    const showPayment = sponsorship.phase === 'review' || requiredAction === 'prepare-payment'
    const showApproval = requiredAction === 'prepare-approval'
    const showContinuationRequest = requiredAction === 'request-fresh-zero-x-quote'
    const showContinuationSign = sponsorship.phase === 'continuation-ready'

    return (
        <Dialog.Root open onOpenChange={(open) => !open && sponsorship.close()}>
            <Dialog.Portal>
                <Dialog.Overlay className="gas-assist-overlay" />
                <Dialog.Content className="gas-assist-dialog gas-assist-prepayment-dialog">
                    <div className="gas-assist-heading">
                        <div>
                            <Dialog.Title>Gas Assist Prepayment</Dialog.Title>
                            <Dialog.Description>Sponsored by PistachioSwap via NodeReal MegaFuel</Dialog.Description>
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
                                    <span>Sponsorship payment · {String(order.paymentTokenReason).replaceAll('-', ' ')}</span>
                                </div>
                            </div>
                            <div className="gas-assist-details">
                                <div><span>Gross amount supplied</span><strong>{formatRaw(order.grossInputAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong></div>
                                <div><span>Sponsorship payment</span><strong>{formatRaw(order.paymentAmountRaw, order.paymentTokenDecimals)} {paymentToken.symbol}</strong></div>
                                <div><span>Payment transfer gas</span><strong>{formatUsdMicros(order.estimatedPaymentGasUsdMicros)}</strong></div>
                                <div><span>Approval gas</span><strong>{formatUsdMicros(order.estimatedApprovalGasUsdMicros)}</strong></div>
                                {BigInt(order.estimatedSwapGasUsdMicros ?? 0) > 0n && <div><span>Normal swap gas</span><strong>{formatUsdMicros(order.estimatedSwapGasUsdMicros)}</strong></div>}
                                <div><span>1.5× gas reserve</span><strong>{formatUsdMicros(order.gasReserveUsdMicros)}</strong></div>
                                <div><span>Fixed service fee</span><strong>$0.067</strong></div>
                                <div><span>3% trade fee</span><strong>{formatUsdMicros(order.platformFeeUsdMicros)}</strong></div>
                                <div><span>Commercial fee cap</span><strong>$5</strong></div>
                                <div><span>Total prepayment</span><strong>{formatUsdMicros(order.totalPrepaymentUsdMicros)}</strong></div>
                                <div><span>Net swap input</span><strong>{formatRaw(order.netSwapAmountRaw, sellToken?.decimals)} {sellToken?.symbol}</strong></div>
                                <div><span>Expected output</span><strong>{formatRaw(order.expectedOutputRaw, buyToken?.decimals)} {buyToken?.symbol}</strong></div>
                                <div><span>Minimum output</span><strong>{formatRaw(order.minimumOutputRaw, buyToken?.decimals)} {buyToken?.symbol}</strong></div>
                                {providerFeeRows(order.providerFees).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                                <div><span>Order expires</span><strong><Countdown expiresAt={order.expiresAt} onExpired={() => setExpired(true)} /></strong></div>
                            </div>
                            <div className="gas-assist-disclosure">
                                <strong>Your first sponsored transaction pays the Gas Assist charge to PistachioSwap. After confirmation, that payment authorizes only the exact approval and swap shown here.</strong>
                                <span>These actions are separate transactions, not one atomic transaction.</span>
                                <span>The $0.067 service fee is earned after payment confirms. The 3% fee settles only after the swap succeeds.</span>
                                <span>Unused gas margin and an unsettled 3% reserve become non-withdrawable sponsorship credit tied to this wallet.</span>
                            </div>
                        </>
                    )}

                    {sponsorship.phase === 'authenticating' && <p className="gas-assist-status" role="status">Authenticate your wallet to request an authoritative five-minute review.</p>}
                    {sponsorship.phase === 'unsupported' && <GasAssistError error={sponsorship.error} />}
                    {sponsorship.error && sponsorship.phase !== 'unsupported' && <GasAssistError error={sponsorship.error} />}
                    {orderExpired && <p className="gas-assist-status" role="status">This order or action expired. Request a fresh review.</p>}
                    {sponsorship.phase === 'payment-signing' && <p className="gas-assist-status" role="status">Confirm the exact payment transaction signature in your wallet.</p>}
                    {sponsorship.phase === 'approval-signing' && <p className="gas-assist-status" role="status">Confirm the exact approval transaction signature in your wallet.</p>}
                    {sponsorship.intentExpiresAt && (
                        <p className="gas-assist-status" role="status">
                            Current signing intent expires in <Countdown expiresAt={sponsorship.intentExpiresAt} />
                        </p>
                    )}
                    {sponsorship.phase === 'zero-x-signing' && <p className="gas-assist-status" role="status">Confirm the fresh 0x trade signature in your wallet.</p>}
                    {sponsorship.phase === 'completed' && <p className="gas-assist-status" role="status">Sponsored swap confirmed.</p>}

                    {!orderExpired && showPayment && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signPayment} disabled={busy}>
                            Sign payment transaction
                        </button>
                    )}
                    {!orderExpired && showApproval && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signApproval} disabled={busy}>
                            Sign approval transaction
                        </button>
                    )}
                    {!orderExpired && showContinuationRequest && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.requestContinuation} disabled={busy}>
                            Request fresh 0x quote
                        </button>
                    )}
                    {!orderExpired && showContinuationSign && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signContinuation} disabled={busy}>
                            Sign 0x trade
                        </button>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
