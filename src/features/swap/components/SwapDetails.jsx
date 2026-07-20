import CrossChainRouteCards from '../../cross-chain/components/CrossChainRouteCards.jsx'
import { ChevronDownIcon } from '../../../shared/components/AppIcons.jsx'
import SwapInfoTooltip from './SwapInfoTooltip.jsx'
import { formatCostUsd } from '../model/swapDisplay.js'

function DetailRow({ label, ariaLabel, help, value }) {
    return (
        <div>
            <dt><span>{label}</span><SwapInfoTooltip ariaLabel={ariaLabel}>{help}</SwapInfoTooltip></dt>
            <dd>{value}</dd>
        </div>
    )
}

/**
 * Renders same-chain or cross-chain quote details and optional route choices.
 * @param {{open: boolean, onOpenChange: (open: boolean) => void, rate: string, mode: 'same-chain'|'cross-chain', sameChain: object, crossChain: object|null, slippage: object, provider: string|null, exactOutputMaximum: string|null}} props Detail view model.
 * @returns {import('react').ReactElement|null} Existing details disclosure.
 * @sideEffects Emits disclosure, route-sort, and route-selection callbacks only.
 */
export default function SwapDetails({ open, onOpenChange, rate, mode, sameChain, crossChain, slippage, provider, exactOutputMaximum }) {
    if (!sameChain.visible && !crossChain?.route) return null
    const isCrossChain = mode === 'cross-chain'
    return (
        <details className="swap-compact-details" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
            <summary>
                <span className="swap-compact-rate">{rate}</span>
                <ChevronDownIcon className="swap-details-chevron" />
            </summary>
            <dl>
                {!isCrossChain && (
                    <>
                        <DetailRow label="Fee" ariaLabel="Explain fee" help="Provider and PistachioSwap fees included in this quote." value={sameChain.serviceFee} />
                        <DetailRow label="Network cost" ariaLabel="Explain network cost" help="Estimated source-network transaction cost." value={sameChain.networkCost ?? 'Unavailable'} />
                    </>
                )}
                {isCrossChain && crossChain?.route && (
                    <>
                        {crossChain.estimatedTotalCost ? (
                            <DetailRow label="Estimated total cost" ariaLabel="Explain estimated total cost" help="Estimated combined route and network costs." value={crossChain.estimatedTotalCost} />
                        ) : crossChain.estimatedRouteCost ? (
                            <DetailRow label="Estimated route cost" ariaLabel="Explain estimated route cost" help="Estimated provider and destination route costs." value={crossChain.estimatedRouteCost} />
                        ) : crossChain.route.feeIncluded ? (
                            <DetailRow label="Provider costs" ariaLabel="Explain provider costs" help="Provider costs are included in the displayed quote." value="Included in quote" />
                        ) : null}
                        <DetailRow label="Source network gas" ariaLabel="Explain source network gas" help="Estimated gas required on the source network." value={crossChain.sourceGasCost ?? 'Calculated at confirmation'} />
                        {crossChain.costs?.providerFeeUsd != null && <DetailRow label="Provider fee" ariaLabel="Explain provider fee" help="Fee charged by the selected route provider." value={formatCostUsd(crossChain.costs.providerFeeUsd)} />}
                        {crossChain.costs?.destinationGasUsd != null && <DetailRow label="Destination execution cost" ariaLabel="Explain destination execution cost" help="Estimated execution cost on the destination network." value={formatCostUsd(crossChain.costs.destinationGasUsd)} />}
                        {crossChain.costs?.swapImpactUsd != null && <DetailRow label="Swap/route impact" ariaLabel="Explain route impact" help="Estimated value impact from swaps and routing." value={formatCostUsd(crossChain.costs.swapImpactUsd)} />}
                        {crossChain.appFee !== null && <DetailRow label="PistachioSwap fee" ariaLabel="Explain PistachioSwap fee" help="Application fee charged by PistachioSwap." value={crossChain.appFee} />}
                        {crossChain.costs?.sponsoredUsd != null && <DetailRow label="Sponsored amount" ariaLabel="Explain sponsored amount" help="Amount of transaction cost covered by sponsorship." value={`-${formatCostUsd(crossChain.costs.sponsoredUsd)}`} />}
                    </>
                )}
                <DetailRow
                    label="Max slippage"
                    ariaLabel="Explain max slippage"
                    help="Maximum allowed price movement before the transaction is cancelled."
                    value={<span className="slippage-value">{slippage.auto && <span className="slippage-auto-pill">Auto</span>}{slippage.label}</span>}
                />
                <DetailRow label="Route" ariaLabel="Explain route" help="Provider selected for the best executable outcome." value={<span className="route-provider-value">{provider ?? 'Unavailable'}</span>} />
                {isCrossChain && crossChain?.route && (
                    <>
                        <DetailRow label="Minimum received" ariaLabel="Explain minimum received" help="Minimum output protected by the route and slippage settings." value={crossChain.minimumReceived ?? 'Unavailable'} />
                        <DetailRow label="Estimated arrival" ariaLabel="Explain estimated arrival" help="Estimated time for destination settlement." value={`~${crossChain.route.durationSeconds} seconds`} />
                    </>
                )}
                {!isCrossChain && exactOutputMaximum && (
                    <DetailRow label="Maximum sold" ariaLabel="Explain maximum sold" help="Maximum input allowed for this exact-output quote." value={exactOutputMaximum} />
                )}
            </dl>
            {isCrossChain && crossChain.routes.length > 1 && (
                <CrossChainRouteCards
                    routes={crossChain.routes}
                    sort={crossChain.sort}
                    onSortChange={crossChain.onSortChange}
                    onSelect={crossChain.onSelect}
                    recommendedRouteId={crossChain.recommendedRouteId}
                    selectedRouteId={crossChain.route?.publicRouteId}
                />
            )}
        </details>
    )
}
