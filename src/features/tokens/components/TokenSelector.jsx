import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from 'motion/react'

import { motion } from 'motion/react'

import { TokenSearchResults, TokenSelectorSections as Sections } from './TokenSelectorSections.jsx'
import { ChainSelector } from './TokenSelectorPrimitives.jsx'
import { CloseIcon, CopyIcon, InfoIcon, SearchIcon } from './TokenSelectorIcons.jsx'
import { useTokenSelectorState } from '../hooks/useTokenSelectorState.js'
import { requestMoreTokenCatalog } from '../hooks/useTokenCatalog.js'
import { swapUiConfig } from '../../../swapConfig.js'
import SendTokenPicker from '../../wallet/components/wallet/SendTokenPicker.jsx'
import './TokenSelector.css'
import './TokenSelectorPolish.css'
import './TokenIconLoading.css'

const COMPACT_SELECTOR_QUERY = '(max-width: 720px), (max-width: 900px) and (max-height: 760px)'

function isCompactSelectorViewport() {
    return typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia(COMPACT_SELECTOR_QUERY).matches
}

/**
 * Renders token selection. Send gets its own in-dialog picker so it stays inside
 * the active Radix interaction layer; swap/buy continue using the global modal.
 */
export default function TokenSelector(props) {
    if (props.side === 'send') {
        return <SendTokenSelectorPortal {...props} />
    }
    return <GlobalTokenSelector {...props} />
}

function SendTokenSelectorPortal({
    chainId,
    walletTokens = [],
    search,
    onSearchChange,
    onSelect,
    onClose,
    onChainChange,
}) {
    if (typeof document === 'undefined') return null
    const target = document.querySelector('.wallet-send-dialog')
    if (!target) return null

    return createPortal(
        <SendTokenPicker
            chainId={chainId}
            walletTokens={walletTokens}
            search={search}
            onSearchChange={onSearchChange}
            onSelect={onSelect}
            onClose={onClose}
            onChainChange={onChainChange}
        />,
        target,
    )
}

function GlobalTokenSelector({
    side,
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
    onChainChange = null,
    walletOnly = false,
}) {
    const reducedMotion = useReducedMotion()
    const motionConfig = swapUiConfig.motion.dialog
    const compact = isCompactSelectorViewport()
    const initialScopeApplied = useRef(false)
    const state = useTokenSelectorState({ chainId, tokens, commonTokens, fallbackTokens, walletTokens, search, loading, error, catalogNotice, catalogDiagnostics, currentToken, oppositeToken, onSelect, onClose, hideUnknownTokens, hideSmallBalances })

    useLayoutEffect(() => {
        if (initialScopeApplied.current || !onChainChange) return
        initialScopeApplied.current = true

        const oppositeChainId = Number(oppositeToken?.chainId)
        const preferredChainId = Number.isSafeInteger(oppositeChainId) && oppositeChainId > 0
            ? oppositeChainId
            : 'all'

        if (String(chainId) === String(preferredChainId)) return
        onSearchChange('')
        onChainChange(preferredChainId)
    }, [chainId, onChainChange, onSearchChange, oppositeToken?.chainId])

    const handleChainChange = (value) => {
        if (!onChainChange) return
        onSearchChange('')
        onChainChange(value === 'all' ? 'all' : Number(value))
    }
    const handleCatalogScroll = (event) => {
        state.setContextMenu(null)
        if (walletOnly || state.normalizedSearch || chainId === 'all') return
        const element = event.currentTarget
        const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
        if (remaining <= 180) requestMoreTokenCatalog(chainId)
    }
    const dialogScale = reducedMotion || compact ? 1 : motionConfig.scale
    const dialogOffset = reducedMotion ? 0 : compact ? 72 : motionConfig.offsetY

    return <motion.div className="ps-token-selector-backdrop" data-side={side} data-compact={compact ? 'true' : 'false'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
        <motion.section role="dialog" aria-modal="true" aria-label={`Select a token for ${side}`} className="ps-token-selector-dialog" initial={{ opacity: reducedMotion ? 1 : 0, scale: dialogScale, y: dialogOffset }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: reducedMotion ? 1 : 0, scale: dialogScale, y: dialogOffset }} transition={{ type: 'spring', stiffness: compact ? 360 : motionConfig.stiffness, damping: compact ? 34 : motionConfig.damping }} onPointerDown={(event) => event.stopPropagation()}>
            <div className="ps-token-selector-handle" aria-hidden="true" />
            <header className="ps-token-selector-header"><h2>Select a token</h2><button type="button" className="ps-token-selector-close" aria-label="Close" onClick={onClose}><CloseIcon /></button></header>
            <div className="ps-token-search-wrapper"><div className="ps-token-search"><SearchIcon /><input autoFocus={!compact} aria-label="Search tokens" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search tokens" autoComplete="off" spellCheck="false" /><ChainSelector chainId={state.chainScope} onChange={handleChainChange} /></div></div>
            <div className="ps-token-selector-scroll" onScroll={handleCatalogScroll}>{state.normalizedSearch ? <TokenSearchResults loading={loading} error={error} tokens={state.searchResultTokens} hiddenTokens={state.selectedHiddenTokens} onSelect={state.handleSelect} onContextMenu={state.openContextMenu} currentToken={currentToken} oppositeToken={oppositeToken} /> : <Sections state={state} loading={loading} currentToken={currentToken} oppositeToken={oppositeToken} hideUnknownTokens={hideUnknownTokens} walletOnly={walletOnly} />}</div>
        </motion.section>
        {state.contextMenu && <motion.div role="menu" className="ps-token-context-menu" style={{ left: state.contextMenu.x, top: state.contextMenu.y }} initial={{ opacity: 0, scale: 0.96, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><button type="button" role="menuitem" onClick={state.handleCopyAddress}><CopyIcon /><span>Copy address</span></button><button type="button" role="menuitem" disabled={state.detailsLoading} onClick={state.handleTokenDetails}><InfoIcon /><span>{state.detailsLoading ? 'Opening...' : 'Token details'}</span></button></motion.div>}
        {state.notice && <motion.div className="ps-token-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{state.notice}</motion.div>}
    </motion.div>
}
