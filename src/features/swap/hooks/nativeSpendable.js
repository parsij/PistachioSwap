import { parseEther } from 'viem'
import { DEFAULT_NATIVE_GAS_RESERVE_WEI, DEFAULT_NATIVE_GAS_BUFFER_BPS, DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI, getSpendableTokenAmount } from '../../../services/balances.js'

export function getSpendableAmount(
    token,
    nativeBalanceWei,
    {
        estimatedFeeWei = null,
        fallbackReserveWei =
        DEFAULT_NATIVE_GAS_RESERVE_WEI,
        gasBufferBps =
        DEFAULT_NATIVE_GAS_BUFFER_BPS,
        minimumGasBufferWei =
        DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
    } = {},
) {
    if (!token) return '0'

    return getSpendableTokenAmount({
        token,
        nativeBalanceWei:
            nativeBalanceWei ??
            0n,
        estimatedFeeWei,
        fallbackReserveWei,
        gasBufferBps,
        minimumGasBufferWei,
    })
}

export function parseNativeReserve(
    value,
    fallback = DEFAULT_NATIVE_GAS_RESERVE_WEI,
) {
    try {
        return parseEther(String(value))
    } catch {
        return fallback
    }
}

export function nativeReserveConfiguration(walletConfig) {
    return {
        configuredNativeReserveWei: parseNativeReserve(walletConfig.nativeGasReserve, DEFAULT_NATIVE_GAS_RESERVE_WEI),
        minimumNativeGasBufferWei: parseNativeReserve(walletConfig.minimumNativeGasBuffer, DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI),
        nativeGasBufferBps: Number.isFinite(Number(walletConfig.nativeGasBufferBps))
            ? Math.max(0, Math.trunc(Number(walletConfig.nativeGasBufferBps))) : DEFAULT_NATIVE_GAS_BUFFER_BPS,
    }
}
