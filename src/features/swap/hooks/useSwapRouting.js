import { useGasAssistConfig } from '../../gas-assist/hooks/useGasAssistConfig.js'
import {
    deriveRoutingMode,
    deriveSwapExecution,
    CROSS_CHAIN,
    NORMAL_SWAP_MODE,
    SAME_CHAIN_GASLESS_OR_ASSISTED,
    ZERO_X_GASLESS_MODE,
} from '../../../services/swapExecutionMode.js'

/**
 * Derives the existing same-chain, Gas Assist, or cross-chain routing mode.
 * @param {object} config Wallet, balance, token, amount, and quote endpoint inputs.
 * @returns {object} Routing mode, preferred execution, Gas Assist config state, and chain flags.
 * @sideEffects Loads Gas Assist configuration only for the existing eligible BSC state.
 */
export function useSwapRouting({ quoteEndpoint, walletState, nativeBalance, sellToken, buyToken, activeAmountIn }) {
    const sellChainId = Number(sellToken?.chainId ?? walletState.expectedChainId)
    const buyChainId = Number(buyToken?.chainId ?? walletState.expectedChainId)
    const hasMixedSwapChains = Boolean(sellToken && buyToken && sellChainId !== buyChainId)
    const isBscSwap = sellChainId === 56 && buyChainId === 56
    const gasAssistConfig = useGasAssistConfig({
        quoteEndpoint,
        enabled: Boolean(isBscSwap && !hasMixedSwapChains && walletState.isConnected &&
            walletState.address && walletState.chainId === 56),
    })
    const bscExecution = deriveSwapExecution({
        isConnected: walletState.isConnected,
        walletAddress: walletState.address,
        chainId: walletState.chainId,
        nativeBalanceStatus: nativeBalance.status,
        nativeBalance: nativeBalance.value,
        sellToken,
        buyToken,
        sellAmount: activeAmountIn,
        gasAssistConfig: gasAssistConfig.config,
        gasAssistConfigStatus: gasAssistConfig.status,
    })
    const nonBscExecution = nativeBalance.status === 'success'
        ? { mode: NORMAL_SWAP_MODE, reason: null }
        : {
            mode: null,
            reason: nativeBalance.status === 'error' ? 'native-balance-error' : 'native-balance-loading',
        }
    const preferredExecution = isBscSwap && !hasMixedSwapChains ? bscExecution : nonBscExecution
    return {
        sellChainId,
        buyChainId,
        hasMixedSwapChains,
        isBscSwap,
        gasAssistConfig,
        preferredExecution,
        routingMode: deriveRoutingMode({
            sellChainId,
            buyChainId,
            gasAssistPreferred: preferredExecution.mode === ZERO_X_GASLESS_MODE,
        }),
        modes: { CROSS_CHAIN, NORMAL_SWAP_MODE, SAME_CHAIN_GASLESS_OR_ASSISTED, ZERO_X_GASLESS_MODE },
    }
}
