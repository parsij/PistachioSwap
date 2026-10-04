import { isAddress } from 'viem'

export const NORMAL_SWAP_MODE = 'normal'
export const PREPAID_SPONSORSHIP_MODE = 'prepaid-sponsorship'
export const SAME_CHAIN_STANDARD = 'SAME_CHAIN_STANDARD'
export const SAME_CHAIN_GAS_ASSIST = 'SAME_CHAIN_GAS_ASSIST'
export const CROSS_CHAIN = 'CROSS_CHAIN'
export const GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE =
    'Gas Assist will be used because the wallet does not have enough native gas for normal gas.'

export function deriveRoutingMode({
    sellChainId,
    buyChainId,
    gasAssistPreferred = false,
}) {
    if (Number(sellChainId) !== Number(buyChainId)) return CROSS_CHAIN
    return gasAssistPreferred
        ? SAME_CHAIN_GAS_ASSIST
        : SAME_CHAIN_STANDARD
}

export function getSwapExecutionMessage(reason) {
    return {
        'native-balance-loading': 'Checking native gas balance…',
        'native-balance-error': 'Native gas balance could not be loaded.',
        'gas-assist-config-loading': 'Not enough native gas for normal gas. Checking Gas Assist availability…',
        'gas-assist-config-error': 'Not enough native gas for normal gas. Gas Assist availability could not be checked.',
        'gas-assist-disabled': 'Not enough native gas for normal gas. Gas Assist is currently unavailable.',
        'insufficient-native-balance': GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE,
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
    minimumNativeBalance = 1n,
}) {
    if (!isConnected || !walletAddress) return { mode: null, reason: 'wallet-unavailable' }
    if (Number(sellToken?.chainId ?? chainId) !== Number(chainId) ||
        (gasAssistConfig?.chainId !== undefined && Number(gasAssistConfig.chainId) !== Number(chainId))) return { mode: null, reason: 'wrong-chain' }
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
    let requiredNativeBalance = 1n
    try {
        const parsed = BigInt(minimumNativeBalance)
        if (parsed > 0n) requiredNativeBalance = parsed
    } catch {
        requiredNativeBalance = 1n
    }
    if (nativeBalance >= requiredNativeBalance) return { mode: NORMAL_SWAP_MODE, reason: null }
    if (gasAssistConfig?.supported === false) return { mode: null, reason: 'insufficient-native-balance' }
    if (sellToken.isNative) return { mode: null, reason: 'native-sell-token' }

    // Once a same-chain wallet is below the normal gas reserve, never fall
    // back into an ordinary approval/swap. A disabled or temporarily unavailable
    // sponsorship service must fail closed in the assisted lane; otherwise the
    // wallet tries to estimate/send a transaction it cannot pay gas for.
    if (gasAssistConfigStatus === 'idle' || gasAssistConfigStatus === 'loading') {
        return { mode: PREPAID_SPONSORSHIP_MODE, reason: 'gas-assist-config-loading' }
    }
    if (gasAssistConfigStatus === 'error') {
        return { mode: PREPAID_SPONSORSHIP_MODE, reason: 'gas-assist-config-error' }
    }
    if (gasAssistConfig?.enabled !== true) {
        return { mode: PREPAID_SPONSORSHIP_MODE, reason: 'gas-assist-disabled' }
    }
    return { mode: PREPAID_SPONSORSHIP_MODE, reason: 'insufficient-native-balance' }
}
