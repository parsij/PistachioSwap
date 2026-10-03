import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'

import { TokenSearchResults, TokenSelectorSections as Sections } from './TokenSelectorSections.jsx'
import { ChainSelector } from './TokenSelectorPrimitives.jsx'
import { CloseIcon, CopyIcon, InfoIcon, SearchIcon } from './TokenSelectorIcons.jsx'
import { useTokenSelectorState } from '../hooks/useTokenSelectorState.js'
import { requestMoreTokenCatalog } from '../hooks/useTokenCatalog.js'
import { swapUiConfig } from '../../../swapConfig.js'
import SendTokenPicker from '../../wallet/components/wallet/SendTokenPicker.jsx'
import GlobalSearchModal from './GlobalSearchModal.jsx'
import './TokenSelector.css'
import './TokenSelectorPolish.css'
import './TokenIconLoading.css'

const COMPACT_SELECTOR_QUERY = '(max-width: 720px), (max-width: 900px) and (max-height: 760px)'

function isCompactSelectorViewport() {
    return typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia(COMPACT_SELECTOR_QUERY).matches
}

export function shouldDismissTokenSelectorDrag(info) {
    const offsetY = Number(info?.offset?.y ?? 0)
    const velocityY = Number(info?.velocity?.y ?? 0)
    return offsetY >= 96 || velocityY >= 700
}

/**
 * Renders token selection. Send gets its own in-dialog picker so it stays inside
 * the active Radix interaction layer; swap/buy continue using the global modal.
 */
export default function TokenSelector(props) {
    if (props.side === 'send') {
        return <SendTokenSelectorPortal {...props} />
    }
    if (props.mode === 'global-search') {
        return <GlobalSearchModal {...props} />
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
    const dragY = useMotionValue(compact && !reducedMotion ? 72 : 0)
    const dragSession = useRef(null)
    const settleAnimation = useRef(null)
    const initialScopeApplied = useRef(false)
    const state = useTokenSelectorState({ chainId, tokens, commonTokens, fallbackTokens, walletTokens, search, loading, error, catalogNotice, catalogDiagnostics, currentToken, oppositeToken, onSelect, onClose, hideUnknownTokens, hideSmallBalances })

    useEffect(() => {
        settleAnimation.current?.stop?.()
        settleAnimation.current = null

        if (!compact || reducedMotion) {
            dragY.set(0)
            return undefined
        }

        const controls = animate(dragY, 0, {
            type: 'spring',
            stiffness: 360,
            damping: 34,
        })
        settleAnimation.current = controls

        return () => controls.stop()
    }, [compact, dragY, reducedMotion])

    useLayoutEffect(() => {
        if (initialScopeApplied.current || !onChainChange) return
        initialScopeApplied.current = true

        const emptyOutputSide = side === 'buy' && !currentToken
        const oppositeChainId = Number(oppositeToken?.chainId)
        const oppositeWasExplicitlySelected = oppositeToken?.uiSelectionOrigin === 'user'
        const keepEmptyOutputGlobal = emptyOutputSide && !oppositeWasExplicitlySelected
        const preferredChainId = keepEmptyOutputGlobal
            ? 'all'
            : Number.isSafeInteger(oppositeChainId) && oppositeChainId > 0
                ? oppositeChainId
                : 'all'

        if (String(chainId) === String(preferredChainId)) return
        onSearchChange('')
        onChainChange(preferredChainId)
    }, [chainId, currentToken, onChainChange, onSearchChange, oppositeToken?.chainId, oppositeToken?.uiSelectionOrigin, side])

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
    const settleSheet = () => {
        settleAnimation.current?.stop?.()
        if (reducedMotion) {
            dragY.set(0)
            return
        }
        settleAnimation.current = animate(dragY, 0, {
            type: 'spring',
            stiffness: 520,
            damping: 42,
        })
    }
    const startSheetDrag = (event) => {
        event.stopPropagation()
        if (!compact) return
        if (event.button !== undefined && event.button !== 0) return

        event.preventDefault()
        settleAnimation.current?.stop?.()
        settleAnimation.current = null
        event.currentTarget.setPointerCapture?.(event.pointerId)

        dragSession.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startOffsetY: Number(dragY.get()) || 0,
            lastY: event.clientY,
            lastTime: event.timeStamp,
            velocityY: 0,
        }
    }
    const moveSheetDrag = (event) => {
        const session = dragSession.current
        if (!session || event.pointerId !== session.pointerId) return

        event.preventDefault()
        const nextY = Math.max(
            0,
            session.startOffsetY + event.clientY - session.startY,
        )
        const elapsed = event.timeStamp - session.lastTime
        if (elapsed > 0) {
            session.velocityY = ((event.clientY - session.lastY) / elapsed) * 1000
        }
        session.lastY = event.clientY
        session.lastTime = event.timeStamp
        dragY.set(nextY)
    }
    const finishSheetDrag = (event, { cancelled = false } = {}) => {
        const session = dragSession.current
        if (!session || event.pointerId !== session.pointerId) return

        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        dragSession.current = null

        const info = {
            offset: { y: Number(dragY.get()) || 0 },
            velocity: { y: session.velocityY },
        }
        if (!cancelled && shouldDismissTokenSelectorDrag(info)) {
            onClose()
            return
        }
        settleSheet()
    }

    return <motion.div className="ps-token-selector-backdrop" data-side={side} data-compact={compact ? 'true' : 'false'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
        <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={`Select a token for ${side}`}
            className="ps-token-selector-dialog"
            initial={compact
                ? { opacity: reducedMotion ? 1 : 0, scale: 1 }
                : { opacity: reducedMotion ? 1 : 0, scale: dialogScale, y: dialogOffset }}
            animate={compact
                ? { opacity: 1, scale: 1 }
                : { opacity: 1, scale: 1, y: 0 }}
            exit={compact
                ? { opacity: reducedMotion ? 1 : 0, scale: 1 }
                : { opacity: reducedMotion ? 1 : 0, scale: dialogScale, y: dialogOffset }}
            transition={{ type: 'spring', stiffness: compact ? 360 : motionConfig.stiffness, damping: compact ? 34 : motionConfig.damping }}
            style={compact ? { y: dragY } : undefined}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <button
                type="button"
                className="ps-token-selector-handle"
                aria-label="Drag token selector"
                onPointerDown={startSheetDrag}
                onPointerMove={moveSheetDrag}
                onPointerUp={finishSheetDrag}
                onPointerCancel={(event) => finishSheetDrag(event, { cancelled: true })}
            >
                <span aria-hidden="true" />
            </button>
            <header className="ps-token-selector-header"><h2>Select a token</h2><button type="button" className="ps-token-selector-close" aria-label="Close" onClick={onClose}><CloseIcon /></button></header>
            <div className="ps-token-search-wrapper"><div className="ps-token-search"><SearchIcon /><input autoFocus={!compact} aria-label="Search tokens" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search tokens" autoComplete="off" spellCheck="false" /><ChainSelector chainId={state.chainScope} onChange={handleChainChange} /></div></div>
            <div className="ps-token-selector-scroll" onScroll={handleCatalogScroll}>{state.normalizedSearch ? <TokenSearchResults loading={loading} error={error} tokens={state.searchResultTokens} hiddenTokens={state.selectedHiddenTokens} onSelect={state.handleSelect} onContextMenu={state.openContextMenu} currentToken={currentToken} oppositeToken={oppositeToken} /> : <Sections state={state} loading={loading} currentToken={currentToken} oppositeToken={oppositeToken} hideUnknownTokens={hideUnknownTokens} walletOnly={walletOnly} />}</div>
        </motion.section>
        {state.contextMenu && <motion.div role="menu" className="ps-token-context-menu" style={{ left: state.contextMenu.x, top: state.contextMenu.y }} initial={{ opacity: 0, scale: 0.96, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><button type="button" role="menuitem" onClick={state.handleCopyAddress}><CopyIcon /><span>Copy address</span></button><button type="button" role="menuitem" disabled={state.detailsLoading} onClick={state.handleTokenDetails}><InfoIcon /><span>{state.detailsLoading ? 'Opening...' : 'Token details'}</span></button></motion.div>}
        {state.notice && <motion.div className="ps-token-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{state.notice}</motion.div>}
    </motion.div>
}
