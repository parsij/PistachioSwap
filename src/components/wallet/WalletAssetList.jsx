import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, ShieldAlert } from 'lucide-react'

import TokenIcon from '../TokenIcon.jsx'
import {
    filterPortfolioTokens,
    getAssetIdentity,
    getHiddenPortfolioTokens,
    getUnverifiedPortfolioTokens,
    sortWalletAssetsByValue,
} from '../../services/portfolio.js'
import {
    formatWalletTokenAmount,
    formatWalletUsdValue,
} from '../../services/walletTokens.js'
import {
    readWalletTokenSectionExpanded,
    writeWalletTokenSectionExpanded,
} from '../../services/walletTokenSections.js'
import {
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from '../../web3/curatedEvmChains.js'

function shortContract(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function AssetRow({ token, selected, onSelect }) {
    const chain = getCuratedEvmChain(token.chainId)
    async function copyContract(event) {
        if (token.isNative) return
        event.preventDefault()
        await navigator.clipboard?.writeText(token.address)
    }

    const content = (
        <>
            <TokenIcon token={token} size="list" />
            <span className="wallet-asset-identity">
                <strong>{token.name}</strong>
                <span>
                    {token.symbol}
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
                {(
                    token.visibility === 'hidden' ||
                    token.possibleSpam === true ||
                    ['high', 'blocked'].includes(token.securityStatus)
                ) && (
                    <span className="wallet-asset-risk">
                        <ShieldAlert aria-hidden="true" /> Potential risk
                    </span>
                )}
            </span>
            <span className="wallet-asset-values">
                <strong>{formatWalletUsdValue(token)}</strong>
                <span>{formatWalletTokenAmount(token.balance)} {token.symbol}</span>
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
                    aria-label={`Copy ${token.symbol} contract address`}
                    onClick={copyContract}
                >
                    <Copy aria-hidden="true" />
                </button>
            )}
        </div>
    )
}

const EMPTY_TOKENS = []

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
    const [unverifiedExpanded, setUnverifiedExpanded] = useState(() =>
        readWalletTokenSectionExpanded({
            chainId,
            scope: storageScope,
            section: 'unverified',
        }),
    )
    const [hiddenExpanded, setHiddenExpanded] = useState(() =>
        readWalletTokenSectionExpanded({
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
    const hidden = sortWalletAssetsByValue(getHiddenPortfolioTokens(
        tokens,
        { ...settings, selectedTokens },
    ))
    const unverified = sortWalletAssetsByValue(getUnverifiedPortfolioTokens(
        tokens,
        { ...settings, selectedTokens },
    ))
    const hiddenVisible = expandHidden || hiddenExpanded
    const unverifiedVisible = expandHidden || unverifiedExpanded

    useEffect(() => {
        setUnverifiedExpanded(readWalletTokenSectionExpanded({
            chainId,
            scope: storageScope,
            section: 'unverified',
        }))
        setHiddenExpanded(readWalletTokenSectionExpanded({
            chainId,
            scope: storageScope,
            section: 'risky',
        }))
    }, [chainId, storageScope])

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
            {primary.length === 0 && unverified.length === 0 && hidden.length === 0 && (
                <p className="wallet-assets-empty">No wallet assets match these filters.</p>
            )}
            {!settings.hideUnknownTokens && unverified.length > 0 && (
                <section className="wallet-hidden-assets">
                    <button
                        type="button"
                        className="wallet-hidden-toggle"
                        onClick={() => toggleSection('unverified', setUnverifiedExpanded)}
                        aria-expanded={unverifiedVisible}
                    >
                        Unverified tokens ({unverified.length})
                        <ChevronDown aria-hidden="true" />
                    </button>
                    {unverifiedVisible && (
                        <>
                            <p className="wallet-hidden-note">
                                These tokens are not recognized by trusted asset sources.
                            </p>
                            {unverified.map((token) => (
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
            {!settings.hideUnknownTokens && hidden.length > 0 && (
                <section className="wallet-hidden-assets">
                    <button
                        type="button"
                        className="wallet-hidden-toggle"
                        onClick={() => toggleSection('risky', setHiddenExpanded)}
                        aria-expanded={hiddenVisible}
                    >
                        Hidden risky tokens ({hidden.length})
                        <ChevronDown aria-hidden="true" />
                    </button>
                    {hiddenVisible && (
                        <>
                            <p className="wallet-hidden-note">
                                These tokens have spam or severe security warnings. Interacting may result in loss.
                            </p>
                            {hidden.map((token) => (
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
