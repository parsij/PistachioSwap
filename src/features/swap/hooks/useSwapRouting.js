import { parseEther } from 'viem'
import { useSponsorshipConfig } from '../../gas-assist/hooks/useSponsorshipConfig.js'
import { DEFAULT_NATIVE_GAS_RESERVE_WEI } from '../../../services/balances.js'
import { swapUiConfig } from '../../../swapConfig.js'
import {
    deriveRoutingMode,
    deriveSwapExecution,
    CROSS_CHAIN,
    NORMAL_SWAP_MODE,
    PREPAID_SPONSORSHIP_MODE,
    SAME_CHAIN_GASLESS_OR_ASSISTED,
} from '../../../services/swapExecutionMode.js'

function minimumNormalGasBalance() {
    try {
        const parsed = parseEther(String(swapUiConfig.wallet.nativeGasReserve))
        return parsed > 0n ? parsed : DEFAULT_NATIVE_GAS_RESERVE_WEI
    } catch {
        return DEFAULT_NATIVE_GAS_RESERVE_WEI
    }
}

/**
 * Derives the existing same-chain, prepaid Gas Assist, or cross-chain routing mode.
 * @param {object} config Wallet, balance, token, amount, and quote endpoint inputs.
 * @returns {object} Routing mode, preferred execution, prepaid sponsorship config state, and chain flags.
 * @sideEffects Loads prepaid sponsorship configuration only for the eligible BSC state.
 */
export function useSwapRouting({ quoteEndpoint, walletState, nativeBalance, sellToken, buyToken, activeAmountIn }) {
    const sellChainId = Number(sellToken?.chainId ?? walletState.expectedChainId)
    const buyChainId = Number(buyToken?.chainId ?? walletState.expectedChainId)
    const hasMixedSwapChains = Boolean(sellToken && buyToken && sellChainId !== buyChainId)
    const isBscSwap = sellChainId === 56 && buyChainId === 56
    const isBscSource = sellChainId === 56
    const sponsorshipConfig = useSponsorshipConfig({
        quoteEndpoint,
        enabled: Boolean(isBscSource && walletState.isConnected &&
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
        gasAssistConfig: sponsorshipConfig.config,
        gasAssistConfigStatus: sponsorshipConfig.status,
        minimumNativeBalance: minimumNormalGasBalance(),
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
        sponsorshipConfig,
        // Compatibility aliases for the controller while the old 0x hook remains mounted but quote-disabled.
        gasAssistConfig: sponsorshipConfig,
        preferredExecution,
        routingMode: deriveRoutingMode({
            sellChainId,
            buyChainId,
            gasAssistPreferred: preferredExecution.mode === PREPAID_SPONSORSHIP_MODE,
        }),
        modes: {
            CROSS_CHAIN,
            NORMAL_SWAP_MODE,
            PREPAID_SPONSORSHIP_MODE,
            SAME_CHAIN_GASLESS_OR_ASSISTED,
            ZERO_X_GASLESS_MODE: PREPAID_SPONSORSHIP_MODE,
        },
    }
}
