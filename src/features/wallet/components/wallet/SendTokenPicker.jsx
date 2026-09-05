import { useState } from 'react'
import { motion } from 'motion/react'

import {
    TokenSearchResults,
    TokenSelectorSections,
} from '../../../tokens/components/TokenSelectorSections.jsx'
import { ChainSelector } from '../../../tokens/components/TokenSelectorPrimitives.jsx'
import {
    CloseIcon,
    CopyIcon,
    InfoIcon,
    SearchIcon,
} from '../../../tokens/components/TokenSelectorIcons.jsx'
import { useTokenSelectorState } from '../../../tokens/hooks/useTokenSelectorState.js'
import { sendTokenMatchesSearch } from './sendTokenSearch.js'
import '../../../tokens/components/TokenSelector.css'
import '../../../tokens/components/TokenSelectorPolish.css'
import '../../../tokens/components/TokenIconLoading.css'
import './sendTokenPicker.css'

/**
 * Send-only wallet token picker rendered inside the active Radix Send dialog.
 * Search text and chain selection are local to Send so interacting with either
 * cannot reset the parent Send flow. One-character searches use the already
 * loaded wallet holdings directly instead of the global fuzzy-search minimum.
 */
export default function SendTokenPicker({
    walletTokens = [],
    onSelect,
    onClose,
}) {
    const [selectorChainId, setSelectorChainId] = useState('all')
    const [search, setSearch] = useState('')
    const state = useTokenSelectorState({
        chainId: selectorChainId,
        tokens: [],
        commonTokens: [],
        fallbackTokens: [],
        walletTokens,
        search,
        loading: false,
        error: null,
        onSelect,
        onClose,
        hideUnknownTokens: false,
        hideSmallBalances: false,
    })

    function handleChainChange(value) {
        setSelectorChainId(value === 'all' ? 'all' : Number(value))
    }

    const normalizedSearch = search.trim()
    const searchResultTokens = normalizedSearch.length === 1
        ? state.primaryWalletTokens.filter((token) =>
            sendTokenMatchesSearch(token, normalizedSearch))
        : state.searchResultTokens

    return (
        <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Select a token for send"
            className="send-token-picker-layer"
            data-testid="send-token-picker"
            initial={{ opacity: 0, scale: 0.985, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <header className="send-token-picker-header">
                <h2>Select a token</h2>
                <button
                    type="button"
                    className="send-token-picker-close"
                    aria-label="Close token selector"
                    onClick={onClose}
                >
                    <CloseIcon />
                </button>
            </header>

            <div className="send-token-picker-search-wrap">
                <div className="ps-token-search send-token-picker-search">
                    <SearchIcon />
                    <input
                        autoFocus
                        aria-label="Search tokens"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search tokens"
                        autoComplete="off"
                        spellCheck="false"
                    />
                    <ChainSelector
                        chainId={state.chainScope}
                        onChange={handleChainChange}
                    />
                </div>
            </div>

            <div
                className="send-token-picker-scroll"
                onScroll={() => state.setContextMenu(null)}
            >
                {state.normalizedSearch ? (
                    <TokenSearchResults
                        loading={false}
                        error={null}
                        tokens={searchResultTokens}
                        hiddenTokens={state.selectedHiddenTokens}
                        onSelect={state.handleSelect}
                        onContextMenu={state.openContextMenu}
                        currentToken={null}
                        oppositeToken={null}
                    />
                ) : (
                    <TokenSelectorSections
                        state={state}
                        loading={false}
                        currentToken={null}
                        oppositeToken={null}
                        hideUnknownTokens={false}
                        walletOnly
                    />
                )}
            </div>

            {state.contextMenu && (
                <motion.div
                    role="menu"
                    className="ps-token-context-menu send-token-context-menu"
                    style={{
                        left: state.contextMenu.x,
                        top: state.contextMenu.y,
                    }}
                    initial={{ opacity: 0, scale: 0.96, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={state.handleCopyAddress}
                    >
                        <CopyIcon />
                        <span>Copy address</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        disabled={state.detailsLoading}
                        onClick={state.handleTokenDetails}
                    >
                        <InfoIcon />
                        <span>{state.detailsLoading ? 'Opening...' : 'Token details'}</span>
                    </button>
                </motion.div>
            )}

            {state.notice && (
                <motion.div
                    className="ps-token-notice send-token-notice"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    {state.notice}
                </motion.div>
            )}
        </motion.section>
    )
}
