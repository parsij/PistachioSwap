import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, ShieldAlert } from 'lucide-react'

import TokenIcon from '../../../tokens/components/TokenIcon.jsx'
import {
    filterPortfolioTokens,
    getAssetIdentity,
    partitionPortfolioAssets,
    sortWalletAssetsByValue,
} from '../../../tokens/services/portfolio.js'
import {
    formatWalletTokenAmount,
    formatWalletUsdValue,
} from '../../../tokens/services/walletTokens.js'
import {
    getTokenDisplayName,
    getTokenDisplaySymbol,
} from '../../../tokens/services/tokenDisplay.js'
import {
    readWalletTokenSectionExpanded,
    writeWalletTokenSectionExpanded,
} from '../../../tokens/services/walletTokenSections.js'
import {
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from '../../../../web3/curatedEvmChains.js'

function shortContract(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function uniqueTokens(tokens) {
    const unique = new Map()
    for (const token of tokens) {
        const identity = getAssetIdentity(token)
        if (!unique.has(identity)) unique.set(identity, token)
    }
    return [...unique.values()]
}

const REASON_LABELS = {
    'insufficient-sellable-liquidity': 'Low liquidity',
    'insufficient-trusted-liquidity': 'Low liquidity',
    'token-too-new': 'New token',
    'age-unavailable': 'Unverified',
    'unverified-identity': 'Unverified',
    'fallback-metadata': 'Unverified',
    'provider-spam': 'Potential risk',
    'security-caution': 'Potential risk',
    'security-high': 'Potential risk',
    'security-blocked': 'Potential risk',
}

function hiddenReason(token) {
    const reason = Array.isArray(token?.classificationReasons)
        ? token.classificationReasons.find((item) => REASON_LABELS[item])
        : null
    return {
        label: reason ? REASON_LABELS[reason] : 'Potential risk',
        reason: reason ?? token?.classificationReasons?.[0] ?? 'hidden-token',
    }
}

function AssetRow({ token, selected, onSelect }) {
    const chain = getCuratedEvmChain(token.chainId)
    const displayName = getTokenDisplayName(token)
    const displaySymbol = getTokenDisplaySymbol(token)
    const potentialRisk = token.visibility === 'hidden' ||
        token.possibleSpam === true ||
        ['high', 'blocked'].includes(token.securityStatus)
    const unverified = !potentialRisk && token.visibility !== 'primary'
    const reason = potentialRisk ? hiddenReason(token) : null

    async function copyContract(event) {
        if (token.isNative) return
        event.preventDefault()
        await navigator.clipboard?.writeText(token.address)
    }

    const content = (
        <>
            <TokenIcon token={token} size="list" />
            <span className="wallet-asset-identity">
                <strong>{displayName}</strong>
                <span>
                    {displaySymbol}
                    {!token.isNative && token.address
                        ? ` · ${shortContract(token.address)}`
                        : ''}
                </span>
                <span className="wallet-asset-chain">
                    <img
                        src={getCuratedEvmChainLogoUri(token.chainId)}
                        alt=""
                        onError={(event) => event.currentTarget.remove()}
                    />
                    {chain?.name ?? `Chain ${token.chainId}`}
                </span>
                {(potentialRisk || unverified) && (
                    <span className="wallet-asset-risk">
                        <ShieldAlert aria-hidden="true" />
                        {potentialRisk ? reason.label : 'Unverified'}
                    </span>
                )}
                {reason && <span className="wallet-asset-chain">{reason.reason}</span>}
            </span>
            <span className="wallet-asset-values">
                <strong>{formatWalletUsdValue(token)}</strong>
                <span>{formatWalletTokenAmount(token.balance)} {displaySymbol}</span>
            </span>
            {selected && <Check className="wallet-asset-check" aria-label="Selected" />}
        </>
    )

    return onSelect ? (
        <button
            type="button"
            className={selected ? 'wallet-asset-row selected' : 'wallet-asset-row'}
            onClick={() => onSelect(token)}
            onContextMenu={copyContract}
        >
            {content}
        </button>
    ) : (
        <div className="wallet-asset-row" onContextMenu={copyContract}>
            {content}
            {!token.isNative && (
                <button
                    type="button"
                    className="wallet-asset-copy"
                    aria-label={`Copy ${displaySymbol} contract address`}
                    onClick={copyContract}
                >
                    <Copy aria-hidden="true" />
                </button>
            )}
        </div>
    )
}

const EMPTY_TOKENS = []

/**
 * Renders trusted wallet assets and keeps unknown holdings in an explicit,
 * collapsed hidden-token section that never contributes to portfolio totals.
 */
export default function WalletAssetList({
    tokens,
    settings,
    selectedTokens = EMPTY_TOKENS,
    selectedToken = null,
    onSelect = null,
    expandHidden = false,
    storageScope = 'account',
}) {
    const tokenChainIds = new Set(
        tokens
            .map((token) => Number(token?.chainId))
            .filter(Number.isSafeInteger),
    )
    const chainId = tokenChainIds.size > 1
        ? 'all'
        : [...tokenChainIds][0] ?? 56
    const [hiddenExpanded, setHiddenExpanded] = useState(() =>
        settings.hideUnknownTokens
            ? false
            : readWalletTokenSectionExpanded({
                chainId,
                scope: storageScope,
                section: 'risky',
            }),
    )
    const primary = sortWalletAssetsByValue(filterPortfolioTokens(
        tokens,
        {
            ...settings,
            selectedTokens,
        },
    ))
    const hiddenByDefault = uniqueTokens(partitionPortfolioAssets(tokens).hiddenTokens)
    const hiddenVisible = expandHidden || hiddenExpanded

    useEffect(() => {
        if (settings.hideUnknownTokens) {
            setHiddenExpanded(false)
            return
        }
        setHiddenExpanded(readWalletTokenSectionExpanded({
            chainId,
            scope: storageScope,
            section: 'risky',
        }))
    }, [chainId, settings.hideUnknownTokens, storageScope])

    function toggleSection(section, setExpanded) {
        setExpanded((current) => writeWalletTokenSectionExpanded({
            chainId,
            scope: storageScope,
            section,
            expanded: !current,
        }))
    }

    return (
        <div className="wallet-asset-list">
            {primary.map((token) => (
                <AssetRow
                    key={getAssetIdentity(token)}
                    token={token}
                    selected={getAssetIdentity(token) === getAssetIdentity(selectedToken)}
                    onSelect={onSelect}
                />
            ))}

            {primary.length === 0 && hiddenByDefault.length === 0 && (
                <p className="wallet-assets-empty">No wallet assets match these filters.</p>
            )}

            {hiddenByDefault.length > 0 && (
                <section className="wallet-hidden-assets">
                    <button
                        type="button"
                        className="wallet-hidden-toggle"
                        onClick={() => toggleSection('risky', setHiddenExpanded)}
                        aria-expanded={hiddenVisible}
                    >
                        Hidden tokens ({hiddenByDefault.length})
                        <ChevronDown aria-hidden="true" />
                    </button>
                    {hiddenVisible && (
                        <>
                            {hiddenByDefault.map((token) => (
                                <AssetRow
                                    key={getAssetIdentity(token)}
                                    token={token}
                                    selected={getAssetIdentity(token) === getAssetIdentity(selectedToken)}
                                    onSelect={onSelect}
                                />
                            ))}
                        </>
                    )}
                </section>
            )}
        </div>
    )
}
