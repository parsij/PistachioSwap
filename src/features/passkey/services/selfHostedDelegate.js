// Public build-time pin; backend configuration cannot choose the wallet's delegate.
export function selfHostedDelegateAddress(chainId) {
    return import.meta.env[`VITE_CHECKED_7702_ACCOUNT_ADDRESS_${Number(chainId)}`] ??
        import.meta.env.VITE_SIMPLE_7702_ACCOUNT_ADDRESS
}
