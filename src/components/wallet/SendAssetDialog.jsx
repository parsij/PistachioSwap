import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    ArrowLeft,
    ClipboardPaste,
    Search,
    X,
} from 'lucide-react'
import {
    formatEther,
    formatUnits,
    isAddress,
} from 'viem'
import {
    usePublicClient,
    useSendTransaction,
    useWriteContract,
} from 'wagmi'

import TokenIcon from '../TokenIcon.jsx'
import TransactionStatusDialog from './TransactionStatusDialog.jsx'
import WalletAssetList from './WalletAssetList.jsx'
import {
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    getSpendableTokenAmount,
    getTokenBalanceWei,
    isNativeBnbToken,
} from '../../services/balances.js'
import { formatUsdAmount } from '../../services/fiatValue.js'
import {
    filterPortfolioTokens,
    isPositiveWalletBalance,
    sortWalletAssetsByValue,
} from '../../services/portfolio.js'
import {
    createTransferPlan,
    isTransferRejectedError,
} from '../../services/transfers.js'
import { formatWalletTokenAmount } from '../../services/walletTokens.js'
import { shortenAddress } from '../../services/address.js'
import {
    confirmRiskyTokenSelection,
    tokenRequiresRiskConfirmation,
} from '../../services/tokenRisk.js'

function matchesExactContract(token, search) {
    return /^0x[a-fA-F0-9]{40}$/.test(search) &&
        String(token.address).toLowerCase() === search.toLowerCase()
}

export default function SendAssetDialog({
    open,
    onOpenChange,
    address,
    chainId,
    assets,
    settings,
    nativeBalanceWei,
    explorerUrl,
    onConfirmed,
}) {
    const publicClient = usePublicClient({ chainId: 56 })
    const { mutateAsync: sendTransactionAsync } = useSendTransaction()
    const { mutateAsync: writeContractAsync } = useWriteContract()
    const [selectedToken, setSelectedToken] = useState(null)
    const [showSelector, setShowSelector] = useState(false)
    const [showAllAssets, setShowAllAssets] = useState(false)
    const [search, setSearch] = useState('')
    const [amount, setAmount] = useState('')
    const [recipient, setRecipient] = useState('')
    const [error, setError] = useState(null)
    const [mode, setMode] = useState('edit')
    const [status, setStatus] = useState('idle')
    const [review, setReview] = useState(null)
    const [hash, setHash] = useState(null)
    const defaultSelectedToken = sortWalletAssetsByValue(filterPortfolioTokens(
        assets,
        settings,
    ))[0] ?? null
    const activeSelectedToken = selectedToken ?? defaultSelectedToken
    const reviewedAccountChanged = Boolean(
        review?.account &&
        review.account.toLowerCase() !== String(address).toLowerCase(),
    )
    const currentMode = reviewedAccountChanged ? 'edit' : mode
    const displayError = reviewedAccountChanged
        ? 'The connected account changed. Review the send again.'
        : error

    const exactAddressSearch = /^0x[a-fA-F0-9]{40}$/.test(search.trim())
    const revealHiddenAssets = !settings.hideUnknownTokens ||
        showAllAssets || exactAddressSearch
    const filteredAssets = (() => {
        const held = assets.filter(isPositiveWalletBalance)
        const exact = held.filter((token) => matchesExactContract(token, search.trim()))
        if (exact.length > 0) return exact
        const base = revealHiddenAssets
            ? held
            : filterPortfolioTokens(held, {
                ...settings,
                selectedTokens: [activeSelectedToken],
            })
        const normalizedSearch = search.trim().toLowerCase()
        return sortWalletAssetsByValue(base.filter((token) =>
            !normalizedSearch ||
            token.name?.toLowerCase().includes(normalizedSearch) ||
            token.symbol?.toLowerCase().includes(normalizedSearch),
        ))
    })()

    function updateAmount(event) {
        const value = event.target.value
        if (/^\d*(?:\.\d*)?$/.test(value)) {
            setAmount(value)
            setError(null)
        }
    }

    function useMax() {
        if (!activeSelectedToken) return
        setAmount(getSpendableTokenAmount({
            token: activeSelectedToken,
            nativeBalanceWei,
            estimatedFeeWei: review?.feeWei ?? null,
            fallbackReserveWei: DEFAULT_NATIVE_GAS_RESERVE_WEI,
        }))
    }

    async function pasteRecipient() {
        const value = await navigator.clipboard.readText()
        setRecipient(value.trim())
        setError(null)
    }

    async function buildReview() {
        setError(null)
        if (!activeSelectedToken) return setError('Select a token.')
        if (
            tokenRequiresRiskConfirmation(activeSelectedToken) &&
            !confirmRiskyTokenSelection(activeSelectedToken, 'review this send')
        ) return
        if (!publicClient) return setError('BNB Smart Chain is unavailable.')
        try {
            const initialPlan = createTransferPlan({
                account: address,
                chainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei,
                estimatedFeeWei: 0n,
            })
            const gasPrice = await publicClient.getGasPrice()
            let gas
            if (initialPlan.kind === 'native') {
                gas = await publicClient.estimateGas(initialPlan.request)
            } else {
                await publicClient.simulateContract(initialPlan.request)
                gas = await publicClient.estimateContractGas(initialPlan.request)
            }
            const feeWei = gas * gasPrice
            const plan = createTransferPlan({
                account: address,
                chainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei,
                estimatedFeeWei: feeWei,
            })
            setReview({
                account: address,
                token: activeSelectedToken,
                amount,
                recipient,
                feeWei,
                gas,
                gasPrice,
                plan,
            })
            setMode('review')
            setStatus('review')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Unable to review this send.')
        }
    }

    async function confirmSend() {
        if (!review || status === 'confirming' || status === 'sending') return
        if (review.account.toLowerCase() !== String(address).toLowerCase()) {
            setMode('edit')
            setReview(null)
            setError('The connected account changed. Review the send again.')
            return
        }
        if (Number(chainId) !== 56) {
            setMode('edit')
            setReview(null)
            setStatus('idle')
            setError('The active network changed. Switch to BNB Smart Chain and review again.')
            return
        }
        setError(null)
        setStatus('confirming')
        try {
            let transactionHash
            if (review.plan.kind === 'native') {
                transactionHash = await sendTransactionAsync(review.plan.request)
            } else {
                const simulation = await publicClient.simulateContract(review.plan.request)
                transactionHash = await writeContractAsync(simulation.request)
            }
            setHash(transactionHash)
            setStatus('submitted')
            const receipt = await publicClient.waitForTransactionReceipt({
                hash: transactionHash,
            })
            if (receipt.status !== 'success') throw new Error('Transaction failed on-chain.')
            setStatus('sent')
            await onConfirmed?.()
        } catch (caught) {
            if (isTransferRejectedError(caught)) {
                setStatus('rejected')
                setError('The send was rejected in the wallet.')
            } else {
                setStatus('failed')
                setError(caught instanceof Error ? caught.message : 'The send failed.')
            }
        }
    }

    const tokenBalance = activeSelectedToken
        ? isNativeBnbToken(activeSelectedToken)
            ? formatEther(BigInt(nativeBalanceWei ?? 0))
            : formatUnits(getTokenBalanceWei(activeSelectedToken), Number(activeSelectedToken.decimals))
        : '0'
    const afterBalance = review
        ? formatUnits(
            (isNativeBnbToken(review.token)
                ? BigInt(nativeBalanceWei ?? 0)
                : getTokenBalanceWei(review.token)) - review.plan.amountWei,
            Number(review.token.decimals),
        )
        : null
    const recipientValid = isAddress(recipient)
    const buttonLabel = chainId !== 56 ? 'Switch to BNB Smart Chain' :
        !activeSelectedToken ? 'Select token' :
        !amount || !/[1-9]/.test(amount) ? 'Enter amount' :
        !recipientValid ? 'Enter recipient' :
        currentMode === 'review' ? 'Confirm in wallet' : 'Review send'

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="wallet-dialog-overlay nested" />
                <Dialog.Content className="wallet-dialog wallet-send-dialog">
                    <header className="wallet-dialog-header">
                        <button
                            type="button"
                            className="wallet-icon-button"
                            aria-label="Back"
                            onClick={() => {
                                if (showSelector) setShowSelector(false)
                                else if (currentMode === 'review') setMode('edit')
                                else onOpenChange(false)
                            }}
                        >
                            <ArrowLeft aria-hidden="true" />
                        </button>
                        <Dialog.Title>{showSelector ? 'Select token' : 'Send'}</Dialog.Title>
                        <Dialog.Close className="wallet-icon-button" aria-label="Close send dialog">
                            <X aria-hidden="true" />
                        </Dialog.Close>
                    </header>

                    {showSelector ? (
                        <div className="send-token-selector">
                            <label className="send-search-field">
                                <Search aria-hidden="true" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search name or exact address"
                                    aria-label="Search wallet assets"
                                />
                            </label>
                            <button
                                type="button"
                                className="send-show-all"
                                onClick={() => setShowAllAssets((value) => !value)}
                                aria-pressed={showAllAssets}
                            >
                                {showAllAssets ? 'Use portfolio filters' : 'Show all wallet assets'}
                            </button>
                            <WalletAssetList
                                tokens={filteredAssets}
                                settings={{
                                    hideUnknownTokens: !revealHiddenAssets,
                                    hideSmallBalances: false,
                                }}
                                selectedToken={activeSelectedToken}
                                expandHidden={exactAddressSearch}
                                storageScope="send"
                                onSelect={(token) => {
                                    if (!confirmRiskyTokenSelection(token, 'select this token')) return
                                    setSelectedToken(token)
                                    setShowSelector(false)
                                    setAmount('')
                                    setReview(null)
                                }}
                            />
                        </div>
                    ) : (
                        <>
                            {currentMode === 'edit' && (
                                <div className="send-form">
                                    <section className="send-amount-card">
                                        <div className="send-amount-line">
                                            <input
                                                value={amount}
                                                onChange={updateAmount}
                                                inputMode="decimal"
                                                placeholder="0"
                                                aria-label="Amount to send"
                                            />
                                            <button
                                                type="button"
                                                className="send-token-button"
                                                onClick={() => setShowSelector(true)}
                                            >
                                                {activeSelectedToken && <TokenIcon token={activeSelectedToken} size="button" />}
                                                <span>{activeSelectedToken?.symbol ?? 'Select'}</span>
                                            </button>
                                        </div>
                                        <div className="send-balance-line">
                                            <span>{formatUsdAmount(amount || '0', activeSelectedToken?.trustedPriceUSD ?? null)}</span>
                                            <span>
                                                Balance {formatWalletTokenAmount(tokenBalance)}
                                                <button type="button" onClick={useMax}>Max</button>
                                            </span>
                                        </div>
                                    </section>
                                    <section className="send-recipient-card">
                                        <label htmlFor="send-recipient">Send to</label>
                                        <div className="send-recipient-input">
                                            <input
                                                id="send-recipient"
                                                value={recipient}
                                                onChange={(event) => {
                                                    setRecipient(event.target.value.trim())
                                                    setError(null)
                                                }}
                                                placeholder="0x…"
                                                spellCheck="false"
                                            />
                                            <button type="button" onClick={pasteRecipient} aria-label="Paste recipient">
                                                <ClipboardPaste aria-hidden="true" />
                                                Paste
                                            </button>
                                        </div>
                                        {recipientValid && (
                                            <span className="recipient-preview">{shortenAddress(recipient, 6)}</span>
                                        )}
                                    </section>
                                </div>
                            )}

                            {currentMode === 'review' && review && (
                                <section className="send-review">
                                    <h3>Review send</h3>
                                    {tokenRequiresRiskConfirmation(review.token) && (
                                        <p className="send-security-warning">
                                            This token has severe security warnings. Interacting with it may result in loss.
                                        </p>
                                    )}
                                    <dl>
                                        <div><dt>Amount</dt><dd>{review.amount} {review.token.symbol}</dd></div>
                                        <div><dt>USD value</dt><dd>{formatUsdAmount(review.amount, review.token.trustedPriceUSD)}</dd></div>
                                        <div><dt>Recipient</dt><dd>{shortenAddress(review.recipient, 6)}</dd></div>
                                        <div><dt>Estimated network fee</dt><dd>{formatEther(review.feeWei)} BNB</dd></div>
                                        <div><dt>Total native BNB required</dt><dd>{formatEther(
                                            review.feeWei + (isNativeBnbToken(review.token) ? review.plan.amountWei : 0n),
                                        )} BNB</dd></div>
                                        <div><dt>Balance after send</dt><dd>{afterBalance} {review.token.symbol}</dd></div>
                                    </dl>
                                </section>
                            )}

                            <TransactionStatusDialog status={status} hash={hash} explorerUrl={explorerUrl} />
                            {displayError && <p className="send-error" role="alert">{displayError}</p>}
                            {status !== 'sent' && (
                                <button
                                    type="button"
                                    className="wallet-primary-button send-primary-button"
                                    disabled={
                                        chainId !== 56 ||
                                        status === 'confirming' ||
                                        status === 'submitted'
                                    }
                                    onClick={currentMode === 'review' ? confirmSend : buildReview}
                                >
                                    {status === 'confirming' ? 'Confirm in wallet' :
                                        status === 'submitted' ? 'Sending…' : buttonLabel}
                                </button>
                            )}
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
