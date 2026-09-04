import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
    ArrowLeft,
    ClipboardPaste,
    X,
} from 'lucide-react'
import {
    formatEther,
    formatUnits,
    isAddress,
} from 'viem'
import {
    useAppKitNetwork,
    usePublicClient,
    useSendTransaction,
    useWriteContract,
} from '#wallet-runtime'

import TokenIcon from '../../../tokens/components/TokenIcon.jsx'
import TokenSelector from '../../../tokens/components/TokenSelector.jsx'
import TransactionStatusDialog from './TransactionStatusDialog.jsx'
import {
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    getSpendableTokenAmount,
    getTokenBalanceWei,
} from '../../../../services/balances.js'
import { formatUsdAmount } from '../../../../services/fiatValue.js'
import {
    filterPortfolioTokens,
    isPositiveWalletBalance,
    sortWalletAssetsByValue,
} from '../../../tokens/services/portfolio.js'
import {
    createTransferPlan,
    isNativeEvmToken,
    isTransferRejectedError,
} from '../../../../services/transfers.js'
import { formatWalletTokenAmount } from '../../../tokens/services/walletTokens.js'
import { shortenAddress } from '../../../../services/address.js'
import {
    confirmRiskyTokenSelection,
    tokenRequiresRiskConfirmation,
} from '../../../tokens/services/tokenRisk.js'
import {
    getCuratedEvmChain,
    isCuratedEvmChainId,
} from '../../../../web3/curatedEvmChains.js'
import { recordWalletActivity } from '../../services/walletActivity.js'
import { getTokenDisplaySymbol } from '../../../tokens/services/tokenDisplay.js'


/** Renders wallet transfer selection/validation/review and delegates explicit submission to Wagmi. */
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
    const numericWalletChainId = Number(chainId)
    const { chainId: connectedChainId, switchNetwork } = useAppKitNetwork()
    const { mutateAsync: sendTransactionAsync } = useSendTransaction()
    const { mutateAsync: writeContractAsync } = useWriteContract()
    const [selectedToken, setSelectedToken] = useState(null)
    const [showSelector, setShowSelector] = useState(false)
    const [selectorChainId, setSelectorChainId] = useState('all')
    const [search, setSearch] = useState('')
    const [amount, setAmount] = useState('')
    const [recipient, setRecipient] = useState('')
    const [error, setError] = useState(null)
    const [mode, setMode] = useState('edit')
    const [status, setStatus] = useState('idle')
    const [review, setReview] = useState(null)
    const [hash, setHash] = useState(null)
    const heldAssets = assets.filter(isPositiveWalletBalance)
    const defaultSelectedToken = sortWalletAssetsByValue(filterPortfolioTokens(
        heldAssets,
        settings,
    ))[0] ?? null
    const activeSelectedToken = selectedToken ?? defaultSelectedToken
    const numericChainId = Number(activeSelectedToken?.chainId ?? numericWalletChainId)
    const chain = getCuratedEvmChain(numericChainId)
    const nativeSymbol = chain?.nativeCurrency?.symbol ?? 'native token'
    const publicClient = usePublicClient({
        chainId: isCuratedEvmChainId(numericChainId)
            ? numericChainId
            : undefined,
    })
    const selectedNativeAsset = assets.find((token) =>
        Number(token?.chainId) === numericChainId && isNativeEvmToken(token)) ?? null
    const selectedNativeBalanceWei = selectedNativeAsset
        ? getTokenBalanceWei(selectedNativeAsset)
        : numericChainId === numericWalletChainId
            ? BigInt(nativeBalanceWei ?? 0)
            : 0n
    const selectedExplorerUrl = chain?.blockExplorers?.default?.url ?? explorerUrl
    const reviewedAccountChanged = Boolean(
        review?.account &&
        review.account.toLowerCase() !== String(address).toLowerCase(),
    )
    const currentMode = reviewedAccountChanged ? 'edit' : mode
    const displayError = reviewedAccountChanged
        ? 'The connected account changed. Review the send again.'
        : error

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
            nativeBalanceWei: selectedNativeBalanceWei,
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
        if (!chain) return setError('This network is not enabled in PistachioSwap.')
        if (!publicClient) return setError(`${chain.name} is unavailable.`)
        try {
            const initialPlan = createTransferPlan({
                account: address,
                chainId: numericChainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei: selectedNativeBalanceWei,
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
                chainId: numericChainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei: selectedNativeBalanceWei,
                estimatedFeeWei: feeWei,
            })
            setReview({
                account: address,
                chainId: numericChainId,
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
        const targetChain = getCuratedEvmChain(Number(review.chainId))
        if (!targetChain) {
            setError('This network is not enabled in PistachioSwap.')
            return
        }
        setError(null)
        setStatus('confirming')
        let phase = 'switch-network'
        try {
            if (Number(connectedChainId) !== Number(review.chainId)) {
                await switchNetwork(targetChain)
            }
            phase = 'send'
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
            recordWalletActivity({
                walletAddress: review.account,
                chainId: review.chainId,
                type: 'sent',
                hash: transactionHash,
                token: review.token,
                amount: review.amount,
                recipient: review.recipient,
            })
            await onConfirmed?.()
        } catch (caught) {
            if (isTransferRejectedError(caught)) {
                setStatus('rejected')
                setError(phase === 'switch-network'
                    ? `Network switch to ${targetChain.name} was cancelled.`
                    : 'The send was rejected in the wallet.')
            } else {
                setStatus('failed')
                setError(caught instanceof Error ? caught.message : 'The send failed.')
            }
        }
    }

    const tokenBalance = activeSelectedToken
        ? isNativeEvmToken(activeSelectedToken)
            ? formatEther(selectedNativeBalanceWei)
            : formatUnits(getTokenBalanceWei(activeSelectedToken), Number(activeSelectedToken.decimals))
        : '0'
    const afterBalance = review
        ? formatUnits(
            (isNativeEvmToken(review.token)
                ? selectedNativeBalanceWei
                : getTokenBalanceWei(review.token)) - review.plan.amountWei,
            Number(review.token.decimals),
        )
        : null
    const recipientValid = isAddress(recipient)
    const buttonLabel = !chain ? 'Unsupported network' :
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
                        <Dialog.Title>Send</Dialog.Title>
                        <Dialog.Close className="wallet-icon-button" aria-label="Close send dialog">
                            <X aria-hidden="true" />
                        </Dialog.Close>
                    </header>

                    {!showSelector && (
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
                                                <span>{activeSelectedToken ? getTokenDisplaySymbol(activeSelectedToken) : 'Select'}</span>
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
                                        <div><dt>Amount</dt><dd>{review.amount} {getTokenDisplaySymbol(review.token)}</dd></div>
                                        <div><dt>USD value</dt><dd>{formatUsdAmount(review.amount, review.token.trustedPriceUSD)}</dd></div>
                                        {/*
                                          * Shown in full: address-poisoning
                                          * attacks mine a vanity address that
                                          * matches the first and last few
                                          * characters of one the victim used
                                          * before, so a truncated review row is
                                          * exactly what they are built to pass.
                                          */}
                                        <div className="send-review-recipient"><dt>Recipient</dt><dd>{review.recipient}</dd></div>
                                        <div><dt>Network</dt><dd>{chain?.name}</dd></div>
                                        <div><dt>Estimated network fee</dt><dd>{formatEther(review.feeWei)} {nativeSymbol}</dd></div>
                                        <div><dt>Total native {nativeSymbol} required</dt><dd>{formatEther(
                                            review.feeWei + (isNativeEvmToken(review.token) ? review.plan.amountWei : 0n),
                                        )} {nativeSymbol}</dd></div>
                                        <div><dt>Balance after send</dt><dd>{afterBalance} {getTokenDisplaySymbol(review.token)}</dd></div>
                                    </dl>
                                </section>
                            )}

                            <TransactionStatusDialog status={status} hash={hash} explorerUrl={selectedExplorerUrl} />
                            {displayError && <p className="send-error" role="alert">{displayError}</p>}
                            {status !== 'sent' && (
                                <button
                                    type="button"
                                    className="wallet-primary-button send-primary-button"
                                    disabled={
                                        !chain ||
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
                {showSelector && (
                    <TokenSelector
                        side="send"
                        chainId={selectorChainId}
                        tokens={[]}
                        commonTokens={[]}
                        fallbackTokens={[]}
                        walletTokens={heldAssets}
                        search={search}
                        loading={false}
                        error={null}
                        currentToken={null}
                        oppositeToken={null}
                        onSearchChange={setSearch}
                        onSelect={(token) => {
                            setSelectedToken(token)
                            setShowSelector(false)
                            setSelectorChainId('all')
                            setSearch('')
                            setAmount('')
                            setReview(null)
                            setStatus('idle')
                            setError(null)
                        }}
                        onClose={() => {
                            setShowSelector(false)
                            setSelectorChainId('all')
                            setSearch('')
                        }}
                        hideUnknownTokens={false}
                        hideSmallBalances={false}
                        onChainChange={setSelectorChainId}
                        walletOnly
                    />
                )}
            </Dialog.Portal>
        </Dialog.Root>
    )
}
