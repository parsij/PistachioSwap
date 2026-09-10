import { ChevronDownIcon, GasPumpIcon } from '../../../shared/components/AppIcons.jsx'
import SwapInfoTooltip from './SwapInfoTooltip.jsx'
import './SwapDetails.css'

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

function sameChainCombinedFee(sameChain) {
    const serviceFee = usableFee(sameChain?.serviceFee)
    const networkCost = usableFee(sameChain?.networkCost)

    if (!serviceFee || serviceFee === 'Free') return networkCost
    if (!networkCost || networkCost === 'Included') return serviceFee
    return `${serviceFee} + ${networkCost}`
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
        sameChainCombinedFee(sameChain),
    )
    return value
        ? { label: gasAssist ? 'Gas Assist fee' : 'Estimated fee', value }
        : null
}

/**
 * Renders same-chain or cross-chain quote details without exposing internal routing providers.
 * Fee accounting stays intentionally compact: one fee row is shown instead of separate provider,
 * network, routing, destination, impact, application, or sponsorship rows.
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
                {!isCrossChain && feeSummary && (
                    sameChain.gasAssistFee ? (
                        <DetailRow
                            label="Gas Assist fee"
                            ariaLabel="Explain Gas Assist fee"
                            help="The exact sell-token fee for Gas Assist, already deducted from the amount you pay."
                            value={`${sameChain.gasAssistFee.totalToken}${sameChain.gasAssistFee.totalUsd ? ` (${sameChain.gasAssistFee.totalUsd})` : ''}`}
                        />
                    ) : (
                        <DetailRow
                            label="Estimated fee"
                            ariaLabel="Explain estimated fee"
                            help="One compact estimate covering the swap fee and source-network cost."
                            value={feeSummary.value}
                        />
                    )
                )}
                {isCrossChain && crossChain?.route && feeSummary && (
                    crossChain.gasAssistFee ? (
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
                            value={feeSummary.value}
                        />
                    )
                )}
                <DetailRow
                    label="Max slippage"
                    ariaLabel="Explain max slippage"
                    help="Maximum allowed price movement before the transaction is cancelled."
                    value={<span className="slippage-value">{slippage.auto && <span className="slippage-auto-pill">Auto</span>}{slippage.label}</span>}
                />
                {!isCrossChain && exactOutputMaximum && (
                    <DetailRow label="Maximum sold" ariaLabel="Explain maximum sold" help="Maximum input allowed for this exact-output quote." value={exactOutputMaximum} />
                )}
            </dl>
        </details>
    )
}
