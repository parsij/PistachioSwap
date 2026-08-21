const WALLET_CHUNK_PATTERN = /appkit|reown|walletconnect|wagmi|LiveWalletBindings|AppKitProvider/i

export function isWalletBundleFile(fileName) {
    return WALLET_CHUNK_PATTERN.test(String(fileName ?? ''))
}

export function resolveModulePreloadDependencies(_filename, deps) {
    return deps.filter((dep) => !isWalletBundleFile(dep))
}
