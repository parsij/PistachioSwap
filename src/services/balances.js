import {
    formatUnits,
    parseEther,
    parseUnits,
    zeroAddress,
} from 'viem'

export const BSC_CHAIN_ID = 56
export const NATIVE_EVM_ADDRESS = zeroAddress
export const NATIVE_BNB_ADDRESS = NATIVE_EVM_ADDRESS
export const DEFAULT_NATIVE_GAS_RESERVE_WEI = parseEther('0.001')

export function isNativeBnbToken(token) {
    return Number(token?.chainId) === BSC_CHAIN_ID &&
        isNativeEvmToken(token)
}

export function isNativeEvmToken(token) {
    return Boolean(token?.isNative) ||
        String(token?.address ?? '').toLowerCase() === NATIVE_EVM_ADDRESS
}

export function getNativeSpendableWei({
    balanceWei,
    estimatedFeeWei = null,
    fallbackReserveWei = DEFAULT_NATIVE_GAS_RESERVE_WEI,
}) {
    const balance = BigInt(balanceWei ?? 0)
    const estimated = estimatedFeeWei == null ? null : BigInt(estimatedFeeWei)
    const reserve = estimated === null
        ? BigInt(fallbackReserveWei)
        : estimated + estimated / 5n
    return balance > reserve ? balance - reserve : 0n
}

export function getTokenBalanceWei(token) {
    if (/^\d+$/.test(String(token?.rawBalance ?? ''))) {
        return BigInt(token.rawBalance)
    }
    try {
        return parseUnits(
            String(token?.balance ?? token?.formattedBalance ?? '0'),
            Number(token?.decimals ?? 18),
        )
    } catch {
        return 0n
    }
}

export function getSpendableTokenAmount({
    token,
    nativeBalanceWei = 0n,
    estimatedFeeWei = null,
    fallbackReserveWei = DEFAULT_NATIVE_GAS_RESERVE_WEI,
}) {
    const decimals = Number(token?.decimals ?? 18)
    if (isNativeEvmToken(token)) {
        return formatUnits(
            getNativeSpendableWei({
                balanceWei: nativeBalanceWei,
                estimatedFeeWei,
                fallbackReserveWei,
            }),
            decimals,
        )
    }
    return formatUnits(getTokenBalanceWei(token), decimals)
}

export function multiplyAmountByPercent(amount, decimals, percent) {
    const units = parseUnits(String(amount || '0'), Number(decimals))
    return formatUnits((units * BigInt(percent)) / 100n, Number(decimals))
}
