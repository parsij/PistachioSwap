export const WALLET_TOKEN_SECTION_STORAGE_NAMESPACE =
    'pistachioswap:wallet-token-sections:v1:'

function storageKey(chainId, scope, section) {
    const normalizedChainId = String(chainId).trim().toLowerCase() === 'all'
        ? 'all'
        : Number(chainId)
    if (
        normalizedChainId !== 'all' &&
        (!Number.isSafeInteger(normalizedChainId) || normalizedChainId <= 0)
    ) {
        return null
    }
    return `${WALLET_TOKEN_SECTION_STORAGE_NAMESPACE}${normalizedChainId}:${scope}:${section}`
}

/** Reads the saved expanded state for one wallet-token section without throwing on unavailable storage. */
export function readWalletTokenSectionExpanded({
    chainId,
    scope,
    section,
    storage = globalThis.localStorage,
}) {
    try {
        const key = storageKey(chainId, scope, section)
        return key !== null && storage?.getItem(key) === 'expanded'
    } catch {
        return false
    }
}

/** Persists one wallet-token section's expanded state and returns the requested state. */
export function writeWalletTokenSectionExpanded({
    chainId,
    scope,
    section,
    expanded,
    storage = globalThis.localStorage,
}) {
    try {
        const key = storageKey(chainId, scope, section)
        if (key !== null) {
            storage?.setItem(
                key,
                expanded ? 'expanded' : 'collapsed',
            )
        }
    } catch {
        // Browser storage may be unavailable.
    }
    return expanded
}
