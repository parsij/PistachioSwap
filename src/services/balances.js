import {
    formatUnits,
    parseEther,
    parseUnits,
    zeroAddress,
} from 'viem'

export const BSC_CHAIN_ID = 56
export const NATIVE_EVM_ADDRESS = zeroAddress
export const NATIVE_BNB_ADDRESS = NATIVE_EVM_ADDRESS

/*
 * Used only when no usable live fee estimate exists.
 *
 * The previous 0.001 BNB reserve consumed nearly the entire balance of small
 * wallets. Once a quote exists, the live quote fee is used instead.
 */
export const DEFAULT_NATIVE_GAS_RESERVE_WEI =
    parseEther('0.00005')

export const DEFAULT_NATIVE_GAS_BUFFER_BPS = 2_500

export const DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI =
    parseEther('0.000005')

const BPS_DENOMINATOR = 10_000n
const USD_SCALE_DECIMALS = 18

function toNonNegativeBigInt(
    value,
    fallback = 0n,
) {
    try {
        const parsed = BigInt(value ?? 0)

        return parsed >= 0n
            ? parsed
            : fallback
    } catch {
        return fallback
    }
}

function normalizeDecimal(
    value,
    maximumDecimals = USD_SCALE_DECIMALS,
) {
    if (
        typeof value !== 'string' &&
        typeof value !== 'number'
    ) {
        return null
    }

    const text = String(value).trim()

    const match = text.match(
        /^(\d+)(?:\.(\d+))?$/u,
    )

    if (!match) return null

    const whole = match[1]

    const fraction = (
        match[2] ?? ''
    ).slice(0, maximumDecimals)

    const normalized =
        fraction.length > 0
            ? `${whole}.${fraction}`
            : whole

    try {
        return BigInt(
            parseUnits(
                normalized,
                maximumDecimals,
            ),
        ) > 0n
            ? normalized
            : null
    } catch {
        return null
    }
}

function ceilDivide(
    numerator,
    denominator,
) {
    if (denominator <= 0n) {
        return 0n
    }

    return (
        numerator +
        denominator -
        1n
    ) / denominator
}

export function isNativeBnbToken(token) {
    return (
        Number(token?.chainId) ===
        BSC_CHAIN_ID &&
        isNativeEvmToken(token)
    )
}

export function isNativeEvmToken(token) {
    return (
        Boolean(token?.isNative) ||
        String(
            token?.address ?? '',
        ).toLowerCase() ===
        NATIVE_EVM_ADDRESS
    )
}

/**
 * Converts a USD fee estimate into native-token base units.
 *
 * Fixed-point BigInt arithmetic is used throughout. The final result rounds
 * upward so decimal truncation cannot cause the app to under-reserve gas.
 */
export function convertUsdToNativeWei({
                                          usdAmount,
                                          nativeUsdPrice,
                                          nativeDecimals = 18,
                                      }) {
    const normalizedUsdAmount =
        normalizeDecimal(usdAmount)

    const normalizedNativePrice =
        normalizeDecimal(nativeUsdPrice)

    const decimals =
        Number(nativeDecimals)

    if (
        !normalizedUsdAmount ||
        !normalizedNativePrice ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255
    ) {
        return null
    }

    const usdAmountScaled =
        parseUnits(
            normalizedUsdAmount,
            USD_SCALE_DECIMALS,
        )

    const nativePriceScaled =
        parseUnits(
            normalizedNativePrice,
            USD_SCALE_DECIMALS,
        )

    if (
        usdAmountScaled <= 0n ||
        nativePriceScaled <= 0n
    ) {
        return null
    }

    return ceilDivide(
        usdAmountScaled *
        10n ** BigInt(decimals),

        nativePriceScaled,
    )
}

export function getNativeGasReserveWei({
                                           estimatedFeeWei = null,
                                           fallbackReserveWei =
                                           DEFAULT_NATIVE_GAS_RESERVE_WEI,
                                           gasBufferBps =
                                           DEFAULT_NATIVE_GAS_BUFFER_BPS,
                                           minimumGasBufferWei =
                                           DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
                                       } = {}) {
    const fallback =
        toNonNegativeBigInt(
            fallbackReserveWei,
            DEFAULT_NATIVE_GAS_RESERVE_WEI,
        )

    if (estimatedFeeWei == null) {
        return fallback
    }

    const estimated =
        toNonNegativeBigInt(
            estimatedFeeWei,
        )

    if (estimated <= 0n) {
        return fallback
    }

    const normalizedBufferBps =
        Number.isFinite(
            Number(gasBufferBps),
        )
            ? Math.max(
                0,
                Math.trunc(
                    Number(gasBufferBps),
                ),
            )
            : DEFAULT_NATIVE_GAS_BUFFER_BPS

    const percentageBuffer =
        ceilDivide(
            estimated *
            BigInt(
                normalizedBufferBps,
            ),

            BPS_DENOMINATOR,
        )

    const minimumBuffer =
        toNonNegativeBigInt(
            minimumGasBufferWei,
            DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
        )

    const buffer =
        percentageBuffer >
        minimumBuffer
            ? percentageBuffer
            : minimumBuffer

    return estimated + buffer
}

export function getNativeSpendableWei({
                                          balanceWei,
                                          estimatedFeeWei = null,
                                          fallbackReserveWei =
                                          DEFAULT_NATIVE_GAS_RESERVE_WEI,
                                          gasBufferBps =
                                          DEFAULT_NATIVE_GAS_BUFFER_BPS,
                                          minimumGasBufferWei =
                                          DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
                                      }) {
    const balance =
        toNonNegativeBigInt(
            balanceWei,
        )

    const reserve =
        getNativeGasReserveWei({
            estimatedFeeWei,
            fallbackReserveWei,
            gasBufferBps,
            minimumGasBufferWei,
        })

    return balance > reserve
        ? balance - reserve
        : 0n
}

export function getTokenBalanceWei(token) {
    if (
        /^\d+$/.test(
            String(
                token?.rawBalance ?? '',
            ),
        )
    ) {
        return BigInt(
            token.rawBalance,
        )
    }

    try {
        return parseUnits(
            String(
                token?.balance ??
                token?.formattedBalance ??
                '0',
            ),

            Number(
                token?.decimals ?? 18,
            ),
        )
    } catch {
        return 0n
    }
}

export function getSpendableTokenAmount({
                                            token,
                                            nativeBalanceWei = 0n,
                                            estimatedFeeWei = null,
                                            fallbackReserveWei =
                                            DEFAULT_NATIVE_GAS_RESERVE_WEI,
                                            gasBufferBps =
                                            DEFAULT_NATIVE_GAS_BUFFER_BPS,
                                            minimumGasBufferWei =
                                            DEFAULT_MIN_NATIVE_GAS_BUFFER_WEI,
                                        }) {
    const decimals =
        Number(
            token?.decimals ?? 18,
        )

    if (isNativeEvmToken(token)) {
        return formatUnits(
            getNativeSpendableWei({
                balanceWei:
                nativeBalanceWei,

                estimatedFeeWei,

                fallbackReserveWei,

                gasBufferBps,

                minimumGasBufferWei,
            }),

            decimals,
        )
    }

    return formatUnits(
        getTokenBalanceWei(token),
        decimals,
    )
}

export function multiplyAmountByPercent(
    amount,
    decimals,
    percent,
) {
    const normalizedDecimals =
        Number(decimals)

    const units =
        parseUnits(
            String(amount || '0'),
            normalizedDecimals,
        )

    return formatUnits(
        (
            units *
            BigInt(percent)
        ) / 100n,

        normalizedDecimals,
    )
}