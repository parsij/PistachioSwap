import { normalizeAddress } from './address.js'

/*
 * Normal quote platform-fee exemptions only.
 *
 * Gas Assist pricing and sponsorship fees intentionally do not use this list.
 * Keep those fees governed by the Gas Assist service/order economics.
 */
const NORMAL_QUOTE_PLATFORM_FEE_EXEMPT_WALLETS = new Set<string>([
    '0x2941909551c7cefd9ebeb1c5200d8b614cf887ca',
])

export function isNormalQuotePlatformFeeExemptWallet(
    value: unknown,
): boolean {
    const address = normalizeAddress(value)
    return address !== null &&
        NORMAL_QUOTE_PLATFORM_FEE_EXEMPT_WALLETS.has(address)
}
