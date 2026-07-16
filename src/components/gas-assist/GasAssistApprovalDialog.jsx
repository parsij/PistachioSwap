import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { formatUnits } from 'viem'

import TokenIcon from '../TokenIcon.jsx'
import GasAssistError from './GasAssistError.jsx'
import './gasAssist.css'

function feeRows(fees = {}) {
    const rows = []
    const add = (label, fee) => {
        if (fee?.amount != null) rows.push([label, `${fee.amount} base units`])
    }
    add('0x gas fee', fees.gasFee)
    add('0x fee', fees.zeroExFee)
    add('PistachioSwap fee', fees.integratorFee)
    if (Array.isArray(fees.integratorFees)) fees.integratorFees.forEach((fee, index) => add(`PistachioSwap fee ${index + 1}`, fee))
    for (const [key, fee] of Object.entries(fees)) {
        if (!['gasFee', 'zeroExFee', 'integratorFee', 'integratorFees'].includes(key)) add(key, fee)
    }
    return rows
}

export default function GasAssistApprovalDialog({ dialog, token, buyToken, amount, onClose, onConfirm }) {
    const [remaining, setRemaining] = useState(0)
    const quote = dialog.quote
    useEffect(() => {
        if (!quote?.expiresAt) return undefined
        const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 1000)))
        update()
        const id = window.setInterval(update, 1000)
        return () => window.clearInterval(id)
    }, [quote?.expiresAt])
    if (!dialog.open || !token) return null
    const busy = ['quote-loading', 'signing-approval', 'signing-trade', 'submitting'].includes(dialog.state)
    const canConfirm = dialog.state === 'ready' && remaining > 0
    const buyDecimals = Number(buyToken?.decimals ?? 18)
    const buySymbol = buyToken?.symbol ?? 'selected token'
    const output = quote?.buyAmount ? formatUnits(BigInt(quote.buyAmount), buyDecimals) : null
    const minimum = quote?.minBuyAmount ? formatUnits(BigInt(quote.minBuyAmount), buyDecimals) : null

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="gas-assist-overlay" />
                <Dialog.Content className="gas-assist-dialog">
                    <div className="gas-assist-heading">
                        <div>
                            <Dialog.Title>Gas Assist via 0x</Dialog.Title>
                            <Dialog.Description>Swap this BEP-20 token for your selected output. 0x pays gas up front and includes the network cost in the trade.</Dialog.Description>
                        </div>
                        <Dialog.Close asChild><button className="gas-assist-close" type="button" disabled={busy} aria-label="Close"><X aria-hidden="true" /></button></Dialog.Close>
                    </div>
                    <div className="gas-assist-token-row"><TokenIcon token={token} /><div><strong>{amount} {token.symbol}</strong><span>Requested sell amount</span></div></div>
                    {quote && (
                        <div className="gas-assist-details">
                            <div><span>Quoted sell amount</span><strong>{quote.sellAmount} base units</strong></div>
                            <div><span>Expected {buySymbol}</span><strong>{output}</strong></div>
                            <div><span>Minimum {buySymbol}</span><strong>{minimum}</strong></div>
                            {feeRows(quote.fees).map(([label, value]) => <div key={`${label}:${value}`}><span>{label}</span><strong>{value}</strong></div>)}
                            <div><span>Quote expires</span><strong>{remaining}s</strong></div>
                        </div>
                    )}
                    {quote?.approval && (
                        <div className={`gas-assist-disclosure${quote.approval.isUnlimited ? ' unlimited' : ''}`}>
                            <strong>This token requires a permit signature so 0x can perform this swap.</strong>
                            <span>Permit amount: {quote.approval.approvalAmount} base units.</span>
                            {quote.approval.isUnlimited && <span>This permit grants 0x Permit2 a reusable token allowance. It is not an immediate token transfer.</span>}
                        </div>
                    )}
                    <p className="gas-assist-status" role="status">{{
                        'quote-loading': 'Requesting a firm 0x quote...',
                        ready: quote?.approval ? 'Two signatures are required. Nothing is submitted until both are complete.' : 'One trade signature is required.',
                        'signing-approval': 'Confirm the permit signature in your wallet.',
                        'signing-trade': 'Confirm the trade signature in your wallet.',
                        submitting: 'Submitting the signed trade to 0x...',
                        submitted: 'Trade submitted. Waiting for 0x.',
                        pending: 'Trade pending.',
                        succeeded: 'Trade included. Waiting for confirmation.',
                        confirmed: 'Gas Assist trade confirmed.',
                        cancelled: 'Signing cancelled. Nothing was submitted.',
                        expired: 'This quote expired. Request a new quote.',
                        failed: null,
                    }[dialog.state] ?? null}</p>
                    {dialog.error && <GasAssistError error={dialog.error} />}
                    {dialog.transactionHash && (
                        <a
                            className="gas-assist-transaction"
                            href={`https://bscscan.com/tx/${dialog.transactionHash}`}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            View transaction on BscScan
                        </a>
                    )}
                    {canConfirm && <button className="gas-assist-primary" type="button" onClick={onConfirm}>Confirm Gas Assist trade</button>}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
