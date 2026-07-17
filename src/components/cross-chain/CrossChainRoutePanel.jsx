import {
    useEffect,
    useMemo,
    useState,
} from 'react'
import {
    encodeFunctionData,
    erc20Abi,
    parseUnits,
    zeroAddress,
} from 'viem'

import ChainSelector from './ChainSelector.jsx'
import CrossChainRouteCards from './CrossChainRouteCards.jsx'
import {
    createCrossChainRouteRequest,
    formatRouteFee,
    getOrderedEvmSteps,
} from '../../services/crossChainRoutes.js'
import {
    useCrossChainRoutes,
} from '../../hooks/useCrossChainRoutes.js'
import {
    CURATED_EVM_CHAINS,
    DEFAULT_CHAIN_ID,
    getCuratedEvmChain,
    isCuratedEvmChainId,
} from '../../web3/curatedEvmChains.js'
import './crossChain.css'

function nextDestination(sourceChainId) {
    return CURATED_EVM_CHAINS.find((chain) => chain.id !== sourceChainId)?.id
}

export default function CrossChainRoutePanel({
    endpoint,
    account,
    walletChainId,
    onExecuteStep,
    onSignMessage,
}) {
    const initialSource = isCuratedEvmChainId(walletChainId)
        ? Number(walletChainId)
        : DEFAULT_CHAIN_ID
    const [sourceChainId, setSourceChainId] = useState(initialSource)
    const [destinationChainId, setDestinationChainId] = useState(
        nextDestination(initialSource),
    )
    const [sourceToken, setSourceToken] = useState(zeroAddress)
    const [destinationToken, setDestinationToken] = useState(zeroAddress)
    const [amount, setAmount] = useState('')
    const [decimals, setDecimals] = useState('18')
    const [recipient, setRecipient] = useState(account ?? '')
    const [slippageBps, setSlippageBps] = useState('50')
    const [executedSteps, setExecutedSteps] = useState([])
    const [isExecuting, setIsExecuting] = useState(false)
    const [stepError, setStepError] = useState(null)
    const routeContextKey = [
        account,
        sourceChainId,
        destinationChainId,
        sourceToken.toLowerCase(),
        destinationToken.toLowerCase(),
        amount,
        decimals,
        recipient.toLowerCase(),
        slippageBps,
    ].join(':')
    const routeState = useCrossChainRoutes({
        endpoint,
        account,
        contextKey: routeContextKey,
        signMessage: onSignMessage,
    })
    const orderedSteps = useMemo(
        () => getOrderedEvmSteps(routeState.preparedRoute),
        [routeState.preparedRoute],
    )
    const depositStep = useMemo(() => {
        const deposit = routeState.preparedRoute?.deposit
        if (!deposit?.address || !deposit.asset) return null
        const isNative = String(deposit.asset.address).toLowerCase() === zeroAddress
        return {
            id: 'chainflip-deposit',
            index: routeState.preparedRoute.steps.find(
                (step) => step.type === 'deposit',
            )?.index ?? Number.MAX_SAFE_INTEGER,
            type: 'deposit',
            label: 'Send exact Chainflip deposit',
            chainId: Number(deposit.asset.chainId),
            transaction: isNative
                ? {
                      to: deposit.address,
                      value: BigInt(deposit.minimumAmount),
                  }
                : {
                      to: deposit.asset.address,
                      data: encodeFunctionData({
                          abi: erc20Abi,
                          functionName: 'transfer',
                          args: [deposit.address, BigInt(deposit.minimumAmount)],
                      }),
                      value: 0n,
                  },
        }
    }, [routeState.preparedRoute])
    const executionSteps = useMemo(
        () => (depositStep ? [...orderedSteps, depositStep] : orderedSteps)
            .sort((left, right) => left.index - right.index),
        [depositStep, orderedSteps],
    )
    const nextStep = executionSteps[executedSteps.length] ?? null

    useEffect(() => {
        setExecutedSteps([])
        setIsExecuting(false)
        setStepError(null)
    }, [routeState.preparedRoute?.publicRouteId])

    async function findRoutes() {
        try {
            const amountUnits = parseUnits(amount, Number(decimals))
            const request = createCrossChainRouteRequest({
                sourceChainId,
                destinationChainId,
                sourceToken,
                destinationToken,
                amount: amountUnits.toString(),
                account,
                recipient,
                slippageBps: Number(slippageBps),
                sourceDecimals: Number(decimals),
            })
            await routeState.quote(request)
        } catch (caught) {
            setStepError(caught instanceof Error ? caught.message : 'Enter a valid route request.')
        }
    }

    async function executeNextStep() {
        if (!nextStep || !onExecuteStep || isExecuting) return
        setIsExecuting(true)
        setStepError(null)
        try {
            if (nextStep.type !== 'approval') {
                const claimed = await routeState.claimSource()
                if (!claimed) return
            }
            const hash = await onExecuteStep(nextStep)
            setExecutedSteps((current) => [...current, { ...nextStep, hash }])
            if (nextStep.type !== 'approval') {
                await routeState.markSubmitted(hash)
            }
        } catch (caught) {
            setStepError(caught instanceof Error ? caught.message : 'Unable to submit this step.')
        } finally {
            setIsExecuting(false)
        }
    }

    const sourceChain = getCuratedEvmChain(sourceChainId)
    const destinationChain = getCuratedEvmChain(destinationChainId)
    const reviewedSteps = routeState.selectedRoute?.steps ?? []
    const approvalCount = reviewedSteps.filter((step) => step.type === 'approval').length
    const transactionActionCount = reviewedSteps.filter((step) =>
        ['approval', 'source-transaction', 'deposit'].includes(step.type),
    ).length
    const actionCount = transactionActionCount + 1

    if (routeState.selectedRoute) {
        return (
            <section className="cross-chain-panel">
                <button type="button" className="cross-chain-back" onClick={routeState.reset}>
                    ← New route
                </button>
                <h2>{routeState.preparedRoute ? 'Route ready' : 'Review route'}</h2>
                <dl className="cross-chain-review">
                    <div><dt>Provider</dt><dd>{routeState.selectedRoute.provider}</dd></div>
                    <div><dt>Execution model</dt><dd>{routeState.selectedRoute.executionModel}</dd></div>
                    <div><dt>Route</dt><dd>{sourceChain?.name} → {destinationChain?.name}</dd></div>
                    <div><dt>Expected return</dt><dd>{routeState.selectedRoute.outputAmount}</dd></div>
                    <div><dt>Minimum output</dt><dd>{routeState.selectedRoute.minimumOutputAmount}</dd></div>
                    <div><dt>Estimated fees</dt><dd>{formatRouteFee(routeState.selectedRoute.feeAmountUsd)}</dd></div>
                    <div><dt>Estimated time</dt><dd>{routeState.selectedRoute.durationSeconds}s</dd></div>
                    <div><dt>Wallet actions</dt><dd>{actionCount} ({approvalCount} approvals)</dd></div>
                    <div><dt>Public route ID</dt><dd>{routeState.selectedRoute.publicRouteId}</dd></div>
                </dl>
                {routeState.expiryWarning && (
                    <p className="cross-chain-warning" role="alert">{routeState.expiryWarning}</p>
                )}
                {!routeState.preparedRoute && (
                    <p className="cross-chain-warning" role="note">
                        Preparing requires one wallet authentication signature in addition to the listed transaction actions. It does not submit a transaction.
                    </p>
                )}
                {routeState.selectedRoute.warnings.map((warning) => (
                    <p key={warning} className="cross-chain-warning" role="alert">{warning}</p>
                ))}
                {!routeState.preparedRoute && (
                    <button
                        type="button"
                        className="primary-action primary-action-ready"
                        disabled={routeState.phase === 'preparing'}
                        onClick={routeState.prepare}
                    >
                        {routeState.phase === 'preparing' ? 'Preparing…' : 'Prepare route'}
                    </button>
                )}
                {routeState.preparedRoute?.deposit?.address && (
                    <aside className="chainflip-deposit" role="note">
                        <strong>Chainflip deposit required</strong>
                        <dl>
                            <div><dt>Asset</dt><dd>{routeState.preparedRoute.deposit.asset.symbol ?? routeState.preparedRoute.deposit.asset.address}</dd></div>
                            <div><dt>Exact amount</dt><dd>{routeState.preparedRoute.deposit.minimumAmount}</dd></div>
                            <div><dt>Network</dt><dd>{getCuratedEvmChain(routeState.preparedRoute.deposit.asset.chainId)?.name}</dd></div>
                            <div><dt>Address</dt><dd><code>{routeState.preparedRoute.deposit.address}</code></dd></div>
                            <div><dt>Expires</dt><dd>{routeState.preparedRoute.deposit.expiresAt}</dd></div>
                        </dl>
                        <p>Send only this asset and exact amount on the stated network. A wrong asset or network can be permanently lost.</p>
                        <p>Never reuse this one-time deposit address, including after expiry.</p>
                    </aside>
                )}
                {routeState.preparedRoute && (
                    <ol className="cross-chain-steps">
                        {executionSteps.map((step, index) => (
                            <li key={step.id} className={index < executedSteps.length ? 'complete' : ''}>
                                <span>{index + 1}</span>
                                <div>
                                    <strong>{step.label}</strong>
                                    <small>{getCuratedEvmChain(step.chainId)?.name}</small>
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
                {nextStep && (
                    <button
                        type="button"
                        className="primary-action primary-action-ready"
                        disabled={isExecuting}
                        onClick={executeNextStep}
                    >
                        {isExecuting ? 'Waiting for wallet…' : `Execute step ${executedSteps.length + 1}`}
                    </button>
                )}
                {executionSteps.length > 0 && !nextStep && (
                    <p className="cross-chain-success" role="status">All wallet steps submitted.</p>
                )}
                {routeState.routeStatus?.status && (
                    <p className="cross-chain-status" role="status">
                        Route status: {routeState.routeStatus.status}
                    </p>
                )}
                {routeState.statusUnavailable && (
                    <p className="cross-chain-warning" role="status">
                        Status is temporarily unavailable. Last known route status is shown.
                    </p>
                )}
                {(routeState.error || stepError) && (
                    <p className="cross-chain-error" role="alert">{routeState.error || stepError}</p>
                )}
            </section>
        )
    }

    return (
        <section className="cross-chain-panel">
            <h2>Cross-chain route</h2>
            <div className="cross-chain-selectors">
                <ChainSelector
                    label="From chain"
                    value={sourceChainId}
                    excludeChainId={destinationChainId}
                    onChange={(chainId) => {
                        setSourceChainId(chainId)
                        if (chainId === destinationChainId) {
                            setDestinationChainId(nextDestination(chainId))
                        }
                    }}
                />
                <ChainSelector
                    label="To chain"
                    value={destinationChainId}
                    excludeChainId={sourceChainId}
                    onChange={setDestinationChainId}
                />
            </div>
            <label className="cross-chain-field">
                <span>Source token address</span>
                <input value={sourceToken} onChange={(event) => setSourceToken(event.target.value.trim())} />
            </label>
            <label className="cross-chain-field">
                <span>Destination token address</span>
                <input value={destinationToken} onChange={(event) => setDestinationToken(event.target.value.trim())} />
            </label>
            <label className="cross-chain-field">
                <span>Recipient</span>
                <input value={recipient} onChange={(event) => setRecipient(event.target.value.trim())} />
            </label>
            <div className="cross-chain-amount-fields">
                <label className="cross-chain-field">
                    <span>Amount</span>
                    <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </label>
                <label className="cross-chain-field cross-chain-decimals">
                    <span>Decimals</span>
                    <input inputMode="numeric" value={decimals} onChange={(event) => setDecimals(event.target.value)} />
                </label>
                <label className="cross-chain-field cross-chain-decimals">
                    <span>Slippage (bps)</span>
                    <input inputMode="numeric" value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} />
                </label>
            </div>
            <button
                type="button"
                className="primary-action primary-action-ready"
                disabled={!account || routeState.phase === 'quoting'}
                onClick={findRoutes}
            >
                {!account ? 'Connect wallet' : routeState.phase === 'quoting' ? 'Finding routes…' : 'Find routes'}
            </button>
            {routeState.phase === 'quoted' && (
                <CrossChainRouteCards
                    routes={routeState.routes}
                    sort={routeState.sort}
                    onSortChange={routeState.setSort}
                    onSelect={routeState.selectRoute}
                    recommendedRouteId={routeState.recommendedRouteId}
                />
            )}
            {(routeState.error || stepError) && (
                <p className="cross-chain-error" role="alert">{routeState.error || stepError}</p>
            )}
            {routeState.persistedRouteId && (
                <p className="cross-chain-status" role="status">
                    Restored route: {routeState.persistedRouteId}
                    {routeState.routeStatus?.status ? ` · ${routeState.routeStatus.status}` : ''}
                </p>
            )}
            {routeState.persistedRouteId && routeState.statusUnavailable && (
                <p className="cross-chain-warning" role="status">
                    Status is temporarily unavailable. The route ID remains saved for a later check.
                </p>
            )}
        </section>
    )
}
