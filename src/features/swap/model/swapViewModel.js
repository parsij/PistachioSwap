import { formatUnits, parseEther } from 'viem'
import { multiplyUsdAmount } from '../../../services/fiatValue.js'
import {
    DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
    DEFAULT_NATIVE_GAS_BUFFER_BPS,
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    getBootstrapNativeGasReserveWei,
    getQuoteEstimatedNativeFeeWei,
    getSpendableTokenAmount,
    isNativeEvmToken,
} from '../../../services/balances.js'
import { formatSlippageBps } from '../../settings/services/swapSettings.js'
import { getTokenDisplaySymbol } from '../../tokens/services/tokenDisplay.js'
import {
    addDecimalStrings,
    formatTokenAmount,
    getProviderDisplayName,
} from '../../cross-chain/services/crossChainRoutes.js'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { formatCompactRate, formatCostUsd, formatNetworkCostUsd } from './swapDisplay.js'
import {
    expectsCrossChainGasAssist,
    getCrossChainGasAssistTier,
} from './swapEligibility.js'
import { getDisplayTokenPrice } from '../../tokens/services/tokenPrices.js'
import { getGasAssistFeeBreakdown } from '../../gas-assist/model/gasAssistFee.js'

function formatUsdMicros(value) {
    if (value === null || value === undefined || value < 0n) return null
    const whole = value / 1_000_000n
    const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/u, '')
    return formatCostUsd(fraction ? `${whole}.${fraction}` : whole.toString())
}

function gasAssistFeeView(order, sellToken) {
    const fees = getGasAssistFeeBreakdown(order)
    if (!fees || !sellToken) return null
    return {
        totalToken: formatTokenDisplayAmount(
            formatTokenAmount(fees.totalFeeRaw.toString(), sellToken.decimals),
            sellToken,
        ),
        totalUsd: formatUsdMicros(fees.totalFeeUsdMicros),
        commercialUsd: formatUsdMicros(fees.commercialFeeUsdMicros),
        networkReserveUsd: formatUsdMicros(fees.networkReserveUsdMicros),
        estimatedSponsoredGasUsd: formatUsdMicros(fees.estimatedSponsoredGasUsdMicros),
        routeCostUsd: formatUsdMicros(fees.routeCostUsdMicros),
        allInCostUsd: formatUsdMicros(fees.allInCostUsdMicros),
    }
}

function unavailableWalletChainNotice(chainIds = []) {
    const names = [...new Set(chainIds)]
        .map((chainId) => getCuratedEvmChain(chainId)?.name ?? `chain ${chainId}`)
    if (names.length === 0) return 'Some network balances could not be refreshed.'
    return `Some network balances could not be refreshed: ${names.join(', ')}.`
}

export function getWalletBalanceNotice({
    activeChainId,
    backendWalletTokens = [],
    walletTokenError = null,
    walletTokenStale = false,
    walletTokenFailedChainIds = [],
} = {}) {
    const hasUsableWalletTokens = Array.isArray(backendWalletTokens) &&
        backendWalletTokens.length > 0
    if (walletTokenError && !hasUsableWalletTokens) {
        return 'Wallet balances could not be loaded.'
    }
    if (walletTokenStale === true) {
        return 'Showing previously loaded balances.'
    }
    const failedChainIds = Array.isArray(walletTokenFailedChainIds)
        ? walletTokenFailedChainIds
        : []
    if (!hasUsableWalletTokens && failedChainIds.length === 1) {
        return unavailableWalletChainNotice(failedChainIds)
    }
    const activeChainFailed = failedChainIds.some((chainId) =>
        Number(chainId) === Number(activeChainId))
    return activeChainFailed
        ? unavailableWalletChainNotice([activeChainId])
        : null
}

export function getPrimaryActionPresentation({
    action,
    crossChainGasAssistDirect = false,
    crossChainGasAssistStatus = 'idle',
}) {
    if ([
        'connect',
        'switch-network',
        'select-token',
        'enter-amount',
        'transaction-pending',
        'transaction-submitted',
    ].includes(action?.type)) {
        return action
    }
    if (crossChainGasAssistDirect && ['idle', 'loading'].includes(crossChainGasAssistStatus)) {
        return {
            type: 'gas-assist-loading',
            label: 'Preparing Gas Assist…',
            enabled: false,
            loading: true,
        }
    }
    if (crossChainGasAssistDirect && crossChainGasAssistStatus !== 'success') {
        return {
            type: 'gas-assist-unavailable',
            label: 'Gas Assist unavailable',
            enabled: false,
            loading: false,
        }
    }
    return action
}

export function formatTokenDisplayAmount(amount, token) {
    const value = String(amount ?? '').trim()
    if (!value || !token) return null
    return `${value} ${getTokenDisplaySymbol(token)}`
}

/** Uses only the source-chain native price and the current route's gas metadata. */
export function getNetworkFeeDisplayData({ chainId, gasEstimate, route, reviewedRoute, preparation, nativeToken, availableTokens = [], sellToken, buyToken, isCrossChain }) {
    let nativePriceUsd = null
    for (const token of [nativeToken, sellToken, buyToken, ...availableTokens]) {
        if (!token || !isNativeEvmToken(token) || Number(token.chainId) !== Number(chainId)) continue
        nativePriceUsd = getDisplayTokenPrice(token)
        if (nativePriceUsd !== null) break
    }
    let rawGas = gasEstimate
    if (isCrossChain) {
        const matches = Number(route?.sourceChainId) === Number(chainId)
        if (nativePriceUsd === null && matches && /^\d+(?:\.\d+)?$/.test(String(route?.sourceNativePriceUsd ?? ''))) {
            // The quote's server-priced source native coin is display evidence only.
            nativePriceUsd = getDisplayTokenPrice({ address: '0x0000000000000000000000000000000000000000',
                isNative: true, priceUSD: route.sourceNativePriceUsd })
        }
        const prepared = matches && reviewedRoute?.publicRouteId === route?.publicRouteId && preparation?.sourceGasEstimate
        // Use the provider's quote estimate before review; preparation replaces it with an RPC estimate.
        rawGas = prepared ? preparation.sourceGasEstimate : matches && /^[1-9]\d*$/.test(String(route?.sourceGasEstimate ?? ''))
            ? (BigInt(route.sourceGasEstimate) * 120n + 99n) / 100n : null
    }
    let gas = null
    try { if (rawGas != null && BigInt(rawGas) > 0n) gas = BigInt(rawGas) } catch { /* No usable estimate. */ }
    return { nativePriceUsd, gasEstimate: gas }
}

/**
 * Builds grouped presentation contracts for `AppHeader` and `SwapPage` without owning state.
 * @param {object} context Current controller state, feature APIs, config, and semantic callbacks.
 * @returns {{header: object, page: object}} Component-oriented immutable view models.
 * @sideEffects None; callbacks are passed through without invocation.
 */
export function createSwapViewModel(context) {
    const {
        config, reducedMotion, walletState, swapSettings, catalog, inputs, routing, quote,
        gasAssist, crossChainGasAssist, crossChainGasAssistDirect, crossChain, receipt, eligibility, review, execution, effectiveSlippageBps,
        statusMessage, quoteDetailsOpen, setQuoteDetailsOpen, callbacks,
    } = context
    const { brand, navigation, copy, quote: quoteConfig, wallet: walletConfig, tabs, motion: motionConfig } = config
    const { sellToken, buyToken } = inputs
    const nativeToken = catalog.walletTokens.find((token) =>
        isNativeEvmToken(token) && Number(token.chainId) === context.swapChainId) ?? null
    const nativeSymbol = catalog.activeChain?.nativeCurrency.symbol ?? 'native token'
    const explorerUrl = catalog.activeChain?.blockExplorers?.default?.url ?? walletConfig.explorerUrl
    const activeQuote = routing.routingMode === routing.modes.CROSS_CHAIN
        ? crossChain.currentRoute
        : gasAssist.activeQuote
    const activeQuoteStatus = routing.routingMode === routing.modes.CROSS_CHAIN
        ? crossChain.quoteStatus
        : gasAssist.activeQuoteStatus
    const selectedQuote =
        activeQuote?.selectedQuote ??
        quote.quote?.selectedQuote ??
        null
    const nativePriceToken =
        nativeToken ??
        (
            isNativeEvmToken(sellToken)
                ? sellToken
                : null
        )
    const estimatedSwapFeeWei =
        getQuoteEstimatedNativeFeeWei({
            quote: routing.routingMode === routing.modes.CROSS_CHAIN
                ? crossChain.currentRoute
                : selectedQuote,
            nativeToken: nativePriceToken,
        })

    const fallbackNativeReserveWei =
        (() => {
            try {
                return parseEther(
                    walletConfig
                        .nativeGasReserve,
                )
            } catch {
                return DEFAULT_NATIVE_GAS_RESERVE_WEI
            }
        })()

    const effectiveFallbackNativeReserveWei =
        selectedQuote
            ? fallbackNativeReserveWei
            : getBootstrapNativeGasReserveWei({
                balanceWei:
                    catalog.nativeBalance.value ??
                    0n,
                fallbackReserveWei:
                    fallbackNativeReserveWei,
            })

    const minimumNativeGasBufferWei =
        (() => {
            try {
                return parseEther(
                    walletConfig
                        .minimumNativeGasBuffer,
                )
            } catch {
                return DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI
            }
        })()

    const nativeGasBufferBps =
        Number.isFinite(
            Number(
                walletConfig
                    .nativeGasBufferBps,
            ),
        )
            ? Math.max(
                0,

                Math.trunc(
                    Number(
                        walletConfig
                            .nativeGasBufferBps,
                    ),
                ),
            )
            : DEFAULT_NATIVE_GAS_BUFFER_BPS

    const spendableSellAmount =
        sellToken
            ? getSpendableTokenAmount({
                token:
                sellToken,

                nativeBalanceWei:
                    catalog
                        .nativeBalance
                        .value ??
                    0n,

                estimatedFeeWei:
                estimatedSwapFeeWei,

                fallbackReserveWei:
                effectiveFallbackNativeReserveWei,

                gasBufferBps:
                nativeGasBufferBps,

                minimumGasBufferWei:
                minimumNativeGasBufferWei,
            })
            : '0'
    const crossChainGasAssistExpected = expectsCrossChainGasAssist({
        gasAssistPreference: swapSettings.gasAssistPreference,
        prepaidEnabled: gasAssist.prepaidSponsorship.config?.enabled,
        routingMode: routing.routingMode,
        crossChainMode: routing.modes.CROSS_CHAIN,
        nativeBalanceValue: catalog.nativeBalance.value,
        nativeGasReserve: walletConfig.nativeGasReserve,
        sellChainId: routing.sellChainId,
        sellToken,
    })
    const sponsoredCrossChainRoute = crossChainGasAssist?.previewRoute ?? null
    const crossChainDisplayRoute = crossChainGasAssistExpected && sponsoredCrossChainRoute
        ? sponsoredCrossChainRoute
        : crossChain.currentRoute
    const quoteProvider = routing.routingMode === routing.modes.CROSS_CHAIN
        ? crossChainDisplayRoute ? getProviderDisplayName(crossChainDisplayRoute.provider) : null
        : activeQuote?.selectedQuote?.provider ?? null
    const crossChainCosts = crossChainDisplayRoute?.costs ?? null
    const estimatedTotalCost = formatCostUsd(crossChainCosts?.totalEstimatedUsd, true)
    const estimatedRouteCost = formatCostUsd(crossChainCosts?.routeCostUsd, true)
    const networkFeeDisplay = getNetworkFeeDisplayData({ chainId: context.swapChainId,
        gasEstimate: context.networkFees?.gasEstimate, route: crossChainDisplayRoute, reviewedRoute: crossChain.review.route,
        preparation: crossChain.review.preparation, nativeToken, availableTokens: catalog.availableTokens,
        sellToken, buyToken, isCrossChain: routing.routingMode === routing.modes.CROSS_CHAIN })
    const sourceGasCost = formatNetworkCostUsd(crossChainCosts?.sourceGasUsd, true)
    const customNetworkCostNative = context.networkFees?.automatic === false && context.networkFees.maximumNativeFeeWei != null
        ? formatUnits(context.networkFees.maximumNativeFeeWei, getCuratedEvmChain(context.swapChainId)?.nativeCurrency.decimals ?? 18) : null
    const customNetworkCostUsd = customNetworkCostNative && networkFeeDisplay.nativePriceUsd
        ? multiplyUsdAmount(customNetworkCostNative, networkFeeDisplay.nativePriceUsd) : null
    const sameChainNetworkCost = customNetworkCostNative
        ? `${customNetworkCostUsd ? formatNetworkCostUsd(customNetworkCostUsd) : `${customNetworkCostNative} ${nativeSymbol}`} max`
        : activeQuote?.selectedQuote?.estimatedGasUsd
        ? formatNetworkCostUsd(activeQuote.selectedQuote.estimatedGasUsd)
        : activeQuote?.selectedQuote ? 'Included' : null
    const sameChainGasAssistFee = gasAssistFeeView(gasAssist.preview, sellToken)
    const crossChainGasAssistFee = gasAssistFeeView(crossChainGasAssist?.preview, sellToken)
    const minimumReceived = routing.routingMode === routing.modes.CROSS_CHAIN
        ? crossChainDisplayRoute && buyToken
            ? formatTokenDisplayAmount(
                formatTokenAmount(
                    crossChainGasAssist?.preview?.minimumOutputRaw ??
                    crossChainDisplayRoute.minimumOutputAmount,
                    buyToken.decimals,
                ),
                buyToken,
            )
            : null
        : activeQuote?.selectedQuote?.minimumBuyAmount && buyToken
            ? formatTokenDisplayAmount(
                formatTokenAmount(activeQuote.selectedQuote.minimumBuyAmount, buyToken.decimals),
                buyToken,
            )
            : null
    const maximumSold = activeQuote?.selectedQuote?.maximumSellAmount && sellToken
        ? formatTokenDisplayAmount(
            formatTokenAmount(activeQuote.selectedQuote.maximumSellAmount, sellToken.decimals),
            sellToken,
        )
        : sellToken && inputs.sellAmount
            ? formatTokenDisplayAmount(inputs.sellAmount, sellToken)
            : null
    const platformFee = activeQuote?.selectedQuote?.platformFee
    const serviceFee = platformFee?.amount && platformFee.amount !== '0'
        ? `${formatTokenAmount(
            platformFee.amount,
            platformFee.token === sellToken?.address ? sellToken?.decimals : buyToken?.decimals,
        )} ${getTokenDisplaySymbol(platformFee.token === sellToken?.address ? sellToken : buyToken)}${(platformFee.effectiveBps ?? platformFee.bps) > 0 ? ` (${((platformFee.effectiveBps ?? platformFee.bps) / 100).toFixed(2)}%)` : ''}`
        : platformFee?.bps > 0 ? `${(platformFee.effectiveBps ?? platformFee.bps) / 100}%` : routing.routingMode !== routing.modes.CROSS_CHAIN ? 'Free' : null
    const crossChainAppFee = crossChainCosts?.appFeeUsd === '0' ? 'Free' : formatCostUsd(crossChainCosts?.appFeeUsd)
    const reviewCosts = crossChain.review.route?.costs ?? null
    const reviewProviderCosts = addDecimalStrings([reviewCosts?.providerFeeUsd, reviewCosts?.destinationGasUsd])
    const reviewTotalCost = formatCostUsd(reviewCosts?.totalEstimatedUsd, true)
    const reviewRouteCost = formatCostUsd(reviewCosts?.routeCostUsd, true)
    const reviewNativeSymbol = getCuratedEvmChain(crossChain.review.route?.sourceChainId)?.nativeCurrency.symbol ?? nativeSymbol
    const reviewSourceGas = formatNetworkCostUsd(reviewCosts?.sourceGasUsd, true) ??
        (reviewCosts?.sourceGasNative ? `~${reviewCosts.sourceGasNative} ${reviewNativeSymbol}` : null)
    const reviewAppFee = reviewCosts?.appFeeUsd === '0' ? 'Free' : formatCostUsd(reviewCosts?.appFeeUsd)
    const primaryActionPresentation = getPrimaryActionPresentation({
        action: eligibility.action,
        crossChainGasAssistDirect,
        crossChainGasAssistStatus: crossChainGasAssist?.status,
    })
    const crossChainGasAssistErrorMessage =
        crossChainGasAssistDirect && crossChainGasAssist?.status === 'error'
            ? crossChainGasAssist?.error?.message ??
              'An error happened on our side. Please try again later.'
            : null
    const crossChainGasAssistTier = getCrossChainGasAssistTier({
        gasAssistPreference: swapSettings.gasAssistPreference,
        routingMode: routing.routingMode,
        crossChainMode: routing.modes.CROSS_CHAIN,
        nativeBalanceValue: catalog.nativeBalance.value,
        nativeGasReserve: walletConfig.nativeGasReserve,
        requiredNativeGasWei: crossChain.review.preparation.requiredNativeGasWei,
        gasEstimateUnavailable: crossChain.review.preparation.gasEstimateUnavailable,
        preparationStatus: crossChain.review.preparation.status,
        sellChainId: routing.sellChainId,
        sellToken,
    })
    const sameChainConfirmLabel = {
        'checking-approval': 'Checking token approval...',
        'checking-token-approval': 'Checking token approval...',
        'approving-token': 'Approve token in your wallet',
        'checking-pancake-authorization': 'Checking PancakeSwap authorization...',
        'renewing-pancake-authorization': 'Renewing PancakeSwap authorization in your wallet...',
        'waiting-pancake-authorization': 'Waiting for authorization confirmation...',
        'refreshing-quote': 'Refreshing price...',
        simulating: 'Simulating swap...',
        submitting: 'Confirm swap in your wallet',
        'waiting-confirmation': 'Waiting for confirmation...',
    }[review.reviewOperation] ?? 'Confirm swap'
    const sameChainConfirmDisabled = execution.isConfirming || review.reviewOperation !== 'idle' ||
        receipt.transactionStatus === 'pending' || receipt.transactionStatus === 'submitted'
    const compactRate = sellToken && buyToken
        ? formatCompactRate(
            inputs.sellAmount,
            getTokenDisplaySymbol(sellToken),
            inputs.buyAmount,
            getTokenDisplaySymbol(buyToken),
        )
        : 'Rate unavailable'
    const balanceNotice = getWalletBalanceNotice({
        activeChainId: context.swapChainId,
        backendWalletTokens: catalog.backendWalletTokens,
        walletTokenError: catalog.walletTokenError,
        walletTokenStale: catalog.walletTokenStale,
        walletTokenFailedChainIds: catalog.walletTokenFailedChainIds,
    })

    return {
        header: {
            brand,
            navigation,
            search: {
                label: copy.searchLabel,
                onOpen: callbacks.onOpenGlobalSearch,
            },
            wallet: {
                walletState,
                nativeBalance: catalog.nativeBalance,
                nativeToken,
                walletTokens: catalog.walletTokens,
                settings: swapSettings,
                selectedTokens: [sellToken, buyToken],
                explorerUrl,
                onRefetch: catalog.refreshWalletBalances,
            },
        },
        page: {
            operationStatus: {
                walletAddress: walletState.address ?? null,
            },
            toolbar: {
                tabs,
                activeTab: inputs.activeTab,
                onTabSelect: inputs.setActiveTab,
                settings: {
                    value: swapSettings,
                    onChange: callbacks.onSettingsChange,
                    defaultSlippageBps: quoteConfig.defaultSlippageBps,
                    recommendedSlippageBps: quote.providerRecommendedSlippageBps,
                    ariaLabel: copy.settingsLabel,
                },
            },
            card: {
                sellPanel: {
                    side: 'sell',
                    label: copy.sell,
                    token: sellToken,
                    chainId: routing.sellChainId,
                    amount: {
                        value: inputs.sellAmount,
                        denomination: inputs.sellInputDenomination,
                        onChange: callbacks.onSellAmountChange,
                    },
                    secondaryValue: inputs.sellSecondaryValue,
                    layoutIdentity: inputs.sellIdentity,
                    motionConfig,
                    onOpenTokenSelector: callbacks.onOpenSellTokenSelector,
                    onToggleDenomination: callbacks.onToggleSellDenomination,
                    invalid: eligibility.insufficientFunds,
                    quickAmounts: {
                        visible: inputs.showQuickAmounts,
                        spendableAmount: spendableSellAmount,
                        onSelect: callbacks.onQuickAmountSelect,
                        onShow: () => inputs.setShowQuickAmounts(true),
                        onHide: () => inputs.setShowQuickAmounts(false),
                        onBlur: (event) => {
                            if (!event.currentTarget.contains(event.relatedTarget)) inputs.setShowQuickAmounts(false)
                        },
                    },
                    balance: {
                        notice: balanceNotice,
                        onRetry: catalog.walletTokenError ? catalog.refetchWalletTokens : null,
                        onUseMaximum: callbacks.onUseMaximumBalance,
                    },
                },
                direction: {
                    ariaLabel: copy.switchLabel,
                    rotation: inputs.switchRotation,
                    reducedMotion,
                    motionConfig: motionConfig.switchButton,
                    onSwitchTokens: callbacks.onSwitchTokens,
                },
                buyPanel: {
                    side: 'buy',
                    label: copy.buy,
                    quoteReady: activeQuoteStatus === 'success' && Boolean(activeQuote),
                    token: buyToken,
                    chainId: routing.buyChainId,
                    amount: {
                        value: inputs.buyAmount,
                        denomination: inputs.buyInputDenomination,
                        onChange: callbacks.onBuyAmountChange,
                    },
                    secondaryValue: inputs.buySecondaryValue,
                    layoutIdentity: inputs.buyIdentity,
                    motionConfig,
                    onOpenTokenSelector: callbacks.onOpenBuyTokenSelector,
                    onToggleDenomination: callbacks.onToggleBuyDenomination,
                    loading: routing.routingMode === routing.modes.CROSS_CHAIN && activeQuoteStatus === 'loading' &&
                        inputs.activeAmountSide === 'sell',
                },
                primaryAction: {
                    action: primaryActionPresentation,
                    reducedMotion,
                    triggerRef: review.triggerRef,
                    onAction: callbacks.onPrimaryAction,
                },
                details: {
                    networkFees: context.networkFees ? {
                        fees: { ...context.networkFees,
                            gasEstimate: networkFeeDisplay.gasEstimate },
                        nativePriceUsd: networkFeeDisplay.nativePriceUsd,
                        destinationChainId: routing.routingMode === routing.modes.CROSS_CHAIN ? routing.buyChainId : null,
                        onSelect: callbacks.onNetworkFeeSelect,
                        sponsored: Boolean(sameChainGasAssistFee || crossChainGasAssistFee || routing.routingMode === routing.modes.SAME_CHAIN_GAS_ASSIST || crossChainGasAssistDirect),
                    } : null,
                    open: quoteDetailsOpen,
                    onOpenChange: setQuoteDetailsOpen,
                    rate: compactRate,
                    mode: routing.routingMode === routing.modes.CROSS_CHAIN ? 'cross-chain' : 'same-chain',
                    sameChain: {
                        visible: activeQuoteStatus === 'success' && Boolean(sellToken && buyToken),
                        serviceFee,
                        networkCost: sameChainNetworkCost,
                        gasAssistFee: sameChainGasAssistFee,
                    },
                    crossChain: crossChainDisplayRoute ? {
                        route: crossChainDisplayRoute,
                        routes: crossChain.routes.routes,
                        sort: crossChain.routes.sort,
                        onSortChange: crossChain.routes.setSort,
                        onSelect: crossChain.routes.selectRoute,
                        recommendedRouteId: crossChain.routes.recommendedRouteId,
                        costs: crossChainCosts,
                        estimatedTotalCost,
                        estimatedRouteCost,
                        sourceGasCost,
                        appFee: crossChainAppFee,
                        gasAssistFee: crossChainGasAssistFee,
                        minimumReceived,
                    } : null,
                    slippage: { auto: swapSettings.slippageMode === 'auto', label: formatSlippageBps(effectiveSlippageBps) },
                    provider: quoteProvider,
                    exactOutputMaximum: inputs.activeAmountSide === 'buy' && routing.routingMode !== routing.modes.CROSS_CHAIN
                        ? maximumSold
                        : null,
                },
                gasAssistBanner: gasAssist.prepaidRequired
                    ? {
                        quote: gasAssist.activeQuote?.selectedQuote ?? null,
                        sellToken,
                        buyToken,
                    }
                    : null,
                status: {
                    nativeBalanceError: catalog.nativeBalance.status === 'error' && walletState.isConnected && walletState.isCorrectNetwork,
                    nativeSymbol,
                    executionMessage: context.executionMessage,
                    showExecutionMessage: catalog.nativeBalance.value === 0n,
                    statusMessage: statusMessage ?? crossChainGasAssistErrorMessage,
                },
            },
            tokenSelector: {
                open: Boolean(catalog.selector.side),
                selectorProps: {
                    side: catalog.selector.side,
                    mode: catalog.selector.mode,
                    chainId: catalog.selector.chainId,
                    tokens: catalog.selector.marketTokens,
                    commonTokens: catalog.selector.commonTokens,
                    walletTokens: catalog.selector.walletTokens,
                    search: catalog.selector.search,
                    loading: catalog.selector.loading,
                    error: catalog.selector.error,
                    catalogNotice: catalog.selector.notice,
                    catalogDiagnostics: catalog.selector.diagnostics,
                    currentToken: catalog.selector.side === 'sell' ? sellToken : buyToken,
                    oppositeToken: catalog.selector.side === 'sell' ? buyToken : sellToken,
                    onSearchChange: catalog.selector.setSearch,
                    onChainChange: catalog.selector.setChainId,
                    onSelect: callbacks.onTokenSelect,
                    onClose: catalog.selector.close,
                    hideUnknownTokens: swapSettings.hideUnknownTokens,
                    hideSmallBalances: swapSettings.hideSmallBalances,
                },
            },
            gasAssistDialogs: {
                prepayment: {
                    key: crossChainGasAssist?.sponsorship?.order?.id ??
                        gasAssist.prepaidSponsorship?.order?.id ?? 'prepaid-sponsorship',
                    props: crossChainGasAssist?.sponsorship?.open
                        ? {
                            sponsorship: crossChainGasAssist.sponsorship,
                            sellToken,
                            buyToken,
                            purpose: 'cross-chain-gas',
                        }
                        : { sponsorship: gasAssist.prepaidSponsorship, sellToken, buyToken },
                },
            },
            sameChainReview: {
                open: review.isOpen,
                onOpenChange: callbacks.onSameChainReviewOpenChange,
                contentRef: review.contentRef,
                reducedMotion,
                activeAmountSide: inputs.activeAmountSide,
                buyAmount: inputs.buyAmount,
                sellAmount: inputs.sellAmount,
                buyToken,
                sellToken,
                maximumSold,
                minimumReceived,
                quoteProvider,
                slippageLabel: formatSlippageBps(effectiveSlippageBps),
                reviewError: review.reviewError,
                confirmDisabled: sameChainConfirmDisabled,
                confirmLabel: sameChainConfirmLabel,
                onConfirm: callbacks.onConfirmSameChainSwap,
            },
            crossChainReview: {
                open: Boolean(crossChain.review.route) && !crossChainGasAssist?.sponsorship?.open,
                route: crossChain.review.route,
                reducedMotion,
                activeAmountSide: inputs.activeAmountSide,
                sellToken,
                buyToken,
                costs: {
                    total: reviewTotalCost,
                    route: reviewRouteCost,
                    sourceGas: reviewSourceGas,
                    provider: reviewProviderCosts,
                    appFee: reviewAppFee,
                    nativeSymbol: reviewNativeSymbol,
                },
                preparation: crossChain.review.preparation,
                routeError: crossChain.routes.error,
                executionError: crossChain.review.executionError,
                confirmDisabled: crossChain.review.confirmDisabled,
                gasAssist: {
                    required: crossChainGasAssistTier === 'required',
                    choice: crossChainGasAssistTier === 'choice',
                    pending: crossChainGasAssistTier === 'pending',
                    expected: crossChainGasAssistExpected,
                    available: crossChainGasAssist?.available === true,
                    status: crossChainGasAssist?.status ?? 'idle',
                    onStart: crossChainGasAssist?.start,
                },
                onClose: crossChain.review.close,
                onConfirm: crossChain.review.confirm,
            },
        },
        derived: { nativeToken, activeQuote, activeQuoteStatus, spendableSellAmount },
    }
}
