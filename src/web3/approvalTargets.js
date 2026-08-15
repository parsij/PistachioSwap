/*
 * Uniswap's Permit2 is deployed at one deterministic address on every chain
 * this app supports. Pinning it here means a quote response cannot nominate its
 * own contract as the Permit2 allowance holder: every other check on the
 * approval metadata compares fields of the response to other fields of the same
 * response, so without an external constant a single malicious or compromised
 * quote fully controls what the user is asked to approve.
 */
export const CANONICAL_PERMIT2_ADDRESS =
    '0x000000000022d473030f116ddee9f6b43ac78ba3'

/**
 * Reports whether an address is the canonical Permit2 contract.
 * @param {unknown} value Address supplied by a quote response.
 * @returns {boolean} True only for the deterministic Permit2 deployment.
 */
export function isCanonicalPermit2Address(value) {
    return String(value ?? '').trim().toLowerCase() === CANONICAL_PERMIT2_ADDRESS
}
