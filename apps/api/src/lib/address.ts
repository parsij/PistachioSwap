export const NATIVE_TOKEN_ADDRESS =
    '0x0000000000000000000000000000000000000000'

export function normalizeAddress(
    value: unknown,
): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const address = value.trim().toLowerCase()

    return /^0x[a-f0-9]{40}$/.test(address)
        ? address
        : null
}

export function createTokenId(
    chainId: number,
    address: string,
): string {
    return `${chainId}:${address.toLowerCase()}`
}

export function getMarketAddress({
    address,
    wrappedNativeAddress,
}: {
    address: string
    wrappedNativeAddress: string | null
}): string | null {
    return address === NATIVE_TOKEN_ADDRESS
        ? wrappedNativeAddress
        : normalizeAddress(address)
}
