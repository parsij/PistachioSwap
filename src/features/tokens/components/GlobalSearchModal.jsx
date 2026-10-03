import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Clock3, Search, Wallet, X } from 'lucide-react'

import TokenIcon from './TokenIcon.jsx'
import TokenHoverCard from './TokenHoverCard.jsx'
import { ChainSelector } from './TokenSelectorPrimitives.jsx'
import { useTokenSelectorState } from '../hooks/useTokenSelectorState.js'
import {
    getTokenDisplayName,
    getTokenDisplaySymbol,
} from '../services/tokenDisplay.js'
import { useSearchNavigation } from '../hooks/useSearchNavigation.js'
import { requestMoreTokenCatalog } from '../hooks/useTokenCatalog.js'
import { marketNumber, marketPercent, marketUsd } from '../services/marketPresentation.js'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { shortenAddress } from '../model/tokenSelectorState.js'
import { createCssVariables } from '../../../swapConfig.js'

import './GlobalSearchModal.css'

const SEARCH_TABS = [
    { id: 'all', label: 'All' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'wallets', label: 'Wallets' },
]

function isWalletAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? '').trim())
}

function shortenedContract(token) {
    const address = String(token?.address ?? '')
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null
    return address.slice(0, 6) + '...' + address.slice(-4)
}

function tokenSecondaryText(token, variant, networkCount = 1) {
    const symbol = getTokenDisplaySymbol(token)
    if (variant === 'recent') {
        return [symbol, shortenedContract(token)].filter(Boolean).join('  ')
    }

    if (variant === 'trending' && networkCount > 1) {
        return symbol + '  ' + networkCount + ' networks'
    }

    const chainName = getCuratedEvmChain(token?.chainId)?.name
    return [symbol, chainName].filter(Boolean).join(' · ')
}

function SearchTokenRow({
    token,
    onSelect,
    variant = 'query',
    networkCount = 1,
    index, activeIndex, onActive,
}) {
    const price = marketNumber(token?.priceUSD ?? token?.marketPriceUSD ?? token?.trustedPriceUSD)
    const change = marketNumber(token?.priceChange24hPercent)
    const row = (
        <button
            type="button"
            className={`global-search-result-row${index === activeIndex ? " keyboard-active" : ""}`}
            data-search-result
            id={`global-search-result-${index}`}
            onMouseEnter={() => onActive?.(index)}
            onClick={() => onSelect(token)}
        >
            <TokenIcon token={token} size="list" />
            <span className="global-search-result-copy">
                <strong>{getTokenDisplayName(token)}</strong>
                <span>{tokenSecondaryText(token, variant, networkCount)}</span>
            </span>
            <span className="global-search-result-market">
                <strong>{marketUsd(price)}</strong>
                {change !== null && (
                    <span className={change < 0 ? 'negative' : 'positive'}>
                        {marketPercent(change)}
                    </span>
                )}
            </span>
        </button>
    )

    return (
        <TokenHoverCard token={token} onNavigate={onSelect}>
            {row}
        </TokenHoverCard>
    )
}

function Section({ title, action, icon: Icon, children }) {
    return (
        <section className="global-search-section">
            <div className="global-search-section-heading">
                <span className="global-search-section-label">
                    {Icon && <Icon aria-hidden="true" />}
                    {title}
                </span>
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
    const modalRef = useRef(null)
    const pointerStart = useRef(null)
    const [sheetOffset, setSheetOffset] = useState(0)
    const reducedMotion = useReducedMotion()
    const theme = useMemo(() => createCssVariables(), [])
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

    const navigation = useSearchNavigation(modalRef, inputRef, `${query}:${activeTab}:${chainId}`)
    const browseTokens = useMemo(() => {
        const seen = new Set()
        return [...state.primaryWalletTokens, ...state.sortedGlobalMarketTokens, ...state.commonMarketTokens]
            .filter((token) => {
                const key = `${token.chainId}:${String(token.address).toLowerCase()}`
                if (seen.has(key)) return false
                seen.add(key)
                return true
            })
    }, [state.primaryWalletTokens, state.sortedGlobalMarketTokens, state.commonMarketTokens])

    const resultTokens = query ? state.searchResultTokens : []
    const showTokens = activeTab === 'all' || activeTab === 'tokens'
    const showWallets = activeTab === 'all' || activeTab === 'wallets'
    const walletResult = showWallets && isWalletAddress(query)
        ? query.toLowerCase()
        : null
    const hasResults =
        (showTokens && resultTokens.length > 0) ||
        Boolean(walletResult)

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
            style={theme}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={onClose}
        >
            <motion.section
                ref={modalRef}
                onKeyDown={navigation.onKeyDown}
                role="dialog"
                aria-modal="true"
                aria-label="Search"
                className="global-search-modal"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: sheetOffset }}
                transition={reducedMotion || pointerStart.current !== null ? { duration: 0 } : {
                    duration: 0.18,
                    ease: [0.22, 1, 0.36, 1],
                }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="global-search-mobile-handle" aria-label="Drag to close search"
                    onPointerDown={(event) => { pointerStart.current = event.clientY; event.currentTarget.setPointerCapture?.(event.pointerId) }}
                    onPointerMove={(event) => { if (pointerStart.current !== null) setSheetOffset(Math.max(0, event.clientY - pointerStart.current)) }}
                    onPointerUp={(event) => { if (pointerStart.current !== null && event.clientY - pointerStart.current > 90) onClose(); pointerStart.current = null; setSheetOffset(0) }}
                    onPointerCancel={() => { pointerStart.current = null; setSheetOffset(0) }}
                />

                <div className="global-search-input-region">
                    <button type="button" className="global-search-close" aria-label="Close search" onClick={onClose}><X aria-hidden="true" /></button>
                    <label className="global-search-input-shell">
                        <Search aria-hidden="true" />
                        <input
                            ref={inputRef}
                            aria-label="Search tokens and wallets"
                            aria-controls="global-search-results"
                            aria-activedescendant={`global-search-result-${navigation.activeIndex}`}
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Search by name, symbol, or address"
                            autoComplete="off"
                            spellCheck="false"
                        />
                        <ChainSelector
                            chainId={state.chainScope}
                            onChange={handleChainChange}
                        />
                    </label>
                </div>

                <nav className="global-search-tabs" aria-label="Search categories" role="tablist">
                    {SEARCH_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={activeTab === tab.id ? 'active' : ''}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls="global-search-results"
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <div className="global-search-scroll" id="global-search-results" role="tabpanel" aria-label={`${activeTab} results`}
                    onScroll={(event) => {
                        const element = event.currentTarget
                        if (activeTab === 'tokens' && element.scrollHeight - element.scrollTop - element.clientHeight < 180) requestMoreTokenCatalog(chainId)
                    }}
                >
                    {!query ? (
                        <>
                            {(activeTab === 'all' || activeTab === 'tokens') && state.visibleRecentTokens.length > 0 && (
                                <Section
                                    title="Recent searches"
                                    icon={Clock3}
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
                                    {state.visibleRecentTokens.slice(0, 3).map((token, index) => (
                                        <SearchTokenRow
                                            key={Number(token.chainId) + ':' + token.address}
                                            token={token}
                                            index={index} {...navigation} onActive={navigation.setActiveIndex}
                                            variant="recent"
                                            onSelect={state.handleSelect}
                                        />
                                    ))}
                                </Section>
                            )}

                            {(activeTab === 'all' || activeTab === 'tokens') && (
                                <Section title="Tokens" action={activeTab === 'all' && browseTokens.length > 5 ? (
                                    <button type="button" className="global-search-section-action" onClick={() => setActiveTab('tokens')}>View all</button>
                                ) : null}>
                                    {loading && browseTokens.length === 0 ? (
                                        <div className="global-search-loading">
                                            {Array.from({ length: 5 }).map((_, index) => (
                                                <span key={index} />
                                            ))}
                                        </div>
                                    ) : (
                                        browseTokens
                                            .slice(0, activeTab === 'all' ? 5 : undefined)
                                            .map((token, index) => (
                                                <SearchTokenRow
                                                    key={Number(token.chainId) + ":" + token.address}
                                                    token={token}
                                                    variant="trending"
                                                    index={Math.min(3, state.visibleRecentTokens.length) + index}
                                                    {...navigation} onActive={navigation.setActiveIndex}
                                                    onSelect={state.handleSelect}
                                                />
                                            ))
                                    )}
                                </Section>
                            )}
                            {showTokens && !loading && browseTokens.length === 0 && <EmptySearchState tab={activeTab} query={query} />}

                            {activeTab === 'wallets' && (
                                <div className="global-search-empty compact">
                                    <Wallet aria-hidden="true" />
                                    <strong>Search wallets</strong>
                                    <span>Paste an EVM address to open its portfolio.</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            {walletResult && (
                                <Section title="Wallets">
                                    <button
                                        type="button"
                                        className="global-search-wallet-row" data-search-result id="global-search-result-0"
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
                                    {resultTokens.map((token, index) => (
                                        <SearchTokenRow
                                            key={Number(token.chainId) + ':' + token.address}
                                            token={token}
                                            index={index + (walletResult ? 1 : 0)} {...navigation} onActive={navigation.setActiveIndex}
                                            onSelect={state.handleSelect}
                                        />
                                    ))}
                                </Section>
                            )}


                            {!hasResults && loading && showTokens && <div className="global-search-loading" role="status" aria-label="Searching tokens">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>}
                            {!hasResults && (!loading || !showTokens) && (
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

            </motion.section>
        </motion.div>
    )

    return createPortal(modal, document.body)
}
