import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { motion } from 'motion/react'

import {
    ChainIcon,
    SectionTitle,
    TokenRow,
} from '../../../tokens/components/TokenSelectorPrimitives.jsx'
import {
    AllChainsIcon,
    ChevronDownIcon,
    CloseIcon,
    SearchIcon,
    WalletIcon,
} from '../../../tokens/components/TokenSelectorIcons.jsx'
import {
    deduplicateTokens,
    getTokenKey,
    hasPositiveBalance,
} from '../../../tokens/model/tokenSelectorState.js'
import { partitionPortfolioAssets } from '../../../tokens/services/portfolio.js'
import { confirmRiskyTokenSelection } from '../../../tokens/services/tokenRisk.js'
import {
    CURATED_EVM_CHAINS,
    getCuratedEvmChain,
    TOKEN_DISCOVERY_CHAIN_IDS,
} from '../../../../web3/curatedEvmChains.js'
import { sendTokenMatchesSearch } from './sendTokenSearch.js'
import '../../../tokens/components/TokenSelector.css'
import '../../../tokens/components/TokenSelectorPolish.css'
import '../../../tokens/components/TokenIconLoading.css'
import './sendTokenPicker.css'

const ACTIVE_CHAIN_IDS = new Set(TOKEN_DISCOVERY_CHAIN_IDS.map(Number))

/**
 * Send-only token picker. Search and chain filtering are intentionally local:
 * wallet holdings are already loaded, so Send must react from the first typed
 * character and must never depend on global token-catalog search state.
 */
export default function SendTokenPicker({
    walletTokens = [],
    onSelect,
    onClose,
}) {
    const [query, setQuery] = useState('')
    const [selectedChainId, setSelectedChainId] = useState('all')
    const [networkMenuOpen, setNetworkMenuOpen] = useState(false)
    const [showUnsafe, setShowUnsafe] = useState(true)

    const selectedChain = selectedChainId === 'all'
        ? null
        : getCuratedEvmChain(Number(selectedChainId))
    const chainOptions = useMemo(
        () => CURATED_EVM_CHAINS.filter((chain) => ACTIVE_CHAIN_IDS.has(Number(chain.id))),
        [],
    )

    const scopedTokens = useMemo(() => deduplicateTokens(walletTokens)
        .filter(hasPositiveBalance)
        .filter((token) => selectedChainId === 'all' ||
            Number(token?.chainId) === Number(selectedChainId))
        .filter((token) => sendTokenMatchesSearch(token, query)), [
        query,
        selectedChainId,
        walletTokens,
    ])

    const partitions = useMemo(
        () => partitionPortfolioAssets(scopedTokens),
        [scopedTokens],
    )
    const classifiedKeys = useMemo(() => new Set([
        ...partitions.primaryTokens,
        ...partitions.hiddenTokens,
    ].map(getTokenKey).filter(Boolean)), [partitions])
    const unclassifiedRiskyTokens = useMemo(
        () => scopedTokens.filter((token) => {
            const key = getTokenKey(token)
            return key && !classifiedKeys.has(key)
        }),
        [classifiedKeys, scopedTokens],
    )
    const riskyTokens = useMemo(
        () => [...partitions.hiddenTokens, ...unclassifiedRiskyTokens],
        [partitions.hiddenTokens, unclassifiedRiskyTokens],
    )
    const normalizedQuery = query.trim()
    const visibleUnsafe = normalizedQuery ? riskyTokens : showUnsafe ? riskyTokens : []
    const noMatches = partitions.primaryTokens.length === 0 && riskyTokens.length === 0

    function chooseToken(token) {
        if (!confirmRiskyTokenSelection(token, 'send this token')) return
        onSelect(token)
    }

    function stopPointer(event) {
        event.stopPropagation()
    }

    function chooseChain(value) {
        setSelectedChainId(value)
        setNetworkMenuOpen(false)
    }

    const row = (token) => (
        <TokenRow
            key={getTokenKey(token)}
            token={token}
            currentToken={null}
            oppositeToken={null}
            showBalance
            onSelect={chooseToken}
            onContextMenu={(event) => event.preventDefault()}
        />
    )

    return (
        <motion.section
            aria-label="Select a token for send"
            className="send-token-picker-layer"
            data-testid="send-token-picker"
            initial={{ opacity: 0, scale: 0.985, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onPointerDown={stopPointer}
        >
            <header className="send-token-picker-header">
                <h2>Select a token</h2>
                <button
                    type="button"
                    className="send-token-picker-close"
                    aria-label="Close token selector"
                    onClick={onClose}
                >
                    <CloseIcon />
                </button>
            </header>

            <div className="send-token-picker-search-wrap">
                <div className="ps-token-search send-token-picker-search">
                    <SearchIcon />
                    <input
                        autoFocus
                        aria-label="Search tokens"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value)
                            setNetworkMenuOpen(false)
                        }}
                        placeholder="Search tokens"
                        autoComplete="off"
                        spellCheck="false"
                    />

                    <div className="ps-network-control send-network-control">
                        <button
                            type="button"
                            className="ps-network-trigger"
                            aria-label="Token network"
                            aria-haspopup="listbox"
                            aria-expanded={networkMenuOpen}
                            onPointerDown={stopPointer}
                            onClick={(event) => {
                                event.stopPropagation()
                                setNetworkMenuOpen((value) => !value)
                            }}
                        >
                            {selectedChain ? (
                                <ChainIcon
                                    chainId={selectedChain.id}
                                    name={selectedChain.name}
                                />
                            ) : <AllChainsIcon />}
                            <span>{selectedChain?.name ?? 'All Chains'}</span>
                            <ChevronDownIcon />
                        </button>

                        {networkMenuOpen && (
                            <div
                                className="ps-network-menu send-network-menu"
                                role="listbox"
                                aria-label="Token network"
                                onPointerDown={stopPointer}
                            >
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selectedChainId === 'all'}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        chooseChain('all')
                                    }}
                                >
                                    <AllChainsIcon />
                                    <span>All Chains</span>
                                </button>
                                {chainOptions.map((chain) => (
                                    <button
                                        key={chain.id}
                                        type="button"
                                        role="option"
                                        aria-selected={Number(selectedChainId) === Number(chain.id)}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            chooseChain(Number(chain.id))
                                        }}
                                    >
                                        <ChainIcon chainId={chain.id} name={chain.name} />
                                        <span>{chain.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="send-token-picker-scroll">
                {partitions.primaryTokens.length > 0 && (
                    <section className="ps-token-section">
                        <SectionTitle icon={<WalletIcon />}>Your tokens</SectionTitle>
                        {partitions.primaryTokens.map(row)}
                    </section>
                )}

                {riskyTokens.length > 0 && (
                    <section className="ps-token-section">
                        <SectionTitle
                            icon={<ShieldAlert />}
                            action={!normalizedQuery ? (
                                <button
                                    type="button"
                                    className="ps-token-section-action"
                                    aria-expanded={showUnsafe}
                                    onClick={() => setShowUnsafe((value) => !value)}
                                >
                                    {showUnsafe ? 'Hide' : 'Show'}
                                </button>
                            ) : null}
                        >
                            Unsafe tokens ({riskyTokens.length})
                        </SectionTitle>
                        {visibleUnsafe.length > 0 && (
                            <>
                                <p className="ps-hidden-token-explanation">
                                    These unverified or risky wallet holdings are not in the trusted registry or are explicitly flagged. Review the exact contract before selecting one.
                                </p>
                                {visibleUnsafe.map(row)}
                            </>
                        )}
                    </section>
                )}

                {noMatches && (
                    <div className="ps-token-message">No matching tokens</div>
                )}
            </div>
        </motion.section>
    )
}
