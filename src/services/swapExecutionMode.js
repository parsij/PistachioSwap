import { isAddress } from 'viem'

export const NORMAL_SWAP_MODE = 'normal'
export const ZERO_X_GASLESS_MODE = 'zero-x-gasless'

export function getSwapExecutionMessage(reason) {
    return {
        'native-balance-loading': 'Checking native BNB balance…',
        'native-balance-error': 'Native BNB balance could not be loaded.',
        'gas-assist-config-loading': 'Checking Gas Assist availability…',
        'gas-assist-config-error': 'Gas Assist configuration could not be loaded.',
        'gas-assist-disabled': 'Gas Assist is currently disabled.',
        'native-sell-token': 'Gas Assist cannot sell the native gas token.',
    }[reason] ?? null
}

export function deriveSwapExecution({
    isConnected,
    walletAddress,
    chainId,
    nativeBalanceStatus,
    nativeBalance,
    sellToken,
    buyToken,
    sellAmount,
    gasAssistConfig,
    gasAssistConfigStatus,
}) {
    if (!isConnected || !walletAddress) return { mode: null, reason: 'wallet-unavailable' }
    if (chainId !== 56) return { mode: null, reason: 'wrong-chain' }
    if (nativeBalanceStatus === 'idle' || nativeBalanceStatus === 'loading') {
        return { mode: null, reason: 'native-balance-loading' }
    }
    if (nativeBalanceStatus !== 'success' || typeof nativeBalance !== 'bigint') {
        return { mode: null, reason: 'native-balance-error' }
    }
    if (
        !sellToken ||
        !buyToken ||
        !isAddress(sellToken.address ?? '') ||
        !isAddress(buyToken.address ?? '') ||
        !Number.isInteger(Number(sellToken.decimals)) ||
        Number(sellToken.decimals) < 0 ||
        Number(sellToken.decimals) > 255 ||
        !Number.isInteger(Number(buyToken.decimals)) ||
        Number(buyToken.decimals) < 0 ||
        Number(buyToken.decimals) > 255
    ) {
        return { mode: null, reason: 'invalid-token' }
    }
    if (!sellAmount || !/^\d+$/.test(sellAmount) || BigInt(sellAmount) <= 0n) {
        return { mode: null, reason: 'invalid-amount' }
    }
    if (nativeBalance > 0n) return { mode: NORMAL_SWAP_MODE, reason: null }
    if (sellToken.isNative) return { mode: null, reason: 'native-sell-token' }
    if (gasAssistConfigStatus === 'idle' || gasAssistConfigStatus === 'loading') {
        return { mode: null, reason: 'gas-assist-config-loading' }
    }
    if (gasAssistConfigStatus === 'error') return { mode: null, reason: 'gas-assist-config-error' }
    if (gasAssistConfig?.enabled !== true || gasAssistConfig?.mode !== ZERO_X_GASLESS_MODE) {
        return { mode: null, reason: 'gas-assist-disabled' }
    }
    return { mode: ZERO_X_GASLESS_MODE, reason: null }
}
