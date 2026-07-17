import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react'

import {
    motion,
    useReducedMotion,
} from 'motion/react'
import { ShieldAlert } from 'lucide-react'

import TokenIcon from './TokenIcon.jsx'
import './TokenSelector.css'

import {
    getCoinGeckoTokenUrl,
} from '../services/tokenDetails.js'
import {
    formatWalletTokenAmount,
    formatWalletUsdValue,
} from '../services/walletTokens.js'
import { getCanonicalTokenIdentity } from '../services/marketTokens.js'
import { compareDecimalStrings } from '../services/portfolio.js'
import { confirmRiskyTokenSelection } from '../services/tokenRisk.js'
import {
    readWalletTokenSectionExpanded,
    writeWalletTokenSectionExpanded,
} from '../services/walletTokenSections.js'

import {
    swapUiConfig,
} from '../swapConfig.js'
import {
    CURATED_EVM_CHAINS,
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
    TOKEN_DISCOVERY_CHAIN_IDS,
} from '../web3/curatedEvmChains.js'

const DEFAULT_RECENT_LIMIT = 3
const EMPTY_TOKENS = []

function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
                cx="10.5"
                cy="10.5"
                r="6.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
            />

            <path
                d="m16 16 4.3 4.3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.9"
            />
        </svg>
    )
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="m6 6 12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
            />
        </svg>
    )
}

function ChevronDownIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="m6 9 6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
            />
        </svg>
    )
}

function CopyIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect
                x="8"
                y="8"
                width="11"
                height="11"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />

            <path
                d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
        </svg>
    )
}

function InfoIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
                cx="12"
                cy="12"
                r="9"
                fill="currentColor"
            />

            <path
                d="M12 10.5v6M12 7.5h.01"
                fill="none"
                stroke="#191919"
                strokeLinecap="round"
                strokeWidth="2"
            />
        </svg>
    )
}

function WalletIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />

            <path
                d="M16 12h4v4h-4a2 2 0 0 1 0-4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />
        </svg>
    )
}

function ClockIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
                cx="12"
                cy="12"
                r="8.5"
                fill="currentColor"
            />

            <path
                d="M12 7.5V12l3 2"
                fill="none"
                stroke="#191919"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />
        </svg>
    )
}

function TrendingIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="m4 16 5-5 4 4 7-8"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />

            <path
                d="M15 7h5v5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />
        </svg>
    )
}

function normalizeAddress(address) {
    return String(address ?? '')
        .trim()
        .toLowerCase()
}

function getTokenKey(token) {
    return getCanonicalTokenIdentity(token)
}

function shortenAddress(address) {
    const normalized =
        String(address ?? '').trim()

    if (
        !/^0x[a-fA-F0-9]{40}$/.test(
            normalized,
        )
    ) {
        return null
    }

    return (
        `${normalized.slice(0, 6)}` +
        `...${normalized.slice(-4)}`
    )
}

function hasPositiveBalance(token) {
    if (/^\d+$/.test(String(token?.rawBalance ?? ''))) {
        return BigInt(token.rawBalance) > 0n
    }
    return /^\d+(?:\.\d+)?$/.test(String(token?.balance ?? '')) &&
        /[1-9]/.test(String(token.balance))
}

function deduplicateTokens(tokens) {
    const map = new Map()

    for (const token of tokens) {
        const identity = getTokenKey(token)
        if (identity) {
            map.set(identity, token)
        }
    }

    return [...map.values()]
}

function sanitizeStoredToken(token) {
    if (!getTokenKey(token)) return null
    const logoCandidates = [
        ...(Array.isArray(token.logoCandidates)
            ? token.logoCandidates
            : []),
        token.logoURI,
        token.iconUrl,
    ].filter(
        (value, index, values) =>
            typeof value === 'string' &&
            value.length > 0 &&
            values.indexOf(value) === index,
    )

    return {
        classificationVersion: token.classificationVersion ?? null,
        id: token.id ?? null,
        chainId: Number(token.chainId ?? 0),
        address: token.address ?? '',
        symbol: token.symbol ?? '',
        name:
            token.name ??
            token.symbol ??
            'Unknown token',
        decimals: Number(token.decimals ?? 18),
        logoURI:
            logoCandidates[0] ?? null,
        iconUrl:
            logoCandidates[0] ?? null,
        logoCandidates,
        logoSource:
            token.logoSource ??
            (logoCandidates.length > 0
                ? 'local'
                : 'fallback'),
        chainLogoURI:
            token.chainLogoURI ??
            token.networkLogoURI ??
            null,
        networkLogoURI:
            token.networkLogoURI ??
            token.chainLogoURI ??
            null,
        balance: String(token.balance ?? '0'),
        priceUSD: token.priceUSD ?? null,
        coinGeckoId:
            token.coinGeckoId ??
            token.coingeckoId ??
            token.coingecko_coin_id ??
            null,
        recognitionStatus: token.recognitionStatus ?? 'unverified',
        recognitionReasons: token.recognitionReasons ?? [],
        spamStatus: token.spamStatus ?? 'unknown',
        possibleSpam: token.possibleSpam ?? null,
        verifiedContract: token.verifiedContract ?? null,
        spamReasons: token.spamReasons ?? [],
        securityStatus: token.securityStatus ?? 'unknown',
        securityReasons: token.securityReasons ?? [],
        visibility: token.visibility ?? 'hidden',
        priceConfidence: token.priceConfidence ?? 'unknown',
        trustedPriceUSD: token.trustedPriceUSD ?? null,
        marketPriceUSD: token.marketPriceUSD ?? null,
        valueUSD: token.valueUSD ?? null,
    }
}

function getRecentStorageKey(chainId) {
    const scope = String(chainId).trim().toLowerCase() === 'all'
        ? 'all'
        : Number(chainId)
    if (
        scope !== 'all' &&
        (!Number.isSafeInteger(scope) || scope <= 0)
    ) {
        return null
    }
    return [
        'pistachioswap',
        'recent-token-searches',
        'v3',
        scope,
    ].join(':')
}

function readRecentTokens(chainId) {
    if (typeof window === 'undefined') {
        return []
    }

    try {
        const key = getRecentStorageKey(chainId)
        if (!key) return []
        const value =
            window.localStorage.getItem(
                key,
            )

        if (!value) {
            return []
        }

        const parsed = JSON.parse(value)

        return Array.isArray(parsed)
            ? parsed
            : []
    } catch {
        return []
    }
}

function writeRecentTokens(
    chainId,
    tokens,
) {
    try {
        const key = getRecentStorageKey(chainId)
        if (!key) return
        window.localStorage.setItem(
            key,
            JSON.stringify(tokens),
        )
    } catch {
        // Browser storage may be unavailable.
    }
}

async function copyText(text) {
    if (
        navigator.clipboard &&
        window.isSecureContext
    ) {
        await navigator.clipboard.writeText(text)
        return
    }

    const textarea =
        document.createElement('textarea')

    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'

    document.body.appendChild(textarea)

    textarea.focus()
    textarea.select()

    document.execCommand('copy')
    textarea.remove()
}

function ChainSelector({
                           chainId,
                           onChange,
                       }) {
    const [open, setOpen] = useState(false)
    const selectedChain = chainId === 'all'
        ? null
        : getCuratedEvmChain(chainId)
    const options = [
        { id: 'all', name: 'All Chains', active: true },
        ...CURATED_EVM_CHAINS.map((chain) => ({
            id: chain.id,
            name: chain.name,
            active: TOKEN_DISCOVERY_CHAIN_IDS.includes(chain.id),
        })),
    ]

    function selectOption(option) {
        if (!option.active) return
        onChange(String(option.id))
        setOpen(false)
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape') {
            setOpen(false)
            return
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((value) => !value)
        }
    }

    return (
        <div className="ps-network-control">
            <button
                type="button"
                className="ps-network-trigger"
                aria-label="Token network"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={handleKeyDown}
            >
                {selectedChain ? (
                    <span className="ps-chain-icon">
                        <span aria-hidden="true">{selectedChain.name.slice(0, 1)}</span>
                        <img
                            src={getCuratedEvmChainLogoUri(selectedChain.id)}
                            alt=""
                            onError={(event) => event.currentTarget.remove()}
                        />
                    </span>
                ) : (
                    <span className="ps-chain-icon ps-chain-icon-all" aria-hidden="true">∞</span>
                )}
                <span>{selectedChain?.name ?? 'All Chains'}</span>
                <ChevronDownIcon />
            </button>
            {open && (
                <div
                    className="ps-network-menu"
                    role="listbox"
                    aria-label="Token network"
                >
                    {options.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={String(option.id) === String(chainId)}
                            aria-disabled={!option.active}
                            disabled={!option.active}
                            onClick={() => selectOption(option)}
                        >
                            {option.id === 'all' ? (
                                <span className="ps-chain-icon ps-chain-icon-all" aria-hidden="true">∞</span>
                            ) : (
                                <span className="ps-chain-icon">
                                    <span aria-hidden="true">{option.name.slice(0, 1)}</span>
                                    <img
                                        src={getCuratedEvmChainLogoUri(option.id)}
                                        alt=""
                                        onError={(event) => event.currentTarget.remove()}
                                    />
                                </span>
                            )}
                            <span>{option.name}</span>
                            {!option.active && <small>Unavailable</small>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function TokenSkeletonList() {
    return (
        <div
            className="ps-token-skeleton-list"
            aria-label="Loading tokens"
        >
            {Array.from({
                length: 8,
            }).map((_, index) => (
                <div
                    key={index}
                    className="ps-token-skeleton-row"
                >
                    <span className="ps-skeleton ps-skeleton-circle" />

                    <span className="ps-token-skeleton-text">
            <span className="ps-skeleton ps-skeleton-name" />
            <span className="ps-skeleton ps-skeleton-meta" />
          </span>

                    <span className="ps-skeleton ps-skeleton-value" />
                </div>
            ))}
        </div>
    )
}

function SectionTitle({
                          icon,
                          children,
                          action,
                      }) {
    return (
        <div className="ps-token-section-title">
      <span className="ps-token-section-heading">
        {icon}
          {children}
      </span>

            {action}
        </div>
    )
}

function TokenRow({
                      token,
                      currentToken,
                      oppositeToken,
                      showBalance = false,
                      onSelect,
                      onContextMenu,
                  }) {
    const address =
        token.isNative ? null : shortenAddress(token.address)

    const isCurrent =
        getTokenKey(token) !== null &&
        getTokenKey(token) ===
        getTokenKey(currentToken)

    const isOpposite =
        getTokenKey(token) !== null &&
        getTokenKey(token) ===
        getTokenKey(oppositeToken)
    const chainName = getCuratedEvmChain(token.chainId)?.name ?? `Chain ${token.chainId}`

    return (
        <button
            type="button"
            className={[
                'ps-token-row',
                isCurrent ? 'ps-token-row-selected' : '',
                isOpposite ? 'ps-token-row-opposite' : '',
                token.visibility === 'hidden' ? 'ps-token-row-hidden' : '',
            ].filter(Boolean).join(' ')}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onSelect(token)}
            onContextMenu={(event) =>
                onContextMenu(event, token)
            }
        >
            <TokenIcon
                token={token}
                size="list"
            />

            <span className="ps-token-row-details">
        <strong>
          {token.name || token.symbol}
        </strong>

        <span className="ps-token-row-meta">
          <span>{token.symbol}</span>

            <span className="ps-token-chain-label">{chainName}</span>

            {address && (
                <span>{address}</span>
            )}
            {(
                token.possibleSpam === true ||
                ['high', 'blocked'].includes(token.securityStatus)
            ) && (
                <span className="ps-token-risk-label">
                    <ShieldAlert aria-hidden="true" />
                    Potential risk
                </span>
            )}
        </span>
      </span>

            <span className="ps-token-row-value">
        {showBalance ? (
            <>
                <strong>{formatWalletUsdValue(token)}</strong>
                <span>{formatWalletTokenAmount(token.balance)}</span>
            </>
        ) : null}
      </span>
        </button>
    )
}

export default function TokenSelector({
                                          side,
                                          chainId,
                                          tokens,
                                          walletTokens = EMPTY_TOKENS,
                                          search,
                                          loading,
                                          error,
                                          currentToken,
                                          oppositeToken,
                                          onSearchChange,
                                          onSelect,
                                          onClose,
                                          hideUnknownTokens = true,
                                          hideSmallBalances = false,
                                          onChainChange = null,
                                      }) {
    const reducedMotion =
        useReducedMotion()

    const motionConfig =
        swapUiConfig.motion.dialog

    const recentLimit =
        Number(
            swapUiConfig.tokenSelector
                ?.maxRecentTokens,
        ) || DEFAULT_RECENT_LIMIT

    const [recentTokens, setRecentTokens] =
        useState(() =>
            readRecentTokens(chainId),
        )

    const [contextMenu, setContextMenu] =
        useState(null)

    const [notice, setNotice] =
        useState('')

    const [detailsLoading, setDetailsLoading] =
        useState(false)

    const [showHiddenTokens, setShowHiddenTokens] =
        useState(() => readWalletTokenSectionExpanded({
            chainId,
            scope: 'selector',
            section: 'risky',
        }))

    const [showUnverifiedTokens, setShowUnverifiedTokens] =
        useState(() => readWalletTokenSectionExpanded({
            chainId,
            scope: 'selector',
            section: 'unverified',
        }))

    const normalizedSearch =
        search.trim().toLowerCase()
    const chainScope = String(chainId).trim().toLowerCase() === 'all'
        ? 'all'
        : Number(chainId)
    const tokenIsInScope = useCallback(
        (token) =>
            chainScope === 'all' || Number(token?.chainId) === chainScope,
        [chainScope],
    )

    const positiveWalletTokens = useMemo(
        () => deduplicateTokens(walletTokens)
            .filter(tokenIsInScope)
            .filter(hasPositiveBalance),
        [tokenIsInScope, walletTokens],
    )

    const walletTokensByKey = useMemo(
        () => new Map(positiveWalletTokens.map((token) => [getTokenKey(token), token])),
        [positiveWalletTokens],
    )

    const safeMarketTokens = useMemo(
        () => deduplicateTokens(tokens).filter(tokenIsInScope).filter((token) => {
            const walletToken = walletTokensByKey.get(getTokenKey(token))
            return !walletToken || walletToken.visibility === 'primary'
        }),
        [tokenIsInScope, tokens, walletTokensByKey],
    )

    const featuredTokenGroups = useMemo(() => {
        if (chainScope !== 'all') {
            return [[chainScope, safeMarketTokens.slice(0, 4)]]
        }
        const groups = new Map()
        for (const token of safeMarketTokens) {
            const group = groups.get(token.chainId) ?? []
            if (group.length < 4) group.push(token)
            groups.set(token.chainId, group)
        }
        return [...groups.entries()]
    }, [chainScope, safeMarketTokens])

    const primaryWalletTokens = useMemo(
        () => positiveWalletTokens.filter((token) =>
            token.visibility === 'primary' &&
            (!hideSmallBalances || !hideUnknownTokens ||
                token.valueUSD == null ||
                compareDecimalStrings(token.valueUSD, '0.20') !== -1),
        ),
        [hideSmallBalances, hideUnknownTokens, positiveWalletTokens],
    )

    const riskyWalletTokens = useMemo(
        () => positiveWalletTokens.filter((token) =>
            token.visibility === 'hidden',
        ),
        [positiveWalletTokens],
    )

    const unverifiedWalletTokens = useMemo(
        () => positiveWalletTokens.filter((token) =>
            token.visibility === 'unverified',
        ),
        [positiveWalletTokens],
    )

    const selectedHiddenTokens = useMemo(
        () => deduplicateTokens([currentToken, oppositeToken]).filter((token) =>
            token &&
            ['unverified', 'hidden'].includes(token.visibility) &&
            walletTokensByKey.has(getTokenKey(token)),
        ),
        [currentToken, oppositeToken, walletTokensByKey],
    )

    const visibleRecentTokens = useMemo(
        () => recentTokens
            .filter(tokenIsInScope)
            .map((token) => walletTokensByKey.get(getTokenKey(token)) ?? token)
            .filter((token) => {
                const walletToken = walletTokensByKey.get(getTokenKey(token))
                return !walletToken || walletToken.visibility === 'primary'
            }),
        [recentTokens, tokenIsInScope, walletTokensByKey],
    )

    const searchResultTokens = useMemo(() => {
        const exactAddress = /^0x[a-f0-9]{40}$/.test(normalizedSearch)
        if (!exactAddress) return safeMarketTokens
        const walletMatches = positiveWalletTokens.filter((token) =>
            normalizeAddress(token.address) === normalizedSearch,
        )
        return deduplicateTokens([...walletMatches, ...safeMarketTokens])
    }, [normalizedSearch, positiveWalletTokens, safeMarketTokens])

    useEffect(() => {
        setRecentTokens(
            readRecentTokens(chainId),
        )
        setShowHiddenTokens(readWalletTokenSectionExpanded({
            chainId,
            scope: 'selector',
            section: 'risky',
        }))
        setShowUnverifiedTokens(readWalletTokenSectionExpanded({
            chainId,
            scope: 'selector',
            section: 'unverified',
        }))
    }, [chainId])

    function toggleHiddenTokens() {
        setShowHiddenTokens((value) => writeWalletTokenSectionExpanded({
            chainId,
            scope: 'selector',
            section: 'risky',
            expanded: !value,
        }))
    }

    function toggleUnverifiedTokens() {
        setShowUnverifiedTokens((value) => writeWalletTokenSectionExpanded({
            chainId,
            scope: 'selector',
            section: 'unverified',
            expanded: !value,
        }))
    }

    useEffect(() => {
        const previousOverflow =
            document.body.style.overflow

        document.body.style.overflow =
            'hidden'

        function closeMenus(event) {
            if (event.key === 'Escape') {
                if (contextMenu) {
                    setContextMenu(null)
                } else {
                    onClose()
                }
            }
        }

        function closeContextMenu() {
            setContextMenu(null)
        }

        window.addEventListener(
            'keydown',
            closeMenus,
        )

        window.addEventListener(
            'resize',
            closeContextMenu,
        )

        return () => {
            document.body.style.overflow =
                previousOverflow

            window.removeEventListener(
                'keydown',
                closeMenus,
            )

            window.removeEventListener(
                'resize',
                closeContextMenu,
            )
        }
    }, [
        contextMenu,
        onClose,
    ])

    useEffect(() => {
        if (!notice) {
            return undefined
        }

        const timeout =
            window.setTimeout(
                () => setNotice(''),
                1800,
            )

        return () =>
            window.clearTimeout(timeout)
    }, [notice])

    function saveRecentToken(token) {
        if (!normalizedSearch) {
            return
        }

        const stored =
            sanitizeStoredToken(token)
        if (!stored) return

        const next = [
            stored,
            ...recentTokens.filter(
                (item) =>
                    getTokenKey(item) !==
                    getTokenKey(stored),
            ),
        ].slice(0, recentLimit)

        setRecentTokens(next)
        writeRecentTokens(chainId, next)
    }

    function handleSelect(token) {
        if (!confirmRiskyTokenSelection(token, 'use this token')) return
        saveRecentToken(token)
        onSelect(token)
    }

    function clearRecentTokens() {
        setRecentTokens([])

        try {
            const key = getRecentStorageKey(chainId)
            if (key) window.localStorage.removeItem(key)
        } catch {
            // Storage may be unavailable.
        }
    }

    function openContextMenu(
        event,
        token,
    ) {
        event.preventDefault()
        event.stopPropagation()

        const menuWidth = 210
        const menuHeight = 104
        const margin = 12

        const x = Math.min(
            event.clientX,
            window.innerWidth -
            menuWidth -
            margin,
        )

        const y = Math.min(
            event.clientY,
            window.innerHeight -
            menuHeight -
            margin,
        )

        setContextMenu({
            token,
            x: Math.max(margin, x),
            y: Math.max(margin, y),
        })
    }

    async function handleCopyAddress() {
        const address =
            String(
                contextMenu?.token?.address ??
                '',
            ).trim()

        if (
            !/^0x[a-fA-F0-9]{40}$/.test(
                address,
            )
        ) {
            setNotice(
                'This token has no contract address.',
            )

            setContextMenu(null)
            return
        }

        try {
            await copyText(address)
            setNotice('Address copied')
        } catch {
            setNotice(
                'Could not copy address',
            )
        }

        setContextMenu(null)
    }

    async function handleTokenDetails() {
        const token =
            contextMenu?.token

        if (!token || detailsLoading) {
            return
        }

        setDetailsLoading(true)

        const popup =
            window.open(
                'about:blank',
                '_blank',
            )

        if (popup) {
            popup.opener = null
        }

        try {
            const url =
                await getCoinGeckoTokenUrl(
                    token,
                )

            if (popup) {
                popup.location.replace(url)
            } else {
                window.open(
                    url,
                    '_blank',
                    'noopener,noreferrer',
                )
            }
        } catch (detailsError) {
            popup?.close()

            setNotice(
                detailsError instanceof Error
                    ? detailsError.message
                    : 'Token details are unavailable.',
            )
        } finally {
            setDetailsLoading(false)
            setContextMenu(null)
        }
    }

    function groupByChain(items) {
        const groups = new Map()
        for (const token of items) {
            const key = Number(token.chainId)
            const group = groups.get(key) ?? []
            group.push(token)
            groups.set(key, group)
        }
        return [...groups.entries()]
    }

    function renderTokenRows(items) {
        return items.map((token) => (
            <TokenRow
                key={getTokenKey(token)}
                token={token}
                currentToken={currentToken}
                oppositeToken={oppositeToken}
                onSelect={handleSelect}
                onContextMenu={openContextMenu}
            />
        ))
    }

    function renderSearchResults() {
        if (loading) {
            return <TokenSkeletonList />
        }

        if (error) {
            return (
                <div className="ps-token-message">
                    {error}
                </div>
            )
        }

        if (searchResultTokens.length === 0) {
            return (
                <div className="ps-token-message">
                    No matching tokens
                </div>
            )
        }

        if (chainScope !== 'all') return renderTokenRows(searchResultTokens)
        return groupByChain(searchResultTokens).map(([resultChainId, resultTokens]) => (
            <section className="ps-token-section" key={resultChainId}>
                <SectionTitle>
                    {getCuratedEvmChain(resultChainId)?.name ?? `Chain ${resultChainId}`}
                </SectionTitle>
                {renderTokenRows(resultTokens)}
            </section>
        ))
    }

    return (
        <motion.div
            className="ps-token-selector-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={onClose}
        >
            <motion.section
                role="dialog"
                aria-modal="true"
                aria-label={`Select a token for ${side}`}
                className="ps-token-selector-dialog"
                initial={{
                    opacity: 0,
                    scale:
                        reducedMotion
                            ? 1
                            : motionConfig.scale,
                    y:
                        reducedMotion
                            ? 0
                            : motionConfig.offsetY,
                }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                }}
                exit={{
                    opacity: 0,
                    scale:
                        reducedMotion
                            ? 1
                            : motionConfig.scale,
                    y:
                        reducedMotion
                            ? 0
                            : motionConfig.offsetY,
                }}
                transition={{
                    type: 'spring',
                    stiffness:
                    motionConfig.stiffness,
                    damping:
                    motionConfig.damping,
                }}
                onPointerDown={(event) =>
                    event.stopPropagation()
                }
            >
                <header className="ps-token-selector-header">
                    <h2>Select a token</h2>

                    <button
                        type="button"
                        className="ps-token-selector-close"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        <CloseIcon />
                    </button>
                </header>

                <div className="ps-token-search-wrapper">
                    <div className="ps-token-search">
                        <SearchIcon />

                        <input
                            autoFocus
                            aria-label="Search tokens"
                            value={search}
                            onChange={(event) =>
                                onSearchChange(
                                    event.target.value,
                                )
                            }
                            placeholder="Search tokens"
                            autoComplete="off"
                            spellCheck="false"
                        />

                        <ChainSelector
                            chainId={chainScope}
                            onChange={(value) => {
                                if (!onChainChange) return
                                onSearchChange('')
                                onChainChange(value === 'all' ? 'all' : Number(value))
                            }}
                        />
                    </div>
                    <p className="ps-chain-unavailable-note" role="note">
                        Polygon zkEVM is temporarily unavailable for token discovery.
                    </p>
                </div>

                <div
                    className="ps-token-selector-scroll"
                    onScroll={() =>
                        setContextMenu(null)
                    }
                >
                    {normalizedSearch ? (
                        renderSearchResults()
                    ) : (
                        <>
                            {featuredTokenGroups.map(([featuredChainId, featuredTokens]) =>
                                featuredTokens.length > 0 && (
                                <section
                                    className="ps-featured-token-group"
                                    key={featuredChainId}
                                >
                                    {chainScope === 'all' && (
                                        <SectionTitle>
                                            Featured on {getCuratedEvmChain(featuredChainId)?.name ??
                                                `Chain ${featuredChainId}`}
                                        </SectionTitle>
                                    )}
                                    <div className="ps-featured-token-list">
                                        {featuredTokens.map(
                                        (token) => (
                                            <button
                                                key={getTokenKey(
                                                    token,
                                                )}
                                                type="button"
                                                className="ps-featured-token"
                                                onClick={() =>
                                                    handleSelect(token)
                                                }
                                                onContextMenu={(
                                                    event,
                                                ) =>
                                                    openContextMenu(
                                                        event,
                                                        token,
                                                    )
                                                }
                                            >
                                                <TokenIcon
                                                    token={token}
                                                    size="featured"
                                                />

                                                <span>
                          {token.symbol}
                        </span>
                                            </button>
                                        ),
                                        )}
                                    </div>
                                </section>
                            ))}

                            {primaryWalletTokens.length >
                                0 && (
                                    <section className="ps-token-section">
                                        <SectionTitle
                                            icon={<WalletIcon />}
                                        >
                                            Your tokens
                                        </SectionTitle>

                                        {primaryWalletTokens.map(
                                            (token) => (
                                                <TokenRow
                                                    key={getTokenKey(
                                                        token,
                                                    )}
                                                    token={token}
                                                    currentToken={
                                                        currentToken
                                                    }
                                                    oppositeToken={
                                                        oppositeToken
                                                    }
                                                    showBalance
                                                    onSelect={
                                                        handleSelect
                                                    }
                                                    onContextMenu={
                                                        openContextMenu
                                                    }
                                                />
                                            ),
                                        )}
                                    </section>
                                )}

                            {hideUnknownTokens && selectedHiddenTokens.length > 0 && (
                                <section className="ps-token-section">
                                    <SectionTitle icon={<WalletIcon />}>
                                        Selected token
                                    </SectionTitle>
                                    {selectedHiddenTokens.map((token) => (
                                        <TokenRow
                                            key={getTokenKey(token)}
                                            token={token}
                                            currentToken={currentToken}
                                            oppositeToken={oppositeToken}
                                            showBalance
                                            onSelect={handleSelect}
                                            onContextMenu={openContextMenu}
                                        />
                                    ))}
                                </section>
                            )}

                            {!hideUnknownTokens && unverifiedWalletTokens.length > 0 && (
                                <section className="ps-token-section">
                                    <SectionTitle
                                        icon={<WalletIcon />}
                                        action={
                                            <button
                                                type="button"
                                                className="ps-token-section-action"
                                                aria-expanded={showUnverifiedTokens}
                                                onClick={toggleUnverifiedTokens}
                                            >
                                                {showUnverifiedTokens ? 'Hide' : 'Show'}
                                            </button>
                                        }
                                    >
                                        Unverified tokens ({unverifiedWalletTokens.length})
                                    </SectionTitle>

                                    {showUnverifiedTokens && (
                                        <>
                                            <p className="ps-hidden-token-explanation">
                                                These tokens are not recognized by trusted asset sources.
                                            </p>
                                            {unverifiedWalletTokens.map((token) => (
                                                <TokenRow
                                                    key={getTokenKey(token)}
                                                    token={token}
                                                    currentToken={currentToken}
                                                    oppositeToken={oppositeToken}
                                                    showBalance
                                                    onSelect={handleSelect}
                                                    onContextMenu={openContextMenu}
                                                />
                                            ))}
                                        </>
                                    )}
                                </section>
                            )}

                            {!hideUnknownTokens && riskyWalletTokens.length > 0 && (
                                <section className="ps-token-section">
                                    <SectionTitle
                                        icon={<WalletIcon />}
                                        action={
                                            <button
                                                type="button"
                                                className="ps-token-section-action"
                                                aria-expanded={showHiddenTokens}
                                                onClick={toggleHiddenTokens}
                                            >
                                                {showHiddenTokens ? 'Hide' : 'Show'}
                                            </button>
                                        }
                                    >
                                        Hidden risky tokens ({riskyWalletTokens.length})
                                    </SectionTitle>

                                    {showHiddenTokens && (
                                        <>
                                            <p className="ps-hidden-token-explanation">
                                                These tokens have spam or severe security warnings. Interacting may result in loss.
                                            </p>
                                            {riskyWalletTokens.map((token) => (
                                                <TokenRow
                                                    key={getTokenKey(token)}
                                                    token={token}
                                                    currentToken={currentToken}
                                                    oppositeToken={oppositeToken}
                                                    showBalance
                                                    onSelect={handleSelect}
                                                    onContextMenu={openContextMenu}
                                                />
                                            ))}
                                        </>
                                    )}
                                </section>
                            )}

                            {visibleRecentTokens.length > 0 && (
                                <section className="ps-token-section">
                                    <SectionTitle
                                        icon={<ClockIcon />}
                                        action={
                                            <button
                                                type="button"
                                                className="ps-token-section-action"
                                                onClick={
                                                    clearRecentTokens
                                                }
                                            >
                                                Clear
                                            </button>
                                        }
                                    >
                                        Recent searches
                                    </SectionTitle>

                                    {visibleRecentTokens.map(
                                        (token) => (
                                            <TokenRow
                                                key={getTokenKey(
                                                    token,
                                                )}
                                                token={token}
                                                currentToken={
                                                    currentToken
                                                }
                                                oppositeToken={
                                                    oppositeToken
                                                }
                                                onSelect={
                                                    handleSelect
                                                }
                                                onContextMenu={
                                                    openContextMenu
                                                }
                                            />
                                        ),
                                    )}
                                </section>
                            )}

                            <section className="ps-token-section">
                                <SectionTitle
                                    icon={<TrendingIcon />}
                                >
                                    Tokens by 24H volume
                                </SectionTitle>

                                {loading &&
                                safeMarketTokens.length === 0 ? (
                                    <TokenSkeletonList />
                                ) : error ? (
                                    <div className="ps-token-message">
                                        {error}
                                    </div>
                                ) : chainScope === 'all' ? (
                                    groupByChain(safeMarketTokens).map(
                                        ([volumeChainId, volumeTokens]) => (
                                            <div key={volumeChainId}>
                                                <SectionTitle>
                                                    {getCuratedEvmChain(volumeChainId)?.name ??
                                                        `Chain ${volumeChainId}`}
                                                </SectionTitle>
                                                {renderTokenRows(volumeTokens)}
                                            </div>
                                        ),
                                    )
                                ) : (
                                    renderTokenRows(safeMarketTokens)
                                )}
                            </section>
                        </>
                    )}
                </div>
            </motion.section>

            {contextMenu && (
                <motion.div
                    role="menu"
                    className="ps-token-context-menu"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                    }}
                    initial={{
                        opacity: 0,
                        scale: 0.96,
                        y: 4,
                    }}
                    animate={{
                        opacity: 1,
                        scale: 1,
                        y: 0,
                    }}
                    onPointerDown={(event) =>
                        event.stopPropagation()
                    }
                    onContextMenu={(event) =>
                        event.preventDefault()
                    }
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={
                            handleCopyAddress
                        }
                    >
                        <CopyIcon />
                        <span>Copy address</span>
                    </button>

                    <button
                        type="button"
                        role="menuitem"
                        disabled={detailsLoading}
                        onClick={
                            handleTokenDetails
                        }
                    >
                        <InfoIcon />

                        <span>
              {detailsLoading
                  ? 'Opening...'
                  : 'Token details'}
            </span>
                    </button>
                </motion.div>
            )}

            {notice && (
                <motion.div
                    className="ps-token-notice"
                    initial={{
                        opacity: 0,
                        y: 8,
                    }}
                    animate={{
                        opacity: 1,
                        y: 0,
                    }}
                >
                    {notice}
                </motion.div>
            )}
        </motion.div>
    )
}
