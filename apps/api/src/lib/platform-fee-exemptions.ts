import { normalizeAddress } from './address.js'

/*
 * Normal quote platform-fee exemptions only.
 *
 * Gas Assist commercial fee exemptions are enforced independently in the
 * private Gas-Assist backend. Keep these addresses synchronized there;
 * client-side quote exemptions never authorize sponsorship or waive gas.
 */
const NORMAL_QUOTE_PLATFORM_FEE_EXEMPT_WALLETS = new Set<string>([
    '0x2941909551c7cefd9ebeb1c5200d8b614cf887ca',
    '0x153812707d3999ad579c477e1a034b077013d4bf',
])

export function isNormalQuotePlatformFeeExemptWallet(
    value: unknown,
): boolean {
    const address = normalizeAddress(value)
    return address !== null &&
        NORMAL_QUOTE_PLATFORM_FEE_EXEMPT_WALLETS.has(address)
}
