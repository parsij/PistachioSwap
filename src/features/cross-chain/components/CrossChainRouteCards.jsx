import {
    CROSS_CHAIN_SORTS,
    formatTokenAmount,
    getProviderDisplayName,
    sortCrossChainRoutes,
} from '../services/crossChainRoutes.js'
import './crossChain.css'

const SORT_OPTIONS = [
    [CROSS_CHAIN_SORTS.RETURN, 'Best return'],
    [CROSS_CHAIN_SORTS.FASTEST, 'Fastest'],
    [CROSS_CHAIN_SORTS.FEES, 'Lowest fees'],
]

/**
 * Renders sortable normalized cross-chain route choices.
 * @param {object} props Routes, sort/selection values, and semantic callbacks.
 * @returns {import('react').ReactElement} Existing route card section.
 * @sideEffects Emits sort and route-selection callbacks; performs no provider or wallet calls.
 */
export default function CrossChainRouteCards({
    routes,
    sort,
    onSortChange,
    onSelect,
    recommendedRouteId,
    selectedRouteId,
}) {
    const selectionIds = new Set(SORT_OPTIONS.map(([value]) =>
        sortCrossChainRoutes(routes, value)[0]?.publicRouteId))
    const showSort = routes.length > 1 && selectionIds.size > 1
    return (
        <section className="cross-chain-routes" aria-label="Cross-chain routes">
            {showSort && <div className="cross-chain-sort" aria-label="Route preference">
                {SORT_OPTIONS.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        className={sort === value ? 'active' : ''}
                        aria-pressed={sort === value}
                        onClick={() => {
                            onSortChange(value)
                            const next = sortCrossChainRoutes(routes, value)[0]
                            if (next) onSelect(next)
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>}
            {routes.length === 0 && (
                <p className="cross-chain-empty">No routes found.</p>
            )}
            {routes.map((route) => (
                <button
                    key={route.publicRouteId}
                    type="button"
                    className={`cross-chain-route-card${route.publicRouteId === selectedRouteId ? ' selected' : ''}`}
                    onClick={() => onSelect(route)}
                    aria-pressed={route.publicRouteId === selectedRouteId}
                    aria-label={`Select ${getProviderDisplayName(route.provider)} route`}
                >
                    <span>
                        <strong>{getProviderDisplayName(route.provider)}</strong>
                        {route.publicRouteId === recommendedRouteId && <small>Recommended</small>}
                    </span>
                    <span>
                        <strong>{formatTokenAmount(route.outputAmount, route.destinationAsset?.decimals)} {route.destinationAsset?.symbol}</strong>
                        <small>~{route.durationSeconds} sec</small>
                    </span>
                </button>
            ))}
        </section>
    )
}
