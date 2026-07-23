import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppKit, useAppKitNetwork } from '@reown/appkit/react'
import { useReducedMotion } from 'motion/react'
import { useConfig, usePublicClient, useSendTransaction } from 'wagmi'
import { parseEther } from 'viem'
import { useSwapSettings } from '../../settings/hooks/useSwapSettings.js'
import { useWalletState } from '../../wallet/hooks/useWalletState.js'
import { useTokenCatalogController } from '../../tokens/hooks/useTokenCatalogController.js'
import { useSwapInputs } from './useSwapInputs.js'
import { useSwapRouting } from './useSwapRouting.js'
import { useSwapQuote } from './useSwapQuote.js'
import { useSameChainReview } from './useSameChainReview.js'
import { useSameChainExecution } from './useSameChainExecution.js'
import { useSameChainReceiptLifecycle } from './useSameChainReceiptLifecycle.js'
import { useApprovalExecutionBridge } from './useApprovalExecutionBridge.js'
import { useGasAssistController } from '../../gas-assist/hooks/useGasAssistController.js'
import { useCrossChainController } from '../../cross-chain/hooks/useCrossChainController.js'
import { useSwapApproval } from '../../approvals/hooks/useSwapApproval.js'
import { useSwapPrimaryAction } from './useSwapPrimaryAction.js'
import { deriveSwapEligibility } from '../model/swapEligibility.js'
import { createSwapViewModel } from '../model/swapViewModel.js'
import { decimalToUnits } from '../model/amountMath.js'
import { getEffectiveSlippageBps } from '../../settings/services/swapSettings.js'
import { getSwapExecutionMessage } from '../../../services/swapExecutionMode.js'
import {
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    getSpendableTokenAmount,
} from '../../../services/balances.js'
import { fetchSwapQuote } from '../services/quotes.js'
import { createCssVariables, swapUiConfig } from '../../../swapConfig.js'
import {
    approvalMetadataDiagnostic,
    executionErrorSnapshot,
    logSwapDiagnostic,
    quoteDiagnostic,
    requestKeySuffix,
    transactionDiagnostic,
} from '../../../shared/logging/swapDiagnostics.js'

/**
 * Composes focused swap, token, approval, Gas Assist, cross-chain, wallet, and settings hooks into page view models.
 *
 * @returns {{layoutStyle: object, header: object, page: object}} App-shell presentation contract.
 * @sideEffects Delegated hooks perform existing backend requests/RPC reads; wallet prompts occur only after explicit semantic actions.
 * @throws Expected operational errors are mapped by feature hooks to visible state; render-time configuration errors may still throw.
 * @security Keeps account/chain/token/quote intent bound across review, approval, refresh, simulation, and submission.
 */
export function useSwapController() {
    const config = swapUiConfig
    const { chain, crossChain: crossChainConfig, quote: quoteConfig, tokens: tokensConfig, wallet: walletConfig, tabs } = config
    const layoutStyle = useMemo(() => createCssVariables(), [])
    const reducedMotion = useReducedMotion()
    const [swapChainId, setSwapChainId] = useState(Number(tokensConfig.initialSellToken?.chainId ?? chain.id))
    const [statusMessage, setStatusMessage] = useState(null)
    const [quoteDetailsOpen, setQuoteDetailsOpen] = useState(true)
    const { open: openAppKit } = useAppKit()
    const { switchNetwork } = useAppKitNetwork()
    const wagmiConfig = useConfig()
    const publicClient = usePublicClient({ chainId: swapChainId })
    const { mutateAsync: sendTransaction } = useSendTransaction()
    const walletState = useWalletState(swapChainId)
    const [swapSettings, setSwapSettings] = useSwapSettings()
    const catalog = useTokenCatalogController({ swapChainId, walletState, tokensConfig })
    const inputs = useSwapInputs({
        tokensConfig,
        tabs,
        availableTokens: catalog.availableTokens,
        swapChainId,
        setSwapChainId,
        fallbackChainLogo: catalog.fallbackChainLogo,
        setVisibleStatus: setStatusMessage,
        diagnostic: logSwapDiagnostic,
    })
    const routing = useSwapRouting({
        quoteEndpoint: quoteConfig.endpoint,
        walletState: { ...walletState, expectedChainId: swapChainId },
        nativeBalance: catalog.nativeBalance,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        activeAmountIn: inputs.activeAmountIn,
    })
    const configuredSlippageBps = getEffectiveSlippageBps(swapSettings, {
        recommendedSlippageBps: null,
        defaultSlippageBps: quoteConfig.defaultSlippageBps,
    })

    const quote = useSwapQuote({
        endpoint: quoteConfig.endpoint,
        debounceMs: quoteConfig.debounceMs,
        chainId: swapChainId,
        walletState,
        walletAddress: walletState.address,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        sellChainId: routing.sellChainId,
        buyChainId: routing.buyChainId,
        activeAmountSide: inputs.activeAmountSide,
        activeAmountIn: inputs.activeAmountIn,
        activeBuyAmountIn: inputs.activeBuyAmountIn,
        sellInputDenomination: inputs.sellInputDenomination,
        buyInputDenomination: inputs.buyInputDenomination,
        sellDisplayPrice: inputs.sellDisplayPrice,
        buyDisplayPrice: inputs.buyDisplayPrice,
        configuredSlippageBps,
        routingMode: routing.routingMode,
        crossChainMode: routing.modes.CROSS_CHAIN,
        gasAssistMode: routing.modes.SAME_CHAIN_GASLESS_OR_ASSISTED,
        setSellAmount: inputs.setSellAmount,
        setBuyAmount: inputs.setBuyAmount,
        setVisibleStatus: setStatusMessage,
        diagnostic: logSwapDiagnostic,
    })
    const effectiveSlippageBps = getEffectiveSlippageBps(swapSettings, {
        recommendedSlippageBps: quote.providerRecommendedSlippageBps,
        defaultSlippageBps: quoteConfig.defaultSlippageBps,
    })
    const review = useSameChainReview({
        diagnostic: logSwapDiagnostic,
        requestKeySuffix,
        requestKey: quote.snapshot?.requestKey ?? null,
        selectedQuote: quote.quote?.selectedQuote,
    })

    const handleApprovalConfirmed = useCallback(() => {
        setStatusMessage('Approval confirmed. Preparing the swap.')
        void catalog.refreshWalletBalances()
    }, [catalog.refreshWalletBalances])
    const handleApprovalDiagnostic = useCallback((event, payload = {}, level = 'debug') => {
        const operation = {
            'approval.erc20.read.start': 'checking-token-approval',
            'approval.erc20.wallet-prompt.requested': 'approving-token',
            'approval.permit2.read.start': 'checking-pancake-authorization',
            'approval.permit2.renewal.required': 'renewing-pancake-authorization',
            'approval.permit2.wallet-prompt.requested': 'renewing-pancake-authorization',
            'approval.permit2.receipt.waiting': 'waiting-pancake-authorization',
        }[event]
        if (operation) review.setReviewOperation(operation)
        logSwapDiagnostic(event, {
            requestKeySuffix: requestKeySuffix(quote.getCurrentRequestKey()),
            quote: quoteDiagnostic(quote.quote),
            ...payload,
        }, level)
    }, [quote, review])
    const approval = useSwapApproval({
        quoteEndpoint: quoteConfig.endpoint,
        quote: routing.isBscSwap ? quote.quote : null,
        walletAddress: walletState.address,
        sellToken: inputs.sellToken,
        amountIn: inputs.activeAmountIn,
        chainId: swapChainId,
        enabled: false,
        onApprovalConfirmed: handleApprovalConfirmed,
        onDiagnostic: handleApprovalDiagnostic,
    })
    const executionApproval = useApprovalExecutionBridge({
        prepareSwapApproval: approval.prepareSwapApproval,
        getLastPreparationResult: approval.getLastPreparationResult,
        quote: quote.quote,
        publicClient,
        walletAddress: walletState.address,
        sellToken: inputs.sellToken,
        diagnostic: logSwapDiagnostic,
    })
    const gasAssist = useGasAssistController({
        routingMode: routing.routingMode,
        gasAssistRoutingMode: routing.modes.SAME_CHAIN_GASLESS_OR_ASSISTED,
        normalMode: routing.modes.NORMAL_SWAP_MODE,
        gaslessMode: routing.modes.ZERO_X_GASLESS_MODE,
        quoteEndpoint: quoteConfig.endpoint,
        account: walletState.address,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        sellChainId: routing.sellChainId,
        buyChainId: routing.buyChainId,
        activeAmountIn: inputs.activeAmountIn,
        activeAmountSide: inputs.activeAmountSide,
        configuredSlippageBps,
        gasAssistConfig: routing.gasAssistConfig,
        refreshIndex: quote.refreshIndex,
        normalQuote: quote.quote,
        normalQuoteStatus: quote.quoteStatus,
        buyInputDenomination: inputs.buyInputDenomination,
        setBuyAmount: inputs.setBuyAmount,
        setVisibleStatus: setStatusMessage,
        onConfirmed: handleApprovalConfirmed,
    })
    const receipt = useSameChainReceiptLifecycle({
        chainId: swapChainId,
        account: walletState.address,
        walletChainId: walletState.chainId,
        executionMode: gasAssist.executionMode,
        setVisibleStatus: setStatusMessage,
        closeReview: review.closeReview,
        resetInputsAfterSuccess: inputs.resetInputsAfterSuccess,
        invalidateQuoteAfterSuccess: quote.invalidateQuoteAfterSuccess,
        refreshWalletBalances: catalog.refreshWalletBalances,
        setReviewError: review.setReviewError,
        setReviewOperation: review.setReviewOperation,
        diagnostic: logSwapDiagnostic,
    })
    const nativeToken = catalog.walletTokens.find((token) => token.isNative === true && Number(token.chainId) === swapChainId) ?? null
    const crossChain = useCrossChainController({
        enabledMode: routing.modes.CROSS_CHAIN,
        routingMode: routing.routingMode,
        endpoint: crossChainConfig.endpoint,
        providerConfigurationVersion: crossChainConfig.providerConfigurationVersion,
        account: walletState.address,
        walletState,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        sellChainId: routing.sellChainId,
        buyChainId: routing.buyChainId,
        activeAmountSide: inputs.activeAmountSide,
        activeAmountIn: inputs.activeAmountIn,
        activeBuyAmountIn: inputs.activeBuyAmountIn,
        configuredSlippageBps,
        debounceMs: quoteConfig.debounceMs,
        buyInputDenomination: inputs.buyInputDenomination,
        setBuyAmount: inputs.setBuyAmount,
        setVisibleStatus: setStatusMessage,
        transactionStatus: receipt.transactionStatus,
        setTransactionStatus: receipt.setTransactionStatus,
        publicClient,
        wagmiConfig,
        switchNetwork,
        nativeBalance: catalog.nativeBalance,
        nativeToken,
    })
    const activeQuote = routing.routingMode === routing.modes.CROSS_CHAIN ? crossChain.currentRoute : gasAssist.activeQuote
    const activeQuoteStatus = routing.routingMode === routing.modes.CROSS_CHAIN ? crossChain.quoteStatus : gasAssist.activeQuoteStatus
    const eligibility = deriveSwapEligibility({
        walletState,
        walletAddress: walletState.address,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        activeAmountSide: inputs.activeAmountSide,
        activeAmountIn: inputs.activeAmountIn,
        activeBuyAmountIn: inputs.activeBuyAmountIn,
        sellAmount: inputs.sellAmount,
        buyAmount: inputs.buyAmount,
        sellDisplayPrice: inputs.sellDisplayPrice,
        buyDisplayPrice: inputs.buyDisplayPrice,
        routingMode: routing.routingMode,
        crossChainMode: routing.modes.CROSS_CHAIN,
        gaslessMode: routing.modes.ZERO_X_GASLESS_MODE,
        executionMode: gasAssist.executionMode,
        quote: quote.quote,
        activeQuote,
        activeQuoteStatus,
        currentCrossChainRoute: crossChain.currentRoute,
        crossChainRouteExpired: crossChain.routeExpired,
        crossChainExactOutputUnsupported: crossChain.exactOutputUnsupported,
        transactionStatus: receipt.transactionStatus,
        nativeBalanceValue: catalog.nativeBalance.value,
        nativeGasReserve: walletConfig.nativeGasReserve,
        maxCostToInputBps: quoteConfig.maxCostToInputBps,
        swapChainId,
        sellChainId: routing.sellChainId,
        buyChainId: routing.buyChainId,
        quoteSnapshot: quote.snapshot,
        quoteInputKey: quote.quoteInputKey,
        prepaidRequired: gasAssist.prepaidRequired,
        prepaidEnabled: gasAssist.prepaidSponsorship.config?.enabled,
        activeChainName: swapChainId === Number(chain.id) ? chain.name : catalog.activeChain?.name,
    })
    const execution = useSameChainExecution({
        account: walletState.address,
        chainId: swapChainId,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        quote: quote.quote,
        quoteSnapshot: quote.snapshot,
        quoteEndpoint: quoteConfig.endpoint,
        requireSuccessfulSimulation: quoteConfig.requireSuccessfulSimulationBeforeSend,
        prepareSwapApproval: executionApproval.prepareExecutionApproval,
        getLastPreparationResult: executionApproval.getExecutionApprovalResult,
        invalidatePermit2Readiness: approval.invalidatePermit2Readiness,
        fetchQuote: fetchSwapQuote,
        getCurrentRequestKey: quote.getCurrentRequestKey,
        applyRefreshedQuote: quote.applyRefreshedQuote,
        publicClient,
        sendTransaction,
        transactionStatus: receipt.transactionStatus,
        reviewOperation: review.reviewOperation,
        setReviewOperation: review.setReviewOperation,
        setReviewError: review.setReviewError,
        setVisibleStatus: setStatusMessage,
        setTransactionStatus: receipt.setTransactionStatus,
        setTransactionHash: receipt.setTransactionHash,
        setReviewConfirmationPending: review.setConfirmationPending,
        diagnostic: logSwapDiagnostic,
        requestKeySuffix,
        quoteDiagnostic,
        approvalMetadataDiagnostic,
        transactionDiagnostic,
        executionErrorSnapshot,
    })
    const primaryAction = useSwapPrimaryAction({
        action: eligibility.action,
        activeQuoteStatus,
        transactionStatus: receipt.transactionStatus,
        routingMode: routing.routingMode,
        crossChainMode: routing.modes.CROSS_CHAIN,
        executionMode: gasAssist.executionMode,
        gaslessMode: routing.modes.ZERO_X_GASLESS_MODE,
        reviewEligibility: eligibility.reviewEligibility,
        insufficientFunds: eligibility.insufficientFunds,
        economicallyInvalid: eligibility.economicallyInvalid,
        quoteSnapshot: quote.snapshot,
        quoteInputKey: quote.quoteInputKey,
        quote: quote.quote,
        activeChain: catalog.activeChain,
        activeChainName: swapChainId === Number(chain.id) ? chain.name : catalog.activeChain?.name,
        openAppKit,
        switchNetwork,
        crossChain,
        gasAssist: gasAssist.gasAssist,
        prepaid: {
            required: gasAssist.prepaidRequired,
            enabled: gasAssist.prepaidSponsorship.config?.enabled,
            start: gasAssist.prepaidSponsorship.start,
        },
        refreshSameChainQuote: quote.refreshQuote,
        clearSameChainQuoteForRefresh: quote.clearQuoteForRefresh,
        openSameChainReview: review.openReview,
        setReviewError: review.setReviewError,
        setReviewOperation: review.setReviewOperation,
        setVisibleStatus: setStatusMessage,
        confirmExecution: execution.confirmSameChainSwap,
        diagnostic: logSwapDiagnostic,
    })

    const quoteModeDiagnosticRef = useRef(null)
    useEffect(() => {
        if (!import.meta.env.DEV) return
        const crossChainRequested = routing.routingMode === routing.modes.CROSS_CHAIN
        const gasAssistRequested = routing.routingMode === routing.modes.SAME_CHAIN_GASLESS_OR_ASSISTED
        const completed = crossChainRequested
            ? ['review', 'quoted', 'error'].includes(crossChain.routes.phase)
            : gasAssistRequested
                ? ['success', 'error'].includes(gasAssist.gasAssist.quoteStatus)
                : ['success', 'error'].includes(quote.quoteStatus)
        if (!completed) return
        const diagnostic = {
            quoteMode: crossChainRequested ? 'cross-chain' : gasAssistRequested ? 'gas-assist' : 'same-chain',
            sourceChainId: routing.sellChainId,
            destinationChainId: routing.buyChainId,
            sameChainRequested: !crossChainRequested && !gasAssistRequested,
            crossChainRequested,
            gasAssistRequested,
        }
        const signature = JSON.stringify({
            ...diagnostic,
            requestKey: crossChainRequested ? crossChain.requestKey : quote.snapshot?.requestKey ?? null,
        })
        if (quoteModeDiagnosticRef.current === signature) return
        quoteModeDiagnosticRef.current = signature
        logSwapDiagnostic('quote.mode.selected', diagnostic)
    }, [crossChain.requestKey, crossChain.routes.phase, gasAssist.gasAssist.quoteStatus, quote.quoteStatus,
        quote.snapshot?.requestKey, routing.buyChainId, routing.modes, routing.routingMode, routing.sellChainId])

    const resetQuoteAndReview = useCallback(() => {
        quote.resetQuote()
        review.closeReview()
    }, [quote, review])
    const callbacks = {
        onSettingsChange: setSwapSettings,
        onSellAmountChange: (event) => inputs.updateSellAmount(event.target.value),
        onBuyAmountChange: (event) => inputs.updateBuyAmount(event.target.value),
        onOpenSellTokenSelector: () => catalog.selector.open('sell', inputs.sellToken),
        onOpenBuyTokenSelector: () => catalog.selector.open('buy', inputs.buyToken),
        onToggleSellDenomination: () => inputs.toggleDenomination('sell'),
        onToggleBuyDenomination: () => inputs.toggleDenomination('buy'),
        onQuickAmountSelect: (value) => inputs.setTokenAmountFromUnits(
            'sell', decimalToUnits(value, Number(inputs.sellToken?.decimals ?? 18)) ?? '0',
        ),
        onUseMaximumBalance: () => {
            inputs.setTokenAmountFromUnits('sell', decimalToUnits(
                getSpendableAmount(inputs.sellToken, catalog.nativeBalance.value, quote.quote, walletConfig.nativeGasReserve),
                Number(inputs.sellToken?.decimals ?? 18),
            ) ?? '0')
        },
        onSwitchTokens: () => {
            inputs.switchTokens()
            resetQuoteAndReview()
        },
        onTokenSelect: (token) => {
            inputs.selectToken({ token, side: catalog.selector.side, selectorChainId: catalog.selector.chainId })
            catalog.selector.close()
            resetQuoteAndReview()
        },
        onPrimaryAction: primaryAction.performPrimaryAction,
        onConfirmSameChainSwap: primaryAction.confirmSameChainSwap,
    }
    const executionMessage = routing.routingMode === routing.modes.SAME_CHAIN_GASLESS_OR_ASSISTED
        ? getSwapExecutionMessage(routing.preferredExecution.reason)
        : null
    const viewModel = createSwapViewModel({
        config,
        reducedMotion,
        walletState,
        swapSettings,
        swapChainId,
        catalog,
        inputs,
        routing,
        quote,
        gasAssist,
        crossChain,
        receipt,
        eligibility,
        review,
        execution,
        effectiveSlippageBps,
        statusMessage,
        quoteDetailsOpen,
        setQuoteDetailsOpen,
        callbacks,
        executionMessage,
    })
    return { layoutStyle, header: viewModel.header, page: viewModel.page }
}

function getSpendableAmount(token, nativeBalanceWei, quote, nativeGasReserve) {
    if (!token) return '0'
    const transaction = quote?.selectedQuote?.transaction
    let estimatedFeeWei = null
    try {
        if (transaction?.gas != null && transaction?.gasPrice != null) {
            estimatedFeeWei = BigInt(transaction.gas) * BigInt(transaction.gasPrice)
        }
    } catch {
        estimatedFeeWei = null
    }
    return getSpendableTokenAmount({
        token,
        nativeBalanceWei: nativeBalanceWei ?? 0n,
        estimatedFeeWei,
        fallbackReserveWei: parseNativeReserve(nativeGasReserve),
    })
}

function parseNativeReserve(value) {
    try {
        return parseEther(value)
    } catch {
        return DEFAULT_NATIVE_GAS_RESERVE_WEI
    }
}
