import { parseEther } from 'viem'
import {
    DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
    DEFAULT_NATIVE_GAS_BUFFER_BPS,
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    convertUsdToNativeWei,
    getSpendableTokenAmount,
    isNativeEvmToken,
} from '../../../services/balances.js'
import { formatSlippageBps } from '../../settings/services/swapSettings.js'
import {
    addDecimalStrings,
    formatTokenAmount,
    getProviderDisplayName,
} from '../../cross-chain/services/crossChainRoutes.js'
import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { formatCompactRate, formatCostUsd } from './swapDisplay.js'
function positiveBigInt(value) {
    if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'bigint'
    ) {
        return null
    }

    try {
        const parsed = BigInt(value)

        return parsed > 0n
            ? parsed
            : null
    } catch {
        return null
    }
}

function trustedTokenUsdPrice(token) {
    if (!token) return null

    const confidence =
        String(
            token.priceConfidence ?? '',
        )
            .trim()
            .toLowerCase()

    /*
     * Preserve the existing trusted-price policy. Market-only and explicitly
     * untrusted values must not control transaction balance calculations.
     */
    if (
        confidence === 'market' ||
        confidence === 'untrusted'
    ) {
        return null
    }

    const candidate =
        token.trustedPriceUSD ??
        token.priceUSD ??
        null

    if (
        typeof candidate !== 'string' &&
        typeof candidate !== 'number'
    ) {
        return null
    }

    const normalized =
        String(candidate).trim()

    if (
        !/^\d+(?:\.\d+)?$/u.test(
            normalized,
        )
    ) {
        return null
    }

    return Number(normalized) > 0
        ? normalized
        : null
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
        gasAssist, crossChain, receipt, eligibility, review, execution, effectiveSlippageBps,
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
    const estimatedSwapFeeWei = (() => {
        const selectedQuote =
            activeQuote?.selectedQuote ??
            quote.quote?.selectedQuote ??
            null

        if (!selectedQuote) {
            return null
        }

        const transaction =
            selectedQuote.transaction ??
            {}

        const gasUnits =
            positiveBigInt(
                transaction.gas ??
                selectedQuote.estimatedGas,
            )

        const gasPriceWei =
            positiveBigInt(
                transaction.gasPrice ??
                transaction.maxFeePerGas ??
                selectedQuote.gasPrice ??
                selectedQuote.estimatedGasPrice,
            )

        /*
         * Prefer exact native-unit math when the provider supplies gas units and
         * gas price.
         */
        if (
            gasUnits &&
            gasPriceWei
        ) {
            return (
                gasUnits *
                gasPriceWei
            )
        }

        /*
         * Current normalized Uniswap quotes usually expose estimatedGasUsd but
         * omit gasPrice. Convert that USD fee back into BNB using the trusted
         * native-token price.
         */
        const nativePriceToken =
            nativeToken ??
            (
                isNativeEvmToken(
                    sellToken,
                )
                    ? sellToken
                    : null
            )

        return convertUsdToNativeWei({
            usdAmount:
            selectedQuote
                .estimatedGasUsd,

            nativeUsdPrice:
                trustedTokenUsdPrice(
                    nativePriceToken,
                ),

            nativeDecimals:
                Number(
                    nativePriceToken
                        ?.decimals ??
                    18,
                ),
        })
    })()

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
                fallbackNativeReserveWei,

                gasBufferBps:
                nativeGasBufferBps,

                minimumGasBufferWei:
                minimumNativeGasBufferWei,
            })
            : '0'
    const quoteProvider = routing.routingMode === routing.modes.CROSS_CHAIN
        ? crossChain.currentRoute ? getProviderDisplayName(crossChain.currentRoute.provider) : null
        : activeQuote?.selectedQuote?.provider ?? null
    const crossChainCosts = crossChain.currentRoute?.costs ?? null
    const estimatedTotalCost = formatCostUsd(crossChainCosts?.totalEstimatedUsd, true)
    const estimatedRouteCost = formatCostUsd(crossChainCosts?.routeCostUsd, true)
    const sourceGasCost = formatCostUsd(crossChainCosts?.sourceGasUsd, true)
    const sameChainNetworkCost = activeQuote?.selectedQuote?.estimatedGasUsd
        ? `$${activeQuote.selectedQuote.estimatedGasUsd}`
        : activeQuote?.selectedQuote ? 'Included' : null
    const minimumReceived = routing.routingMode === routing.modes.CROSS_CHAIN
        ? crossChain.currentRoute && buyToken
            ? `${formatTokenAmount(crossChain.currentRoute.minimumOutputAmount, buyToken.decimals)} ${buyToken.symbol}`
            : null
        : activeQuote?.selectedQuote?.minimumBuyAmount && buyToken
            ? `${formatTokenAmount(activeQuote.selectedQuote.minimumBuyAmount, buyToken.decimals)} ${buyToken.symbol}`
            : null
    const maximumSold = activeQuote?.selectedQuote?.maximumSellAmount && sellToken
        ? `${formatTokenAmount(activeQuote.selectedQuote.maximumSellAmount, sellToken.decimals)} ${sellToken.symbol}`
        : sellToken && inputs.sellAmount ? `${inputs.sellAmount} ${sellToken.symbol}` : null
    const platformFee = activeQuote?.selectedQuote?.platformFee
    const serviceFee = platformFee?.amount && platformFee.amount !== '0'
        ? `${formatTokenAmount(
            platformFee.amount,
            platformFee.token === sellToken?.address ? sellToken?.decimals : buyToken?.decimals,
        )} ${platformFee.token === sellToken?.address ? sellToken?.symbol : buyToken?.symbol}${(platformFee.effectiveBps ?? platformFee.bps) > 0 ? ` (${((platformFee.effectiveBps ?? platformFee.bps) / 100).toFixed(2)}%)` : ''}`
        : platformFee?.bps > 0 ? `${(platformFee.effectiveBps ?? platformFee.bps) / 100}%` : routing.routingMode !== routing.modes.CROSS_CHAIN ? 'Free' : null
    const crossChainAppFee = crossChainCosts?.appFeeUsd === '0' ? 'Free' : formatCostUsd(crossChainCosts?.appFeeUsd)
    const reviewCosts = crossChain.review.route?.costs ?? null
    const reviewProviderCosts = addDecimalStrings([reviewCosts?.providerFeeUsd, reviewCosts?.destinationGasUsd])
    const reviewTotalCost = formatCostUsd(reviewCosts?.totalEstimatedUsd, true)
    const reviewRouteCost = formatCostUsd(reviewCosts?.routeCostUsd, true)
    const reviewNativeSymbol = getCuratedEvmChain(crossChain.review.route?.sourceChainId)?.nativeCurrency.symbol ?? nativeSymbol
    const reviewSourceGas = formatCostUsd(reviewCosts?.sourceGasUsd, true) ??
        (reviewCosts?.sourceGasNative ? `~${reviewCosts.sourceGasNative} ${reviewNativeSymbol}` : null)
    const reviewAppFee = reviewCosts?.appFeeUsd === '0' ? 'Free' : formatCostUsd(reviewCosts?.appFeeUsd)
    const sameChainConfirmLabel = {
        'checking-approval': 'Checking token approval...',
        'checking-token-approval': 'Checking token approval...',
        'approving-token': 'Approve token in your wallet',
        'checking-pancake-authorization': 'Checking PancakeSwap authorization...',
        'renewing-pancake-authorization': 'Renew PancakeSwap authorization in your wallet...',
        'waiting-pancake-authorization': 'Waiting for authorization confirmation...',
        'refreshing-quote': 'Refreshing price...',
        simulating: 'Simulating swap...',
        submitting: 'Confirm swap in your wallet',
        'waiting-confirmation': 'Waiting for confirmation...',
    }[review.reviewOperation] ?? 'Confirm swap'
    const sameChainConfirmDisabled = execution.isConfirming || review.reviewOperation !== 'idle' ||
        receipt.transactionStatus === 'pending' || receipt.transactionStatus === 'submitted'
    const compactRate = sellToken && buyToken
        ? formatCompactRate(inputs.sellAmount, sellToken.symbol, inputs.buyAmount, buyToken.symbol)
        : 'Rate unavailable'
    const balanceNotice = catalog.walletTokenError
        ? 'Wallet balances could not be loaded.'
        : catalog.walletTokenStale === true
            ? 'Showing previously loaded balances.'
            : catalog.walletTokenFailedChainIds.length > 0
                ? 'Some network balances could not be refreshed.'
                : null

    return {
        header: {
            brand,
            navigation,
            searchLabel: copy.searchLabel,
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
                    action: eligibility.action,
                    reducedMotion,
                    triggerRef: review.triggerRef,
                    onAction: callbacks.onPrimaryAction,
                },
                details: {
                    open: quoteDetailsOpen,
                    onOpenChange: setQuoteDetailsOpen,
                    rate: compactRate,
                    mode: routing.routingMode === routing.modes.CROSS_CHAIN ? 'cross-chain' : 'same-chain',
                    sameChain: { visible: activeQuoteStatus === 'success' && Boolean(sellToken && buyToken), serviceFee, networkCost: sameChainNetworkCost },
                    crossChain: crossChain.currentRoute ? {
                        route: crossChain.currentRoute,
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
                        minimumReceived,
                    } : null,
                    slippage: { auto: swapSettings.slippageMode === 'auto', label: formatSlippageBps(effectiveSlippageBps) },
                    provider: quoteProvider,
                    exactOutputMaximum: inputs.activeAmountSide === 'buy' && routing.routingMode !== routing.modes.CROSS_CHAIN
                        ? maximumSold
                        : null,
                },
                gasAssistBanner: gasAssist.isGasless
                    ? { quote: gasAssist.gasAssist.quote, sellToken, buyToken }
                    : null,
                status: {
                    nativeBalanceError: catalog.nativeBalance.status === 'error' && walletState.isConnected && walletState.isCorrectNetwork,
                    nativeSymbol,
                    executionMessage: context.executionMessage,
                    showExecutionMessage: catalog.nativeBalance.value === 0n,
                    statusMessage,
                },
            },
            tokenSelector: {
                open: Boolean(catalog.selector.side),
                selectorProps: {
                    side: catalog.selector.side,
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
                approval: {
                    dialog: gasAssist.gasAssist.dialog,
                    buyToken,
                    token: sellToken,
                    amount: inputs.sellAmount,
                    onClose: gasAssist.gasAssist.close,
                    onConfirm: gasAssist.gasAssist.confirm,
                },
                prepayment: {
                    key: gasAssist.prepaidSponsorship.order?.id ?? 'prepaid-sponsorship',
                    props: { sponsorship: gasAssist.prepaidSponsorship, sellToken, buyToken },
                },
            },
            sameChainReview: {
                open: review.isOpen,
                onOpenChange: review.handleOpenChange,
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
                open: Boolean(crossChain.review.route),
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
                onClose: crossChain.review.close,
                onConfirm: crossChain.review.confirm,
            },
        },
        derived: { nativeToken, activeQuote, activeQuoteStatus, spendableSellAmount },
    }
}
