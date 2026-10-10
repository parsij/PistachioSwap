import { ChainSelector as NetworkSelector } from '../../tokens/components/TokenSelectorPrimitives.jsx'
import '../../tokens/components/TokenSelector.css'

/** Curated source/destination choices with the shared searchable network menu. */
export default function ChainSelector({ label, value, onChange, excludeChainId = null }) {
    return <div className="cross-chain-selector">
        <span>{label}</span>
        <NetworkSelector label={label} chainId={value} onChange={(id) => onChange(Number(id))}
            includeAll={false} excludeChainId={excludeChainId} discoveryOnly={false} />
    </div>
}
