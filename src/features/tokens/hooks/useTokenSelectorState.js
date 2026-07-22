import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { swapUiConfig } from '../../../swapConfig.js'
import {
    filterEligibleMarketTokens,
    isCuratedCommonMarketToken,
} from '../services/marketTokens.js'
import {
    compareDecimalStrings,
    isTrustedWalletToken,
} from '../services/portfolio.js'
import { confirmRiskyTokenSelection } from '../services/tokenRisk.js'
import { getCoinGeckoTokenUrl } from '../services/tokenDetails.js'
import { resolveWalletUsdValue } from '../services/walletTokens.js'
import {
    readWalletTokenSectionExpanded,
    writeWalletTokenSectionExpanded,
} from '../services/walletTokenSections.js'
import {
    deduplicateTokens,
    getRecentStorageKey,
    getTokenKey,
    hasPositiveBalance,
    normalizeAddress,
    readRecentTokens,
    sanitizeStoredToken,
    sortGlobalMarketTokens,
    sortWalletTokens,
    writeRecentTokens,
} from '../model/tokenSelectorState.js'

const EMPTY_TOKENS = []
const DEFAULT_RECENT_LIMIT = 3

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        return
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
}

/**
 * Owns token-selector derived sections, recent-search persistence, context actions,
 * and selector lifecycle effects. It performs no quote, wallet, RPC, or transaction work.
 * @param {object} config Controlled catalog and selection inputs.
 * @returns {object} Section data and semantic callbacks consumed by TokenSelector.
 * @sideEffects Reads/writes localStorage, manages body scroll/keyboard listeners, and may open token details.
 * @throws Detail lookup and clipboard failures are converted to the returned notice state.
 * @security Exact chain/address identity and risky-token confirmation remain fail-closed.
 */
export function useTokenSelectorState({
    chainId,
    tokens = EMPTY_TOKENS,
    commonTokens = EMPTY_TOKENS,
    walletTokens = EMPTY_TOKENS,
    search,
    loading,
    error,
    catalogNotice = null,
    catalogDiagnostics = null,
    currentToken,
    oppositeToken,
    onSelect,
    onClose,
    hideUnknownTokens = true,
    hideSmallBalances = false,
}) {
    const recentLimit = Number(swapUiConfig.tokenSelector?.maxRecentTokens) || DEFAULT_RECENT_LIMIT
    const [recentTokens, setRecentTokens] = useState(() => readRecentTokens(chainId))
    const [contextMenu, setContextMenu] = useState(null)
    const [notice, setNotice] = useState('')
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [showHiddenTokens, setShowHiddenTokens] = useState(() => readWalletTokenSectionExpanded({ chainId, scope: 'selector', section: 'risky' }))
    const [showUnverifiedTokens, setShowUnverifiedTokens] = useState(() => readWalletTokenSectionExpanded({ chainId, scope: 'selector', section: 'unverified' }))
    const normalizedSearch = search.trim().toLowerCase()
    const exactAddressSearch = /^0x[a-f0-9]{40}$/.test(normalizedSearch)
    const chainScope = String(chainId).trim().toLowerCase() === 'all' ? 'all' : Number(chainId)
    const tokenIsInScope = useCallback((token) => chainScope === 'all' || Number(token?.chainId) === chainScope, [chainScope])
    const positiveWalletTokens = useMemo(() => deduplicateTokens(walletTokens).filter(tokenIsInScope).filter(hasPositiveBalance), [tokenIsInScope, walletTokens])
    const walletTokensByKey = useMemo(() => new Map(positiveWalletTokens.map((token) => [getTokenKey(token), token])), [positiveWalletTokens])
    const safeMarketTokens = useMemo(() => deduplicateTokens(
        normalizedSearch && exactAddressSearch
            ? tokens
            : filterEligibleMarketTokens(tokens),
    ).filter(tokenIsInScope).filter((token) =>
        !walletTokensByKey.has(getTokenKey(token))), [
        exactAddressSearch,
        normalizedSearch,
        tokenIsInScope,
        tokens,
        walletTokensByKey,
    ])
    const commonMarketTokens = useMemo(() => normalizedSearch ? EMPTY_TOKENS : deduplicateTokens(commonTokens).filter(tokenIsInScope).filter(isCuratedCommonMarketToken).filter((token) => !walletTokensByKey.has(getTokenKey(token))).filter((token) => !safeMarketTokens.some((marketToken) => getTokenKey(marketToken) === getTokenKey(token))).sort((left, right) => String(left.symbol).localeCompare(String(right.symbol)) || String(getTokenKey(left)).localeCompare(String(getTokenKey(right)))), [commonTokens, normalizedSearch, safeMarketTokens, tokenIsInScope, walletTokensByKey])
    const primaryWalletTokens = useMemo(() => sortWalletTokens(positiveWalletTokens.filter((token) => { const displayValue = resolveWalletUsdValue(token); return token.visibility === 'primary' && (!hideUnknownTokens || isTrustedWalletToken(token)) && (!hideSmallBalances || !hideUnknownTokens || displayValue === null || compareDecimalStrings(displayValue, '0.20') !== -1) })), [hideSmallBalances, hideUnknownTokens, positiveWalletTokens])
    const sortedGlobalMarketTokens = useMemo(() => sortGlobalMarketTokens(safeMarketTokens), [safeMarketTokens])
    const riskyWalletTokens = useMemo(() => positiveWalletTokens.filter((token) => token.visibility === 'hidden'), [positiveWalletTokens])
    const unverifiedWalletTokens = useMemo(() => positiveWalletTokens.filter((token) => token.visibility !== 'hidden' && !isTrustedWalletToken(token)), [positiveWalletTokens])
    const selectedHiddenTokens = useMemo(() => hideUnknownTokens
        ? EMPTY_TOKENS
        : deduplicateTokens([currentToken, oppositeToken]).filter((token) => token && (!isTrustedWalletToken(token) || ['unverified', 'hidden'].includes(token.visibility)) && walletTokensByKey.has(getTokenKey(token))), [currentToken, hideUnknownTokens, oppositeToken, walletTokensByKey])
    const visibleRecentTokens = useMemo(() => recentTokens.filter(tokenIsInScope).map((token) => walletTokensByKey.get(getTokenKey(token)) ?? token).filter((token) => { const walletToken = walletTokensByKey.get(getTokenKey(token)); return !walletToken || (!hideUnknownTokens && walletToken.visibility !== 'hidden') || isTrustedWalletToken(walletToken) }), [hideUnknownTokens, recentTokens, tokenIsInScope, walletTokensByKey])
    const searchResultTokens = useMemo(() => {
        if (!exactAddressSearch) return safeMarketTokens
        return deduplicateTokens([...positiveWalletTokens.filter((token) => normalizeAddress(token.address) === normalizedSearch), ...safeMarketTokens])
    }, [exactAddressSearch, normalizedSearch, positiveWalletTokens, safeMarketTokens])
    const marketStatusMessage = sortedGlobalMarketTokens.length > 0 ? catalogNotice === 'Popular tokens are temporarily unavailable.' ? 'Some market data could not be refreshed.' : catalogNotice ?? (error ? 'Some market data could not be refreshed.' : null) : !loading ? 'Popular tokens are temporarily unavailable.' : null
    const lastCatalogDiagnostic = useRef(null)

    useEffect(() => {
        if (!import.meta.env.DEV || !catalogDiagnostics || loading) return
        const scopedRankedTokens = tokens.filter(tokenIsInScope)
        const uniqueScopedRankedTokens = deduplicateTokens(scopedRankedTokens)
        const diagnostic = { scope: catalogDiagnostics.scope === 'all' ? 'all' : Number(catalogDiagnostics.scope), apiRankedCount: catalogDiagnostics.apiRankedCount, apiCommonCount: catalogDiagnostics.apiCommonCount, normalizedRankedCount: tokens.length, normalizedCommonCount: commonTokens.length, walletDuplicateCount: uniqueScopedRankedTokens.filter((token) => walletTokensByKey.has(getTokenKey(token))).length, rankedDuplicateCount: scopedRankedTokens.length - uniqueScopedRankedTokens.length, renderedRankedCount: sortedGlobalMarketTokens.length, renderedCommonCount: commonMarketTokens.length, partial: catalogDiagnostics.partial === true, stale: catalogDiagnostics.stale === true, schemaVersion: catalogDiagnostics.schemaVersion }
        const signature = JSON.stringify(diagnostic)
        if (lastCatalogDiagnostic.current === signature) return
        lastCatalogDiagnostic.current = signature
        console.debug('[market-catalog-normalized]', diagnostic)
    }, [catalogDiagnostics, commonMarketTokens.length, commonTokens.length, loading, sortedGlobalMarketTokens.length, tokenIsInScope, tokens, walletTokensByKey])

    useEffect(() => {
        setRecentTokens(readRecentTokens(chainId))
        setShowHiddenTokens(readWalletTokenSectionExpanded({ chainId, scope: 'selector', section: 'risky' }))
        setShowUnverifiedTokens(readWalletTokenSectionExpanded({ chainId, scope: 'selector', section: 'unverified' }))
    }, [chainId])
    useEffect(() => {
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        function closeMenus(event) {
            if (event.key !== 'Escape') return
            if (contextMenu) setContextMenu(null)
            else onClose()
        }
        function closeContextMenu() { setContextMenu(null) }
        window.addEventListener('keydown', closeMenus)
        window.addEventListener('resize', closeContextMenu)
        return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeMenus); window.removeEventListener('resize', closeContextMenu) }
    }, [contextMenu, onClose])
    useEffect(() => { if (!notice) return undefined; const timeout = window.setTimeout(() => setNotice(''), 1800); return () => window.clearTimeout(timeout) }, [notice])

    const toggleHiddenTokens = useCallback(() => setShowHiddenTokens((value) => writeWalletTokenSectionExpanded({ chainId, scope: 'selector', section: 'risky', expanded: !value })), [chainId])
    const toggleUnverifiedTokens = useCallback(() => setShowUnverifiedTokens((value) => writeWalletTokenSectionExpanded({ chainId, scope: 'selector', section: 'unverified', expanded: !value })), [chainId])
    const saveRecentToken = useCallback((token) => {
        if (!normalizedSearch) return
        const stored = sanitizeStoredToken(token)
        if (!stored) return
        const next = [stored, ...recentTokens.filter((item) => getTokenKey(item) !== getTokenKey(stored))].slice(0, recentLimit)
        setRecentTokens(next)
        writeRecentTokens(chainId, next)
    }, [chainId, normalizedSearch, recentLimit, recentTokens])
    const handleSelect = useCallback((token) => { if (!confirmRiskyTokenSelection(token, 'use this token')) return; saveRecentToken(token); onSelect(token) }, [onSelect, saveRecentToken])
    const clearRecentTokens = useCallback(() => { setRecentTokens([]); try { const key = getRecentStorageKey(chainId); if (key) window.localStorage.removeItem(key) } catch { /* storage unavailable */ } }, [chainId])
    const openContextMenu = useCallback((event, token) => { event.preventDefault(); event.stopPropagation(); const menuWidth = 210; const menuHeight = 104; const margin = 12; const x = Math.min(event.clientX, window.innerWidth - menuWidth - margin); const y = Math.min(event.clientY, window.innerHeight - menuHeight - margin); setContextMenu({ token, x: Math.max(margin, x), y: Math.max(margin, y) }) }, [])
    const handleCopyAddress = useCallback(async () => {
        const address = String(contextMenu?.token?.address ?? '').trim()
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) { setNotice('This token has no contract address.'); setContextMenu(null); return }
        try { await copyText(address); setNotice('Address copied') } catch { setNotice('Could not copy address') }
        setContextMenu(null)
    }, [contextMenu])
    const handleTokenDetails = useCallback(async () => {
        const token = contextMenu?.token
        if (!token || detailsLoading) return
        setDetailsLoading(true)
        const popup = window.open('about:blank', '_blank')
        if (popup) popup.opener = null
        try { const url = await getCoinGeckoTokenUrl(token); if (popup) popup.location.replace(url); else window.open(url, '_blank', 'noopener,noreferrer') } catch (detailsError) { popup?.close(); setNotice(detailsError instanceof Error ? detailsError.message : 'Token details are unavailable.') } finally { setDetailsLoading(false); setContextMenu(null) }
    }, [contextMenu, detailsLoading])

    return { normalizedSearch, chainScope, primaryWalletTokens, selectedHiddenTokens, unverifiedWalletTokens, riskyWalletTokens, visibleRecentTokens, sortedGlobalMarketTokens, commonMarketTokens, searchResultTokens, marketStatusMessage, showHiddenTokens, showUnverifiedTokens, toggleHiddenTokens, toggleUnverifiedTokens, clearRecentTokens, handleSelect, openContextMenu, contextMenu, notice, detailsLoading, handleCopyAddress, handleTokenDetails, setContextMenu }
}
