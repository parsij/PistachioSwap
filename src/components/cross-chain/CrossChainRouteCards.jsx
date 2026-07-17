import {
    CROSS_CHAIN_SORTS,
    formatRouteFee,
} from '../../services/crossChainRoutes.js'
import {
    getCuratedEvmChain,
} from '../../web3/curatedEvmChains.js'

const SORT_OPTIONS = [
    [CROSS_CHAIN_SORTS.RETURN, 'Best return'],
    [CROSS_CHAIN_SORTS.FASTEST, 'Fastest'],
    [CROSS_CHAIN_SORTS.FEES, 'Lowest fees'],
]

export default function CrossChainRouteCards({
    routes,
    sort,
    onSortChange,
    onSelect,
    recommendedRouteId,
}) {
    return (
        <section className="cross-chain-routes" aria-label="Cross-chain routes">
            <div className="cross-chain-sort" aria-label="Sort routes">
                {SORT_OPTIONS.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        className={sort === value ? 'active' : ''}
                        aria-pressed={sort === value}
                        onClick={() => onSortChange(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {routes.length === 0 && (
                <p className="cross-chain-empty">No routes found.</p>
            )}
            {routes.map((route) => (
                <button
                    key={route.publicRouteId}
                    type="button"
                    className="cross-chain-route-card"
                    onClick={() => onSelect(route)}
                    aria-label={`Review ${route.provider} route`}
                >
                    <span>
                        <strong>{route.provider}</strong>
                        {route.publicRouteId === recommendedRouteId && <small>Recommended</small>}
                        <small>
                            {getCuratedEvmChain(route.sourceChainId)?.name} →{' '}
                            {getCuratedEvmChain(route.destinationChainId)?.name}
                        </small>
                    </span>
                    <span>
                        <strong>{route.outputAmount}</strong>
                        <small>
                            {route.durationSeconds}s · {formatRouteFee(route.feeAmountUsd)} fees
                        </small>
                    </span>
                </button>
            ))}
        </section>
    )
}
