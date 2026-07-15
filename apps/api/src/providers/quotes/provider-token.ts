import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'

export const ZERO_X_NATIVE_TOKEN_ADDRESS =
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export type ProviderTokenIdentity = {
    chainId: 56
    address: string
    isNative: boolean
    internal: string
    zeroX: string
    uniswap: string
    pancake:
        | { kind: 'native' }
        | { kind: 'erc20'; address: string }
}

export function normalizeProviderToken({
    chainId,
    address,
    isNative,
}: {
    chainId: number
    address: string
    isNative: boolean
}): ProviderTokenIdentity {
    const normalized = normalizeAddress(address)

    if (
        chainId !== 56 ||
        !normalized ||
        isNative !== (normalized === NATIVE_TOKEN_ADDRESS)
    ) {
        throw new ProviderError({
            code: 'PROVIDER_TOKEN_INVALID',
            message: 'Token identity must use chain 56 and the canonical native-token sentinel.',
            statusCode: 400,
            outcome: 'validation',
        })
    }

    return {
        chainId: 56,
        address: normalized,
        isNative,
        internal: normalized,
        zeroX: isNative ? ZERO_X_NATIVE_TOKEN_ADDRESS : normalized,
        uniswap: normalized,
        pancake: isNative
            ? { kind: 'native' }
            : { kind: 'erc20', address: normalized },
    }
}
