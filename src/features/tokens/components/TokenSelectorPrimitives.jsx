import { useState } from 'react'
import {
    getTokenDisplayName,
    getTokenDisplaySymbol,
} from '../services/tokenDisplay.js'
import { ShieldAlert } from 'lucide-react'

import TokenIcon, { ChainIcon } from './TokenIcon.jsx'
import { ChevronDownIcon } from './TokenSelectorIcons.jsx'
import { CURATED_EVM_CHAINS, getCuratedEvmChain, TOKEN_DISCOVERY_CHAIN_IDS } from '../../../web3/curatedEvmChains.js'
import { getTokenKey, shortenAddress } from '../model/tokenSelectorState.js'
import { formatWalletTokenAmount, formatWalletUsdValue } from '../services/walletTokens.js'

/**
 * Renders the chain listbox and preserves keyboard/Escape behavior.
 * @param {number|'all'} props.chainId Current scope.
 * @param {(value: string) => void} props.onChange Receives the selected chain ID.
 * @returns {import('react').ReactElement} Accessible chain selector.
 */
export function ChainSelector({ chainId, onChange }) {
    const [open, setOpen] = useState(false)
    const selectedChain = chainId === 'all' ? null : getCuratedEvmChain(chainId)
    const options = [{ id: 'all', name: 'All Chains', active: true }, ...CURATED_EVM_CHAINS.map((chain) => ({
        id: chain.id,
        name: chain.name,
        active: TOKEN_DISCOVERY_CHAIN_IDS.includes(chain.id),
    }))]
    function selectOption(option) {
        if (!option.active) return
        onChange(String(option.id))
        setOpen(false)
    }
    function handleKeyDown(event) {
        if (event.key === 'Escape') setOpen(false)
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((value) => !value)
        }
    }
    return (
        <div className="ps-network-control">
            <button type="button" className="ps-network-trigger" aria-label="Token network" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={handleKeyDown}>
                {selectedChain ? <ChainIcon chainId={selectedChain.id} name={selectedChain.name} /> : <span className="ps-chain-icon ps-chain-icon-all" aria-hidden="true">∞</span>}
                <span>{selectedChain?.name ?? 'All Chains'}</span><ChevronDownIcon />
            </button>
            {open && <div className="ps-network-menu" role="listbox" aria-label="Token network">
                {options.map((option) => <button key={option.id} type="button" role="option" aria-selected={String(option.id) === String(chainId)} aria-disabled={!option.active} disabled={!option.active} onClick={() => selectOption(option)}>
                    {option.id === 'all' ? <span className="ps-chain-icon ps-chain-icon-all" aria-hidden="true">∞</span> : <ChainIcon chainId={option.id} name={option.name} />}
                    <span>{option.name}</span>{!option.active && <small>Unavailable</small>}
                </button>)}
            </div>}
        </div>
    )
}

/** @returns {import('react').ReactElement} Existing eight-row loading skeleton. */
export function TokenSkeletonList() {
    return <div className="ps-token-skeleton-list" aria-label="Loading tokens">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="ps-token-skeleton-row"><span className="ps-skeleton ps-skeleton-circle" /><span className="ps-token-skeleton-text"><span className="ps-skeleton ps-skeleton-name" /><span className="ps-skeleton ps-skeleton-meta" /></span><span className="ps-skeleton ps-skeleton-value" /></div>)}</div>
}

/**
 * Renders a section heading and optional action without owning section state.
 * @param {object} props Heading icon, children, and optional action element.
 * @returns {import('react').ReactElement} Existing heading classes and semantics.
 */
export function SectionTitle({ icon, children, action }) {
    return <div className="ps-token-section-title"><span className="ps-token-section-heading">{icon}{children}</span>{action}</div>
}

/**
 * Renders one selectable token row, including identity, security, balance, and context callbacks.
 * @param {object} props Token and current/opposite identity props.
 * @param {object} props.token Canonical token record.
 * @param {object|null} props.currentToken Current selected token.
 * @param {object|null} props.oppositeToken Opposite selected token.
 * @param {boolean} [props.showBalance=false] Shows USD and quantity values.
 * @param {(token: object) => void} props.onSelect Selection callback.
 * @param {(event: MouseEvent, token: object) => void} props.onContextMenu Context-menu callback.
 * @returns {import('react').ReactElement} Accessible button row with unchanged CSS classes.
 */
export function TokenRow({ token, currentToken, oppositeToken, showBalance = false, onSelect, onContextMenu }) {
    const address = token.isNative ? null : shortenAddress(token.address)
    const displayName = getTokenDisplayName(token)
    const displaySymbol = getTokenDisplaySymbol(token)
    const isCurrent = getTokenKey(token) !== null && getTokenKey(token) === getTokenKey(currentToken)
    const isOpposite = getTokenKey(token) !== null && getTokenKey(token) === getTokenKey(oppositeToken)
    return <button type="button" className={['ps-token-row', isCurrent ? 'ps-token-row-selected' : '', isOpposite ? 'ps-token-row-opposite' : '', token.visibility === 'hidden' ? 'ps-token-row-hidden' : ''].filter(Boolean).join(' ')} aria-current={isCurrent ? 'true' : undefined} onClick={() => onSelect(token)} onContextMenu={(event) => onContextMenu(event, token)}>
        <TokenIcon token={token} size="list" />
        <span className="ps-token-row-details"><strong>{displayName}</strong><span className="ps-token-row-meta"><span className="ps-token-symbol">{displaySymbol}</span>{address && <span className="ps-token-contract" title={token.address}>{address}</span>}{(token.possibleSpam === true || ['high', 'blocked'].includes(token.securityStatus)) && <span className="ps-token-risk-label"><ShieldAlert aria-hidden="true" />Potential risk</span>}</span></span>
        <span className="ps-token-row-value">{showBalance ? <><strong>{formatWalletUsdValue(token)}</strong><span>{formatWalletTokenAmount(token.balance)}</span></> : null}</span>
    </button>
}
