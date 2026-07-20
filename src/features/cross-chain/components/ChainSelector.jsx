import {
    CURATED_EVM_CHAINS,
} from '../../../web3/curatedEvmChains.js'

/** Renders curated source/destination chain choices and emits the selected chain ID. */
export default function ChainSelector({
    label,
    value,
    onChange,
    excludeChainId = null,
}) {
    return (
        <label className="cross-chain-selector">
            <span>{label}</span>
            <select
                aria-label={label}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
            >
                {CURATED_EVM_CHAINS
                    .filter((chain) => chain.id !== Number(excludeChainId))
                    .map((chain) => (
                        <option key={chain.id} value={chain.id}>
                            {chain.name}
                        </option>
                    ))}
            </select>
        </label>
    )
}
