import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Clock3, Search, Wallet } from 'lucide-react'

import TokenIcon from './TokenIcon.jsx'
import { ChainSelector } from './TokenSelectorPrimitives.jsx'
import { useTokenSelectorState } from '../hooks/useTokenSelectorState.js'
import {
    formatWalletTokenAmount,
    formatWalletUsdValue,
} from '../services/walletTokens.js'
import {
    getTokenDisplayName,
    getTokenDisplaySymbol,
} from '../services/tokenDisplay.js'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { shortenAddress } from '../model/tokenSelectorState.js'

import './GlobalSearchModal.css'

const SEARCH_TABS = [
    { id: 'all', label: 'All' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'pools', label: 'Pools', desktopOnly: true },
    { id: 'auctions', label: 'Auctions', desktopOnly: true },
    { id: 'wallets', label: 'Wallets' },
]

function isWalletAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? '').trim())
}

function tokenSecondaryText(token) {
    const chainName = getCuratedEvmChain(token?.chainId)?.name
    const symbol = getTokenDisplaySymbol(token)
    return [symbol, chainName].filter(Boolean).join(' · ')
}

function SearchTokenRow({ token, onSelect }) {
    const hasBalance = Number(token?.balance ?? 0) > 0 ||
        /[1-9]/.test(String(token?.rawBalance ?? ''))
    return (
        <button
            type="button"
            className="global-search-result-row"
            onClick={() => onSelect(token)}
        >
            <TokenIcon token={token} size="list" />
            <span className="global-search-result-copy">
                <strong>{getTokenDisplayName(token)}</strong>
                <span>{tokenSecondaryText(token)}</span>
            </span>
            <span className="global-search-result-value">
                {hasBalance ? (
                    <>
                        <strong>{formatWalletUsdValue(token)}</strong>
                        <span>{formatWalletTokenAmount(token.balance)}</span>
                    </>
                ) : (
                    <ArrowRight aria-hidden="true" />
                )}
            </span>
        </button>
    )
}

function Section({ title, action, children }) {
    return (
        <section className="global-search-section">
            <div className="global-search-section-heading">
                <span>{title}</span>
                {action}
            </div>
            {children}
        </section>
    )
}

function EmptySearchState({ tab, query }) {
    if (tab === 'wallets' && query && !isWalletAddress(query)) {
        return (
            <div className="global-search-empty">
                <Wallet aria-hidden="true" />
                <strong>Enter a wallet address</strong>
                <span>Wallet search currently supports exact EVM addresses.</span>
            </div>
        )
    }

    return (
        <div className="global-search-empty">
            <Search aria-hidden="true" />
            <strong>No results</strong>
            <span>Try another token name, symbol, contract, or wallet address.</span>
        </div>
    )
}

export default function GlobalSearchModal({
    chainId,
    tokens = [],
    commonTokens = [],
    fallbackTokens = commonTokens,
    walletTokens = [],
    search,
    loading,
    error,
    catalogNotice = null,
    catalogDiagnostics = null,
    currentToken,
    oppositeToken,
    onSearchChange,
    onSelect,
    onClose,
    hideUnknownTokens = true,
    hideSmallBalances = false,
    onChainChange,
}) {
    const [activeTab, setActiveTab] = useState('all')
    const inputRef = useRef(null)
    const reducedMotion = useReducedMotion()
    const state = useTokenSelectorState({
        chainId,
        tokens,
        commonTokens,
        fallbackTokens,
        walletTokens,
        search,
        loading,
        error,
        catalogNotice,
        catalogDiagnostics,
        currentToken,
        oppositeToken,
        onSelect,
        onClose,
        hideUnknownTokens,
        hideSmallBalances,
    })
    const query = state.normalizedSearch

    useEffect(() => {
        if (String(chainId) !== 'all') {
            onSearchChange('')
            onChainChange?.('all')
        }
    }, [chainId, onChainChange, onSearchChange])

    useEffect(() => {
        const timeout = window.setTimeout(() => inputRef.current?.focus(), 50)
        return () => window.clearTimeout(timeout)
    }, [])

    const noQueryTokens = useMemo(() => {
        const byKey = new Map()
        for (const token of [
            ...state.primaryWalletTokens,
            ...state.visibleRecentTokens,
            ...state.sortedGlobalMarketTokens,
            ...state.commonMarketTokens,
        ]) {
            const key = Number(token?.chainId) + ':' + String(token?.address ?? '').toLowerCase()
            if (!byKey.has(key)) byKey.set(key, token)
        }
        return [...byKey.values()].slice(0, 12)
    }, [
        state.commonMarketTokens,
        state.primaryWalletTokens,
        state.sortedGlobalMarketTokens,
        state.visibleRecentTokens,
    ])

    const resultTokens = query ? state.searchResultTokens : noQueryTokens
    const showTokens = activeTab === 'all' || activeTab === 'tokens'
    const showWallets = activeTab === 'all' || activeTab === 'wallets'
    const walletResult = showWallets && isWalletAddress(query)
        ? query.toLowerCase()
        : null
    const hasResults = (showTokens && resultTokens.length > 0) || Boolean(walletResult)

    function handleChainChange(value) {
        onSearchChange('')
        onChainChange?.(value === 'all' ? 'all' : Number(value))
    }

    function openWallet(address) {
        const url = new URL(window.location.href)
        url.pathname = '/swap/'
        url.searchParams.set('view', 'portfolio')
        url.searchParams.set('address', address)
        url.searchParams.delete('tab')
        window.history.pushState(window.history.state, '', url)
        window.dispatchEvent(new CustomEvent('pistachio:navigate-app', {
            detail: { view: 'portfolio' },
        }))
        onClose()
    }

    const modal = (
        <motion.div
            className="global-search-backdrop"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={onClose}
        >
            <motion.section
                role="dialog"
                aria-modal="true"
                aria-label="Search"
                className="global-search-modal"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={reducedMotion ? { duration: 0 } : {
                    duration: 0.18,
                    ease: [0.22, 1, 0.36, 1],
                }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="global-search-mobile-handle" aria-hidden="true" />

                <div className="global-search-input-region">
                    <label className="global-search-input-shell">
                        <Search aria-hidden="true" />
                        <input
                            ref={inputRef}
                            aria-label="Search tokens and wallets"
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Search tokens, contract addresses, or wallets"
                            autoComplete="off"
                            spellCheck="false"
                        />
                        <ChainSelector
                            chainId={state.chainScope}
                            onChange={handleChainChange}
                        />
                    </label>
                </div>

                <nav className="global-search-tabs" aria-label="Search categories">
                    {SEARCH_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={[
                                activeTab === tab.id ? 'active' : '',
                                tab.desktopOnly ? 'desktop-only' : '',
                            ].filter(Boolean).join(' ')}
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <div className="global-search-scroll">
                    {!query ? (
                        <>
                            {showTokens && state.visibleRecentTokens.length > 0 && (
                                <Section
                                    title="Recent searches"
                                    action={(
                                        <button
                                            type="button"
                                            className="global-search-section-action"
                                            onClick={state.clearRecentTokens}
                                        >
                                            Clear
                                        </button>
                                    )}
                                >
                                    {state.visibleRecentTokens.slice(0, 3).map((token) => (
                                        <SearchTokenRow
                                            key={Number(token.chainId) + ':' + token.address}
                                            token={token}
                                            onSelect={state.handleSelect}
                                        />
                                    ))}
                                </Section>
                            )}

                            {showTokens && state.primaryWalletTokens.length > 0 && (
                                <Section title="Your tokens">
                                    {state.primaryWalletTokens.slice(0, 4).map((token) => (
                                        <SearchTokenRow
                                            key={Number(token.chainId) + ':' + token.address}
                                            token={token}
                                            onSelect={state.handleSelect}
                                        />
                                    ))}
                                </Section>
                            )}

                            {showTokens && (
                                <Section title="Tokens">
                                    {loading && resultTokens.length === 0 ? (
                                        <div className="global-search-loading">
                                            {Array.from({ length: 5 }).map((_, index) => (
                                                <span key={index} />
                                            ))}
                                        </div>
                                    ) : (
                                        resultTokens.slice(0, 8).map((token) => (
                                            <SearchTokenRow
                                                key={Number(token.chainId) + ':' + token.address}
                                                token={token}
                                                onSelect={state.handleSelect}
                                            />
                                        ))
                                    )}
                                </Section>
                            )}

                            {activeTab === 'wallets' && (
                                <div className="global-search-empty">
                                    <Wallet aria-hidden="true" />
                                    <strong>Search wallets</strong>
                                    <span>Paste an EVM address to open its portfolio.</span>
                                </div>
                            )}
                        </>
                    ) : activeTab === 'pools' || activeTab === 'auctions' ? (
                        <div className="global-search-empty">
                            <Search aria-hidden="true" />
                            <strong>{activeTab === 'pools' ? 'Pool search is unavailable' : 'Auction search is unavailable'}</strong>
                            <span>PistachioSwap does not currently index this Uniswap search category.</span>
                        </div>
                    ) : (
                        <>
                            {walletResult && (
                                <Section title="Wallets">
                                    <button
                                        type="button"
                                        className="global-search-wallet-row"
                                        onClick={() => openWallet(walletResult)}
                                    >
                                        <span className="global-search-wallet-avatar">
                                            <Wallet aria-hidden="true" />
                                        </span>
                                        <span>
                                            <strong>{shortenAddress(walletResult)}</strong>
                                            <small>View portfolio</small>
                                        </span>
                                        <ArrowRight aria-hidden="true" />
                                    </button>
                                </Section>
                            )}

                            {showTokens && resultTokens.length > 0 && (
                                <Section title="Tokens">
                                    {loading && (
                                        <div className="global-search-inline-status">
                                            Searching more tokens…
                                        </div>
                                    )}
                                    {resultTokens.map((token) => (
                                        <SearchTokenRow
                                            key={Number(token.chainId) + ':' + token.address}
                                            token={token}
                                            onSelect={state.handleSelect}
                                        />
                                    ))}
                                </Section>
                            )}

                            {!hasResults && (
                                <EmptySearchState tab={activeTab} query={query} />
                            )}

                            {error && resultTokens.length === 0 && (
                                <div className="global-search-inline-status" role="status">
                                    Token data could not be refreshed.
                                </div>
                            )}
                        </>
                    )}
                </div>

                <footer className="global-search-footer">
                    <span><kbd>/</kbd> Search</span>
                    <span><kbd>Esc</kbd> Close</span>
                </footer>
            </motion.section>
        </motion.div>
    )

    return createPortal(modal, document.body)
}
