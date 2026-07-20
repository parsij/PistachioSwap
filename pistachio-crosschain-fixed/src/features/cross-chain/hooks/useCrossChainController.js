import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCrossChainRoutes } from './useCrossChainRoutes.js'
import {
    createCrossChainRouteRequest,
    formatTokenAmount,
    getOrderedEvmSteps,
    isCrossChainRouteExpired,
    isExecutableCrossChainRouteForRequest,
} from '../services/crossChainRoutes.js'
import {
    estimatePreparedCrossChainCosts,
    resolveCurrentCrossChainWallet,
    sendPreparedCrossChainTransaction,
    waitForCrossChainApproval,
} from '../services/crossChainExecution.js'
import { getDisplayTokenPrice } from '../../tokens/services/tokenPrices.js'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { isUserRejectedError } from '../../../services/swapTransaction.js'
import { crossChainExecutionMessage, executionErrorSnapshot } from '../../../shared/logging/swapDiagnostics.js'

const IDLE_PREPARATION = {
    status: 'idle',
    gasEstimateUnavailable: false,
    insufficientNativeGas: false,
}

/**
 * Owns cross-chain request/route lifecycle, review preparation, authentication, ordered wallet execution, and visible route state.
 *
 * @param {object} config Cross-chain intent, wallet dependencies, and semantic state callbacks.
 * @returns {object} Current route/quote state, route-list API, and cross-chain review view model/actions.
 * @sideEffects Calls the existing cross-chain backend, may estimate gas through the supplied public client, and on explicit confirmation may switch chains, sign authentication, approve, submit, and mark routes submitted.
 * @throws Wallet/provider errors are converted to current visible cross-chain messages.
 * @security Revalidates selected route identity, chains, assets, amount, account, expiry, and prepared route before wallet operations.
 */
export function useCrossChainController({
    enabledMode,
    routingMode,
    endpoint,
    providerConfigurationVersion,
    account,
    walletState,
    sellToken,
    buyToken,
    sellChainId,
    buyChainId,
    activeAmountSide,
    activeAmountIn,
    activeBuyAmountIn,
    configuredSlippageBps,
    debounceMs,
    buyInputDenomination,
    setBuyAmount,
    setVisibleStatus,
    transactionStatus,
    setTransactionStatus,
    publicClient,
    wagmiConfig,
    switchNetwork,
    nativeBalance,
    nativeToken,
}) {
    const [executionError, setExecutionError] = useState(null)
    const [reviewRoute, setReviewRoute] = useState(null)
    const [reviewPreparation, setReviewPreparation] = useState(IDLE_PREPARATION)
    const reviewRequestRef = useRef(null)
    const refreshingAfterApprovalRef = useRef(false)

    const request = useMemo(() => {
        if (routingMode !== enabledMode || activeAmountSide !== 'sell' || !account || !sellToken || !buyToken ||
            !activeAmountIn || activeAmountIn === '0') return null
        try {
            return createCrossChainRouteRequest({
                sourceChainId: sellChainId,
                destinationChainId: buyChainId,
                sourceToken: sellToken.address,
                destinationToken: buyToken.address,
                amount: activeAmountIn,
                account,
                recipient: account,
                slippageBps: configuredSlippageBps,
                sourceDecimals: Number(sellToken.decimals ?? 18),
                sourceSymbol: sellToken.symbol,
                destinationDecimals: Number(buyToken.decimals ?? 18),
                destinationSymbol: buyToken.symbol,
            })
        } catch {
            return null
        }
    }, [
        account,
        activeAmountIn,
        activeAmountSide,
        buyChainId,
        buyToken,
        configuredSlippageBps,
        enabledMode,
        routingMode,
        sellChainId,
        sellToken,
    ])
    const requestKey = request ? [
        'EXACT_INPUT',
        activeAmountSide,
        request.sourceAsset.chainId,
        request.destinationAsset.chainId,
        request.sourceAsset.address,
        request.destinationAsset.address,
        request.amount,
        request.ownerAddress.toLowerCase(),
        request.recipient.toLowerCase(),
        request.slippageBps,
        'platform-fee',
        providerConfigurationVersion ?? 'v1',
    ].join(':') : null

    const logExecutionPhase = useCallback((phase, metadata = {}, error = null) => {
        if (!import.meta.env.DEV) return
        const suffix = (value, length = 8) => String(value ?? '').slice(-length) || null
        const diagnostic = {
            phase,
            sourceChainId: Number(metadata.sourceChainId ?? reviewRoute?.sourceChainId) || null,
            destinationChainId: Number(metadata.destinationChainId ?? reviewRoute?.destinationChainId) || null,
            connectorId: metadata.connectorId ?? null,
            connectorName: metadata.connectorName ?? null,
            walletClientChainId: Number(metadata.walletClientChainId) || null,
            providerType: metadata.providerType ?? null,
            routeIdSuffix: suffix(metadata.routeId ?? reviewRoute?.publicRouteId),
            transactionTargetSuffix: suffix(metadata.transactionTarget),
        }
        if (error) {
            console.error('[cross-chain-execution-error]', { ...diagnostic, error: executionErrorSnapshot(error) })
            return
        }
        console.debug('[cross-chain-execution]', diagnostic)
    }, [reviewRoute])

    async function authenticate(message) {
        const authenticationRoute = reviewRoute ?? currentRoute
        if (!account || !authenticationRoute) throw new Error('Connect a wallet that supports message signing.')
        const sourceChain = getCuratedEvmChain(authenticationRoute.sourceChainId)
        if (!sourceChain) throw new Error('The source chain is not enabled.')
        const wallet = await resolveCurrentCrossChainWallet({
            config: wagmiConfig,
            connectedAddress: account,
            sourceChain,
            destinationChainId: authenticationRoute.destinationChainId,
            switchNetwork,
            onPhase: logExecutionPhase,
        })
        return wallet.walletClient.signMessage({ account, message })
    }

    const routes = useCrossChainRoutes({
        endpoint,
        account,
        contextKey: requestKey,
        signMessage: authenticate,
        request,
        enabled: routingMode === enabledMode && walletState.isConnected,
        debounceMs,
        onExecutionPhase: logExecutionPhase,
    })
    const currentRoute = isExecutableCrossChainRouteForRequest(routes.selectedRoute, request)
        ? routes.selectedRoute
        : null
    const routeExpired = isCrossChainRouteExpired(routes.selectedRoute)
    const exactOutputUnsupported = routingMode === enabledMode && activeAmountSide === 'buy' &&
        Boolean(activeBuyAmountIn) && activeBuyAmountIn !== '0'
    const quoteStatus = exactOutputUnsupported
        ? 'unsupported'
        : routes.phase === 'quoting'
            ? 'loading'
            : routeExpired
                ? 'expired'
                : routes.phase === 'error'
                    ? 'error'
                    : currentRoute
                        ? 'success'
                        : 'idle'

    function closeReview() {
        reviewRequestRef.current = null
        refreshingAfterApprovalRef.current = false
        setReviewRoute(null)
        setReviewPreparation(IDLE_PREPARATION)
    }

    function routeBindingError(route) {
        if (!walletState.isConnected || !account) return 'Connect wallet to continue.'
        if (!walletState.isCorrectNetwork) return 'Switch to the source network to continue.'
        if (!request || !route) return 'Cross-chain route is not ready.'
        if (isCrossChainRouteExpired(route)) return 'Quote expired. Refresh the quote.'
        if (
            Number(route.sourceChainId) !== sellChainId ||
            Number(route.destinationChainId) !== buyChainId ||
            Number(route.sourceAsset?.chainId) !== sellChainId ||
            Number(route.destinationAsset?.chainId) !== buyChainId ||
            normalizedAddress(route.sourceAsset?.address) !== normalizedAddress(request.sourceAsset.address) ||
            normalizedAddress(route.destinationAsset?.address) !== normalizedAddress(request.destinationAsset.address) ||
            normalizedAddress(route.recipient) !== normalizedAddress(request.recipient) ||
            String(route.inputAmount) !== String(request.amount) ||
            String(request.amount) !== String(activeAmountIn)
        ) {
            return 'Route no longer matches the selected tokens.'
        }
        return null
    }

    function getReviewError() {
        const route = routes.selectedRoute
        const bindingError = routeBindingError(route)
        if (bindingError) return bindingError
        if (!currentRoute || route.publicRouteId !== currentRoute.publicRouteId) {
            return 'Route no longer matches the selected tokens.'
        }
        return null
    }

    async function estimateReviewRoute(route, expectedRouteId) {
        try {
            const estimate = await estimatePreparedCrossChainCosts({
                publicClient,
                preparedRoute: route,
                account,
                nativeBalanceWei: nativeBalance.value,
                nativePriceUsd: getDisplayTokenPrice(nativeToken),
                nativeDecimals: getCuratedEvmChain(sellChainId)?.nativeCurrency.decimals ?? 18,
                onDiagnostic: import.meta.env.DEV
                    ? (diagnostic) => console.debug('[cross-chain-cost-estimate]', diagnostic)
                    : undefined,
            })
            if (reviewRequestRef.current !== expectedRouteId) return null
            return {
                route: { ...route, costs: estimate.costs },
                preparation: {
                    status: 'ready',
                    gasEstimateUnavailable: false,
                    insufficientNativeGas: estimate.sufficientNativeGas === false,
                },
            }
        } catch {
            if (reviewRequestRef.current !== expectedRouteId) return null
            return {
                route,
                preparation: {
                    status: 'ready',
                    gasEstimateUnavailable: true,
                    insufficientNativeGas: false,
                },
            }
        }
    }

    async function prepareReview(route) {
        setReviewPreparation({ status: 'preparing', gasEstimateUnavailable: false, insufficientNativeGas: false })
        try {
            const prepared = await routes.prepare(route)
            if (reviewRequestRef.current !== route.publicRouteId) return
            if (
                !prepared ||
                prepared.publicRouteId !== route.publicRouteId ||
                prepared.minimumOutputAmount !== route.minimumOutputAmount ||
                isCrossChainRouteExpired(route)
            ) {
                throw new Error('The route could not be safely prepared for review.')
            }
            const nextReviewRoute = { ...route, ...prepared }
            if (
                nextReviewRoute.executionModel === 'evm-transaction' &&
                !getOrderedEvmSteps(nextReviewRoute).some((step) => step.type === 'source-transaction')
            ) {
                throw new Error('The prepared route has no valid source transaction.')
            }
            setReviewRoute(nextReviewRoute)
            if (nextReviewRoute.executionModel !== 'evm-transaction') {
                setReviewPreparation({ status: 'ready', gasEstimateUnavailable: true, insufficientNativeGas: false })
                return
            }

            const estimate = await estimateReviewRoute(nextReviewRoute, route.publicRouteId)
            if (!estimate) return
            setReviewRoute(estimate.route)
            setReviewPreparation(estimate.preparation)
        } catch (error) {
            if (reviewRequestRef.current !== route.publicRouteId) return
            setReviewPreparation({ status: 'invalid', gasEstimateUnavailable: false, insufficientNativeGas: false })
            setExecutionError(error instanceof Error ? error.message : 'The route could not be prepared.')
        }
    }

    function openReview() {
        const reviewError = getReviewError()
        if (reviewError) {
            setVisibleStatus(reviewError)
            return false
        }
        setExecutionError(null)
        reviewRequestRef.current = currentRoute.publicRouteId
        setReviewRoute(currentRoute)
        void prepareReview(currentRoute)
        return true
    }

    async function sendStep(step, executionRoute) {
        const stepChain = getCuratedEvmChain(step.chainId)
        if (!stepChain) throw new Error('This route step uses an unsupported network.')
        if (!account) throw new Error('Wallet client is not ready.')
        const wallet = await resolveCurrentCrossChainWallet({
            config: wagmiConfig,
            connectedAddress: account,
            sourceChain: stepChain,
            destinationChainId: executionRoute?.destinationChainId,
            switchNetwork,
            onPhase: logExecutionPhase,
        })
        return sendPreparedCrossChainTransaction({
            walletClient: wallet.walletClient,
            connectedAddress: account,
            sourceChain: stepChain,
            destinationChainId: executionRoute?.destinationChainId,
            step,
            routeId: executionRoute?.publicRouteId,
            validateRoute: () => {
                const error = routeBindingError(executionRoute)
                if (error) throw new Error(error)
            },
            onPhase: (phase, metadata, error) => logExecutionPhase(phase, {
                ...metadata,
                connectorId: wallet.connector.id ?? null,
                connectorName: wallet.connector.name ?? null,
                providerType: wallet.provider?.constructor?.name ?? wallet.connector.type ?? null,
            }, error),
        })
    }

    async function refreshAfterApproval(previousRoute, approvedStep) {
        if (!request) throw new Error('Cross-chain request is no longer available.')

        refreshingAfterApprovalRef.current = true
        setReviewPreparation({
            status: 'refreshing',
            gasEstimateUnavailable: false,
            insufficientNativeGas: false,
        })
        setExecutionError(null)
        setVisibleStatus('Approval confirmed. Refreshing the route...')

        try {
            const response = await routes.quote(request)
            const refreshedRoutes = Array.isArray(response?.routes) ? response.routes : []
            const refreshedRoute = refreshedRoutes.find((candidate) =>
                normalizedProvider(candidate.provider) === normalizedProvider(previousRoute.provider) &&
                routeBindingError(candidate) === null &&
                !isCrossChainRouteExpired(candidate),
            )
            if (!refreshedRoute) {
                throw new Error('The approved provider no longer returned a usable route. Review a new quote.')
            }

            routes.selectRoute(refreshedRoute)
            reviewRequestRef.current = refreshedRoute.publicRouteId
            setReviewRoute(refreshedRoute)

            const prepared = await routes.prepare(refreshedRoute)
            if (!prepared || prepared.publicRouteId !== refreshedRoute.publicRouteId) {
                throw new Error('The refreshed route could not be prepared.')
            }

            let nextRoute = { ...refreshedRoute, ...prepared }
            const bindingError = routeBindingError(nextRoute)
            if (bindingError) throw new Error(bindingError)

            const nextSteps = getOrderedEvmSteps(nextRoute)
            if (!nextSteps.some((step) => step.type === 'source-transaction')) {
                throw new Error('The refreshed route has no valid source transaction.')
            }

            const remainingApprovals = nextSteps.filter((step) => step.type === 'approval')
            const approvalsAreAlreadyConfirmed = remainingApprovals.every((step) =>
                sameApprovalTransaction(step, approvedStep),
            )
            const minimumOutputWorsened = compareUnsignedIntegers(
                nextRoute.minimumOutputAmount,
                previousRoute.minimumOutputAmount,
            ) < 0

            const estimate = await estimateReviewRoute(nextRoute, refreshedRoute.publicRouteId)
            if (estimate) {
                nextRoute = estimate.route
                setReviewRoute(nextRoute)
                setReviewPreparation(estimate.preparation)
            } else {
                setReviewRoute(nextRoute)
                setReviewPreparation({
                    status: 'ready',
                    gasEstimateUnavailable: true,
                    insufficientNativeGas: false,
                })
            }

            if (minimumOutputWorsened) {
                return {
                    route: nextRoute,
                    steps: nextSteps,
                    requiresReview: true,
                    message: 'The refreshed minimum output changed. Review the new route before continuing.',
                }
            }
            if (!approvalsAreAlreadyConfirmed) {
                return {
                    route: nextRoute,
                    steps: nextSteps,
                    requiresReview: true,
                    message: 'The refreshed route requires a different approval. Review it before continuing.',
                }
            }
            if (estimate?.preparation.insufficientNativeGas) {
                return {
                    route: nextRoute,
                    steps: nextSteps,
                    requiresReview: true,
                    message: `Not enough ${getCuratedEvmChain(sellChainId)?.nativeCurrency.symbol ?? 'native token'} for network gas.`,
                }
            }

            setVisibleStatus(null)
            return {
                route: nextRoute,
                steps: nextSteps.filter((step) => step.type !== 'approval'),
                requiresReview: false,
                message: null,
            }
        } finally {
            refreshingAfterApprovalRef.current = false
        }
    }

    async function submitSwap() {
        setExecutionError(null)
        logExecutionPhase('review-confirm', {
            sourceChainId: reviewRoute?.sourceChainId,
            destinationChainId: reviewRoute?.destinationChainId,
            routeId: reviewRoute?.publicRouteId,
        })
        const reviewError = getReviewError()
        if (reviewError || !reviewRoute || reviewRoute.publicRouteId !== currentRoute?.publicRouteId) {
            setVisibleStatus(reviewError ?? 'Route no longer matches the selected tokens.')
            closeReview()
            return
        }

        try {
            let executionRoute = routes.preparedRoute ?? await routes.prepare(reviewRoute)
            if (!executionRoute) return
            let steps = getOrderedEvmSteps(executionRoute)
            let sourceClaimed = false
            let refreshedAfterApproval = false
            setTransactionStatus('pending')

            for (let index = 0; index < steps.length; index += 1) {
                const step = steps[index]
                if (step.type !== 'approval' && !sourceClaimed) {
                    const claimed = await routes.claimSource()
                    if (!claimed) throw new Error('The source route could not be claimed.')
                    sourceClaimed = true
                }

                const hash = await sendStep(step, executionRoute)
                if (step.type === 'approval') {
                    await waitForCrossChainApproval({
                        config: wagmiConfig,
                        chainId: step.chainId,
                        hash,
                        onPhase: logExecutionPhase,
                    })

                    if (refreshedAfterApproval) {
                        throw new Error('The refreshed route unexpectedly requested another approval.')
                    }
                    refreshedAfterApproval = true

                    const refreshed = await refreshAfterApproval(executionRoute, step)
                    executionRoute = refreshed.route
                    steps = refreshed.steps
                    sourceClaimed = false
                    if (refreshed.requiresReview) {
                        setTransactionStatus('idle')
                        setVisibleStatus(refreshed.message)
                        setExecutionError(refreshed.message)
                        return
                    }
                    index = -1
                    continue
                }

                await routes.markSubmitted(hash)
            }

            setTransactionStatus('submitted')
            closeReview()
            setVisibleStatus('Cross-chain swap submitted.')
        } catch (error) {
            setTransactionStatus(isUserRejectedError(error) ? 'rejected' : 'failed')
            const sourceChainName = getCuratedEvmChain(reviewRoute?.sourceChainId)?.name ?? 'the source chain'
            const message = crossChainExecutionMessage(error, sourceChainName)
            setVisibleStatus(message)
            setExecutionError(message)
        }
    }

    async function refreshExpiredRoute() {
        closeReview()
        setVisibleStatus('Quote expired. Refresh the quote.')
        routes.reset()
        if (request) await routes.quote(request)
    }

    useEffect(() => {
        if (
            !refreshingAfterApprovalRef.current &&
            reviewRoute &&
            reviewRoute.publicRouteId !== currentRoute?.publicRouteId
        ) closeReview()
    }, [currentRoute, reviewRoute])

    useEffect(() => {
        if (!import.meta.env.DEV || !currentRoute) return
        const costs = currentRoute.costs ?? {}
        console.debug('[cross-chain-cost-estimate]', {
            provider: currentRoute.provider,
            routeIdSuffix: String(currentRoute.publicRouteId ?? '').slice(-8) || null,
            confidence: costs.confidence ?? 'quote',
            sourceGasEstimated: [costs.sourceGasUsd, costs.sourceGasNative].some((value) => value !== null && value !== undefined),
            providerFeeAvailable: costs.providerFeeUsd !== null && costs.providerFeeUsd !== undefined,
            destinationGasAvailable: costs.destinationGasUsd !== null && costs.destinationGasUsd !== undefined,
            sponsoredAvailable: costs.sponsoredUsd !== null && costs.sponsoredUsd !== undefined,
            totalAvailable: costs.totalEstimatedUsd !== null && costs.totalEstimatedUsd !== undefined,
            estimationDurationMs: 0,
        })
    }, [currentRoute])

    useEffect(() => {
        if (activeAmountSide !== 'sell' || routingMode !== enabledMode) return
        if (quoteStatus === 'loading') {
            setBuyAmount('')
            return
        }
        if (!currentRoute || !buyToken) {
            if (quoteStatus === 'error') setBuyAmount('0')
            return
        }
        if (buyInputDenomination === 'TOKEN') {
            setBuyAmount(formatTokenAmount(
                currentRoute.outputAmount,
                Number(buyToken.decimals ?? 18),
            ) ?? '0')
        }
    }, [activeAmountSide, buyInputDenomination, buyToken, currentRoute, enabledMode, quoteStatus, routingMode, setBuyAmount])

    useEffect(() => {
        if (routingMode !== enabledMode) return
        if (exactOutputUnsupported) {
            setVisibleStatus('Exact output is not supported for this route.')
            return
        }
        if (!request || quoteStatus === 'loading') {
            setVisibleStatus(null)
            return
        }
        if (quoteStatus === 'error') setVisibleStatus(routes.error)
        else if (quoteStatus === 'success') setVisibleStatus(null)
    }, [enabledMode, exactOutputUnsupported, quoteStatus, request, routes.error, routingMode, setVisibleStatus])

    return {
        request,
        requestKey,
        routes,
        currentRoute,
        routeExpired,
        exactOutputUnsupported,
        quoteStatus,
        openReview,
        refreshExpiredRoute,
        review: {
            route: reviewRoute,
            preparation: reviewPreparation,
            executionError,
            close: closeReview,
            confirm: submitSwap,
            confirmDisabled: reviewPreparation.status !== 'ready' ||
                reviewPreparation.insufficientNativeGas || !routes.preparedRoute ||
                isCrossChainRouteExpired(reviewRoute) || routes.phase === 'claiming' ||
                transactionStatus === 'pending' || transactionStatus === 'submitted',
        },
    }
}

function normalizedAddress(value) {
    return String(value ?? '').toLowerCase()
}

function normalizedProvider(value) {
    return String(value ?? '').trim().toLowerCase()
}

function compareUnsignedIntegers(left, right) {
    try {
        const a = BigInt(String(left ?? '0'))
        const b = BigInt(String(right ?? '0'))
        return a === b ? 0 : a > b ? 1 : -1
    } catch {
        return -1
    }
}

function sameApprovalTransaction(candidate, confirmed) {
    const left = candidate?.transaction
    const right = confirmed?.transaction
    if (!left || !right) return false

    try {
        return (
            Number(candidate.chainId) === Number(confirmed.chainId) &&
            normalizedAddress(left.to) === normalizedAddress(right.to) &&
            normalizedAddress(left.data) === normalizedAddress(right.data) &&
            BigInt(left.value ?? '0') === BigInt(right.value ?? '0')
        )
    } catch {
        return false
    }
}
