import { getApiConfig } from '../config.js'
import { NATIVE_TOKEN_ADDRESS } from '../lib/address.js'
import type {
    CrossChainFee,
    CrossChainProviderName,
} from './types.js'

export type PlatformFeeConfiguration = {
    bps: number
    recipient: string | null
}

export function getPlatformFeeConfiguration(
    provider: CrossChainProviderName,
): PlatformFeeConfiguration {
    const fees = getApiConfig().fees
    if (fees.platformFeeBps === 0) return { bps: 0, recipient: null }
    if (
        !fees.treasuryAddress ||
        fees.treasuryAddress === NATIVE_TOKEN_ADDRESS
    ) {
        throw new Error(`${provider} is incompatible: platform fee recipient is unavailable.`)
    }
    if (!['across', 'debridge-dln', 'relay'].includes(provider)) {
        throw new Error(`${provider} is incompatible with configured platform fees.`)
    }
    return { bps: fees.platformFeeBps, recipient: fees.treasuryAddress }
}

export function platformFeeIncompatibility(
    provider: CrossChainProviderName,
): string | null {
    try {
        getPlatformFeeConfiguration(provider)
        return null
    } catch (error) {
        return error instanceof Error ? error.message : 'Platform fee is incompatible.'
    }
}

export function bpsAsRatio(bps: number) {
    return decimalFraction(bps, 4)
}

export function bpsAsPercent(bps: number) {
    return decimalFraction(bps, 2)
}

function decimalFraction(value: number, decimalPlaces: number) {
    if (!Number.isInteger(value) || value < 0) throw new Error('Invalid fee BPS.')
    const digits = value.toString().padStart(decimalPlaces + 1, '0')
    const whole = digits.slice(0, -decimalPlaces)
    const fraction = digits.slice(-decimalPlaces).replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}

export function platformFeeEntry({
    bps,
    token,
    baseAmount,
    includedInQuote = true,
}: {
    bps: number
    token: string
    baseAmount: string
    includedInQuote?: boolean
}): CrossChainFee | null {
    if (bps === 0) return null
    const amount = (BigInt(baseAmount) * BigInt(bps) / 10_000n).toString()
    return {
        type: 'platform',
        token,
        amount,
        includedInQuote,
    }
}
