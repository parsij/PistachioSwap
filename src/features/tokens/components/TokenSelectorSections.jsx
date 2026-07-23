import { TokenSkeletonList, SectionTitle, TokenRow } from './TokenSelectorPrimitives.jsx'
import { ClockIcon, TrendingIcon, WalletIcon } from './TokenSelectorIcons.jsx'
import { getTokenKey } from '../model/tokenSelectorState.js'

/**
 * Renders search loading, error, empty, and result states.
 * @param {object} props Controlled result inputs.
 * @param {boolean} props.loading Shows the existing skeleton only when no local result exists.
 * @param {string|null} props.error Visible catalog/search error.
 * @param {Array<object>} props.tokens Filtered canonical token records.
 * @param {(token: object) => void} props.onSelect Receives the clicked token.
 * @param {(event: MouseEvent, token: object) => void} props.onContextMenu Receives row context-menu events.
 * @returns {import('react').ReactElement|Array<import('react').ReactElement>} Existing result markup.
 */
export function TokenSearchResults({ loading, error, tokens, onSelect, onContextMenu, currentToken, oppositeToken }) {
    if (loading && tokens.length === 0) return <TokenSkeletonList />
    if (error && tokens.length === 0) return <div className="ps-token-message">{error}</div>
    if (tokens.length === 0) return <div className="ps-token-message">No matching tokens</div>
    return <>
        {loading && <div className="ps-token-inline-status" role="status">Searching more tokens…</div>}
        {tokens.map((token) => <TokenRow key={getTokenKey(token)} token={token} currentToken={currentToken} oppositeToken={oppositeToken} onSelect={onSelect} onContextMenu={onContextMenu} />)}
    </>
}

/**
 * Renders recent, wallet, market, and common sections.
 * @param {object} props Section view model and selection identity.
 * @param {object} props.state Output of `useTokenSelectorState`.
 * @param {boolean} props.loading Controls the market skeleton branch.
 * @param {object|null} props.currentToken Current selected token.
 * @param {object|null} props.oppositeToken Opposite selected token.
 * @param {boolean} props.hideUnknownTokens Controls risky/unverified visibility.
 * @returns {import('react').ReactElement} Existing section markup with no network side effects.
 */
export function TokenSelectorSections({ state, loading, currentToken, oppositeToken, hideUnknownTokens }) {
    const row = (token, showBalance = false) => <TokenRow key={stateKey(token)} token={token} currentToken={currentToken} oppositeToken={oppositeToken} showBalance={showBalance} onSelect={state.handleSelect} onContextMenu={state.openContextMenu} />
    return <>
        {state.primaryWalletTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<WalletIcon />}>Your tokens</SectionTitle>{state.primaryWalletTokens.map((token) => row(token, true))}</section>}
        {hideUnknownTokens && state.selectedHiddenTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<WalletIcon />}>Selected token</SectionTitle>{state.selectedHiddenTokens.map((token) => row(token, true))}</section>}
        {!hideUnknownTokens && state.unverifiedWalletTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<WalletIcon />} action={<button type="button" className="ps-token-section-action" aria-expanded={state.showUnverifiedTokens} onClick={state.toggleUnverifiedTokens}>{state.showUnverifiedTokens ? 'Hide' : 'Show'}</button>}>Unverified tokens ({state.unverifiedWalletTokens.length})</SectionTitle>{state.showUnverifiedTokens && <><p className="ps-hidden-token-explanation">These tokens are not recognized by trusted asset sources.</p>{state.unverifiedWalletTokens.map((token) => row(token, true))}</>}</section>}
        {!hideUnknownTokens && state.riskyWalletTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<WalletIcon />} action={<button type="button" className="ps-token-section-action" aria-expanded={state.showHiddenTokens} onClick={state.toggleHiddenTokens}>{state.showHiddenTokens ? 'Hide' : 'Show'}</button>}>Hidden risky tokens ({state.riskyWalletTokens.length})</SectionTitle>{state.showHiddenTokens && <><p className="ps-hidden-token-explanation">These tokens have spam or severe security warnings. Interacting may result in loss.</p>{state.riskyWalletTokens.map((token) => row(token, true))}</>}</section>}
        {state.visibleRecentTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<ClockIcon />} action={<button type="button" className="ps-token-section-action" onClick={state.clearRecentTokens}>Clear</button>}>Recent searches</SectionTitle>{state.visibleRecentTokens.map((token) => row(token))}</section>}
        <section className="ps-token-section"><SectionTitle icon={<TrendingIcon />}>Tokens by 24H volume</SectionTitle>{state.marketStatusMessage && <div className="ps-token-inline-status" role="status">{state.marketStatusMessage}</div>}{loading && state.sortedGlobalMarketTokens.length === 0 ? <TokenSkeletonList /> : state.sortedGlobalMarketTokens.map((token) => row(token))}</section>
        {state.commonMarketTokens.length > 0 && <section className="ps-token-section"><SectionTitle>Common tokens</SectionTitle>{state.commonMarketTokens.map((token) => row(token))}</section>}
    </>
}

function stateKey(token) {
    return getTokenKey(token)
}
