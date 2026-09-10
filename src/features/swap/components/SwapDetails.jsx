import { ChevronDownIcon, GasPumpIcon } from '../../../shared/components/AppIcons.jsx'
import SwapInfoTooltip from './SwapInfoTooltip.jsx'
import './SwapDetails.css'

function formatEstimatedArrival(value) {
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0) return 'Unavailable'
    return `~${Math.round(seconds)} seconds`
}

function DetailRow({ label, ariaLabel, help, value }) {
    return (
        <div>
            <dt><span>{label}</span><SwapInfoTooltip ariaLabel={ariaLabel}>{help}</SwapInfoTooltip></dt>
            <dd>{value}</dd>
        </div>
    )
}

function usableFee(value) {
    const text = String(value ?? '').trim()
    return text && text !== 'Unavailable' ? text : null
}

function compactFeeSummary({ isCrossChain, sameChain, crossChain }) {
    if (isCrossChain) {
        const gasAssist = crossChain?.gasAssistFee
        const value = usableFee(
            gasAssist?.totalUsd ??
            crossChain?.estimatedTotalCost ??
            crossChain?.estimatedRouteCost ??
            crossChain?.sourceGasCost,
        )
        return value
            ? { label: gasAssist ? 'Gas Assist fee' : 'Estimated fee', value }
            : null
    }

    const gasAssist = sameChain?.gasAssistFee
    const value = usableFee(
        gasAssist?.totalUsd ??
        gasAssist?.estimatedSponsoredGasUsd ??
        gasAssist?.networkReserveUsd ??
        sameChain?.networkCost,
    )
    return value
        ? { label: gasAssist ? 'Gas Assist fee' : 'Network cost', value }
        : null
}

/**
 * Renders same-chain or cross-chain quote details without exposing internal routing providers.
 * Cross-chain costs stay intentionally compact: one combined fee is shown instead of repeating
 * routing, destination, impact, application, and sponsorship accounting as separate rows.
 */
export default function SwapDetails({ open, onOpenChange, rate, mode, sameChain, crossChain, slippage, exactOutputMaximum }) {
    if (!sameChain.visible && !crossChain?.route) return null
    const isCrossChain = mode === 'cross-chain'
    const feeSummary = compactFeeSummary({ isCrossChain, sameChain, crossChain })

    return (
        <details className="swap-compact-details" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
            <summary aria-label={open ? 'Hide swap details' : 'Show swap details'}>
                <span className="swap-compact-rate">{rate}</span>
                <span className="swap-compact-summary-meta">
                    {feeSummary && (
                        <span className="swap-compact-gas" aria-label={`${feeSummary.label}: ${feeSummary.value}`}>
                            <GasPumpIcon className="swap-compact-gas-icon" />
                            <span>{feeSummary.value}</span>
                        </span>
                    )}
                    <ChevronDownIcon className="swap-details-chevron" />
                </span>
            </summary>
            <dl>
                {!isCrossChain && (
                    <>
                        {sameChain.gasAssistFee ? (
                            <DetailRow
                                label="Gas Assist fee"
                                ariaLabel="Explain Gas Assist fee"
                                help="The exact sell-token fee for Gas Assist, already deducted from the amount you pay."
                                value={`${sameChain.gasAssistFee.totalToken}${sameChain.gasAssistFee.totalUsd ? ` (${sameChain.gasAssistFee.totalUsd})` : ''}`}
                            />
                        ) : (
                            <>
                                <DetailRow label="Fee" ariaLabel="Explain fee" help="Provider and PistachioSwap fees included in this quote." value={sameChain.serviceFee} />
                                <DetailRow label="Network cost" ariaLabel="Explain network cost" help="Estimated source-network transaction cost." value={sameChain.networkCost ?? 'Unavailable'} />
                            </>
                        )}
                        <DetailRow label="Route" ariaLabel="Explain route" help="Provider selected for the best executable outcome." value="Best available" />
                    </>
                )}
                {isCrossChain && crossChain?.route && (
                    <>
                        {crossChain.gasAssistFee ? (
                            <DetailRow
                                label="Gas Assist fee"
                                ariaLabel="Explain Gas Assist fee"
                                help="The exact sell-token fee for Gas Assist, already deducted from the amount you pay."
                                value={`${crossChain.gasAssistFee.totalToken}${crossChain.gasAssistFee.totalUsd ? ` (${crossChain.gasAssistFee.totalUsd})` : ''}`}
                            />
                        ) : (
                            <DetailRow
                                label="Estimated fee"
                                ariaLabel="Explain estimated fee"
                                help="One combined cross-chain fee estimate. Source-network gas is included when available and finalized before confirmation."
                                value={
                                    crossChain.estimatedTotalCost ??
                                    crossChain.estimatedRouteCost ??
                                    (crossChain.route.feeIncluded ? 'Included in quote' : 'Unavailable')
                                }
                            />
                        )}
                    </>
                )}
                <DetailRow
                    label="Max slippage"
                    ariaLabel="Explain max slippage"
                    help="Maximum allowed price movement before the transaction is cancelled."
                    value={<span className="slippage-value">{slippage.auto && <span className="slippage-auto-pill">Auto</span>}{slippage.label}</span>}
                />
                {isCrossChain && crossChain?.route && (
                    <>
                        <DetailRow label="Minimum received" ariaLabel="Explain minimum received" help="Minimum output protected by the selected best route and slippage settings." value={crossChain.minimumReceived ?? 'Unavailable'} />
                        <DetailRow label="Estimated arrival" ariaLabel="Explain estimated arrival" help="Estimated time for destination settlement." value={formatEstimatedArrival(crossChain.route.durationSeconds)} />
                    </>
                )}
                {!isCrossChain && exactOutputMaximum && (
                    <DetailRow label="Maximum sold" ariaLabel="Explain maximum sold" help="Maximum input allowed for this exact-output quote." value={exactOutputMaximum} />
                )}
            </dl>
        </details>
    )
}
