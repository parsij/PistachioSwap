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
