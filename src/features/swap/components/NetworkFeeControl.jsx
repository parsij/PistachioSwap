import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Pencil, X, RefreshCw } from 'lucide-react'
import { formatUnits } from 'viem'
import { getCuratedEvmChain, getCuratedEvmChainLogoUri } from '../../../web3/curatedEvmChains.js'
import { multiplyUsdAmount } from '../../../services/fiatValue.js'
import { formatNetworkCostUsd } from '../model/swapDisplay.js'
import { formatGwei, networkFeeCap, parseGwei, parseTransactionNonce, resolveNetworkFeeSelection } from '../services/networkFees.js'
import SwapInfoTooltip from './SwapInfoTooltip.jsx'
import './NetworkFeeControl.css'

function FeeAmount({ fields, fees, chain, nativePriceUsd }) {
    if (!fields) return <small>Live estimate unavailable</small>
    const cap = networkFeeCap(fields)
    const native = fees.gasEstimate ? formatUnits(fees.gasEstimate * cap, chain.nativeCurrency.decimals) : null
    const usd = native && nativePriceUsd ? multiplyUsdAmount(native, nativePriceUsd) : null
    return <>
        {usd && <strong>{formatNetworkCostUsd(usd)} max</strong>}
        {native && <span>{native} {chain.nativeCurrency.symbol} max</span>}
        {!native && <small>Cost available after gas estimation</small>}
        {native && !usd && <small>USD price unavailable</small>}
        <small>{formatGwei(cap)} Gwei</small>
    </>
}

function CustomFeeDialog({ fees, chain, destinationChain, nativePriceUsd, onSelect, onClose }) {
    const standard = fees.snapshot.presets.standard
    const initial = fees.selection.mode === 'custom' ? fees.selection.fields : standard
    const legacy = fees.snapshot.type === 'legacy'
    const [priority, setPriority] = useState(legacy ? '' : formatGwei(initial.maxPriorityFeePerGas))
    const [maximum, setMaximum] = useState(formatGwei(networkFeeCap(initial)))
    const [nonce, setNonce] = useState(initial.nonce === undefined ? '' : String(initial.nonce))
    const { refreshNonce } = fees
    useEffect(() => { void refreshNonce?.() }, [refreshNonce])
    const [error, setError] = useState(null)
    let previewFields = null
    try {
        previewFields = legacy ? { gasPrice: parseGwei(maximum) } : {
            maxPriorityFeePerGas: parseGwei(priority, { allowZero: true }), maxFeePerGas: parseGwei(maximum),
        }
        resolveNetworkFeeSelection(fees.snapshot, { chainId: fees.chainId, mode: 'custom', fields: previewFields }, fees.chainId)
    } catch { previewFields = null }
    function confirm(event) {
        event.preventDefault()
        try {
            const fields = legacy ? { gasPrice: parseGwei(maximum) } : {
                maxPriorityFeePerGas: parseGwei(priority, { allowZero: true }),
                maxFeePerGas: parseGwei(maximum),
            }
            const parsedNonce = parseTransactionNonce(nonce)
            if (parsedNonce !== undefined) fields.nonce = parsedNonce
            resolveNetworkFeeSelection(fees.snapshot, { chainId: fees.chainId, mode: 'custom', fields }, fees.chainId)
            onSelect('custom', fields)
            onClose()
        } catch (failure) { setError(failure.message) }
    }
    return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
        <Dialog.Portal>
            <Dialog.Overlay className="network-fee-overlay" />
            <Dialog.Content className="network-fee-dialog">
                <div className="network-fee-dialog-heading">
                    <Dialog.Title>Custom network cost</Dialog.Title>
                    <Dialog.Close className="network-fee-icon-button" aria-label="Close custom network cost"><X size={20} /></Dialog.Close>
                </div>
                <Dialog.Description>Set native transaction fees on {chain.name}. Recommendations update with the network.</Dialog.Description>
                {destinationChain && <p className="network-fee-note">Source: {chain.name}. Destination: {destinationChain.name}. These settings adjust the source transaction.</p>}
                <form onSubmit={confirm}>
                    {!legacy && <label className="network-fee-field">
                        <span>Priority fee <small>Gwei</small></span>
                        <small>Recommended: {formatGwei(standard.maxPriorityFeePerGas)} Gwei</small>
                        <input aria-label="Priority fee in Gwei" inputMode="decimal" autoComplete="off" value={priority}
                            onChange={event => { setPriority(event.target.value); setError(null) }} />
                    </label>}
                    <label className="network-fee-field">
                        <span>{legacy ? 'Gas price' : 'Max fee'} <small>Gwei</small></span>
                        <small>Recommended: {formatGwei(networkFeeCap(standard))} Gwei</small>
                        <input aria-label={legacy ? 'Gas price in Gwei' : 'Max fee in Gwei'} inputMode="decimal" autoComplete="off" value={maximum}
                            onChange={event => { setMaximum(event.target.value); setError(null) }} />
                    </label>
                    {!legacy && <p className="network-fee-base">Current base fee: {formatGwei(fees.snapshot.baseFeePerGas)} Gwei</p>}
                    <div className="network-fee-custom-estimate" aria-label="Custom network cost estimate">
                        <span>Estimated maximum network cost</span>
                        <FeeAmount fields={previewFields} fees={fees} chain={chain} nativePriceUsd={nativePriceUsd} />
                    </div>
                    <label className="network-fee-field">
                        <span>Transaction nonce <small>Optional</small></span>
                        <small>{fees.nonceLoading ? 'Loading pending nonce…' : fees.pendingNonce !== undefined ? `Next pending nonce: ${fees.pendingNonce}` : fees.nonceError ?? 'Automatic: your wallet chooses the nonce.'}</small>
                        <input aria-label="Transaction nonce" inputMode="numeric" autoComplete="off" placeholder="Automatic" value={nonce}
                            onChange={event => { setNonce(event.target.value); setError(null) }} />
                    </label>
                    <div className="network-fee-nonce-actions">
                        <button type="button" onClick={() => { setNonce(''); setError(null) }}>Use automatic nonce</button>
                        {fees.pendingNonce !== undefined && <button type="button" onClick={() => { setNonce(String(fees.pendingNonce)); setError(null) }}>Use pending nonce {fees.pendingNonce}</button>}
                    </div>
                    <p className="network-fee-note">Applies to this swap; approvals use automatic nonces. Using an existing pending nonce can replace that transaction. A higher nonce waits for earlier transactions. Leave blank for automatic.</p>
                    {error && <p className="network-fee-error" role="alert">{error}</p>}
                    <button className="network-fee-confirm" type="submit">Confirm network cost</button>
                </form>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
}

/** Displays source-chain fee options without changing the gas token or gas limit. */
export default function NetworkFeeControl({ fees, nativePriceUsd, onSelect, sponsored = false, destinationChainId = null }) {
    const [customScope, setCustomScope] = useState(null)
    useEffect(() => { setCustomScope(null) }, [fees.chainId, fees.account, fees.automatic])
    const chain = getCuratedEvmChain(fees.chainId)
    const destinationChain = destinationChainId !== fees.chainId ? getCuratedEvmChain(destinationChainId) : null
    if (!chain) return null
    return <section className="network-fee-panel" aria-label="Network cost">
        <div className="network-fee-heading">
            <span>Network cost <SwapInfoTooltip ariaLabel="Explain network cost">Fees are paid in {chain.nativeCurrency.symbol} on {chain.name}. The cards show a maximum execution fee using the quote’s gas estimate. Gas limits and additional network/data fees are finalized by your wallet; the final charge can be lower.</SwapInfoTooltip></span>
            <span className="network-fee-chain"><img src={getCuratedEvmChainLogoUri(chain.id)} alt="" />{chain.name}</span>
        </div>
        {destinationChain && <p className="network-fee-note">Receiving on {destinationChain.name}. Network cost settings apply to {chain.name}.</p>}
        {sponsored ? <p className="network-fee-note">Gas Assist manages this transaction’s network cost.</p> : <>
            <div className="network-fee-summary">
                <span>{fees.automatic ? 'Automatic' : fees.selection.mode === 'custom' ? `Custom fees${fees.selection.fields?.nonce !== undefined ? ` · Nonce ${fees.selection.fields.nonce}` : ''}` : `${fees.selection.mode[0].toUpperCase()}${fees.selection.mode.slice(1)} fees`}</span>
                <span>{fees.fields ? <FeeAmount fields={fees.fields} fees={fees} chain={chain} nativePriceUsd={nativePriceUsd} /> : fees.loading ? 'Loading live fees…' : 'Estimate unavailable'}</span>
                <button className="network-fee-icon-button" type="button" aria-label="Refresh network fees" onClick={() => void fees.refresh()} disabled={fees.loading}><RefreshCw size={15} /></button>
            </div>
            {!fees.automatic && <div className="network-fee-options" role="group" aria-label="Choose network cost">
                {['less', 'standard', 'high'].map(mode => <button type="button" key={mode} aria-pressed={fees.selection.mode === mode}
                    disabled={!fees.snapshot} onClick={() => onSelect(mode)}>
                    <span>{mode[0].toUpperCase()}{mode.slice(1)}</span>
                    <FeeAmount fields={fees.snapshot?.presets[mode]} fees={fees} chain={chain} nativePriceUsd={nativePriceUsd} />
                </button>)}
                <button type="button" aria-pressed={fees.selection.mode === 'custom'} disabled={!fees.snapshot} onClick={() => setCustomScope({ chainId: fees.chainId, account: fees.account })}>
                    <span>Custom <Pencil size={13} /></span>
                    {fees.selection.mode === 'custom' ? <FeeAmount fields={fees.fields} fees={fees} chain={chain} nativePriceUsd={nativePriceUsd} /> : <small>Set your fees</small>}
                </button>
            </div>}
            {fees.error && <p className="network-fee-error" role="alert">{fees.error}</p>}
            <p className="network-fee-note">{fees.automatic ? 'Turn off Auto network cost in settings to customize.' : 'Live source-network estimates. Lower fees may take longer. Custom fees apply to the swap transaction.'}</p>
            {!fees.automatic && customScope?.chainId === fees.chainId && customScope.account === fees.account && fees.snapshot && <CustomFeeDialog key={`${fees.chainId}:${fees.account}:${fees.snapshot.type}`} fees={fees} chain={chain} destinationChain={destinationChain} nativePriceUsd={nativePriceUsd} onSelect={onSelect} onClose={() => setCustomScope(null)} />}
        </>}
    </section>
}
