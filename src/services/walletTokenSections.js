export const WALLET_TOKEN_SECTION_STORAGE_NAMESPACE =
    'pistachioswap:wallet-token-sections:v1:'

function storageKey(chainId, scope, section) {
    return `${WALLET_TOKEN_SECTION_STORAGE_NAMESPACE}${Number(chainId)}:${scope}:${section}`
}

export function readWalletTokenSectionExpanded({
    chainId,
    scope,
    section,
    storage = globalThis.localStorage,
}) {
    try {
        return storage?.getItem(storageKey(chainId, scope, section)) === 'expanded'
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
        storage?.setItem(
            storageKey(chainId, scope, section),
            expanded ? 'expanded' : 'collapsed',
        )
    } catch {
        // Browser storage may be unavailable.
    }
    return expanded
}
