import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../../../lib/address.js'
import { ProviderError } from '../../../lib/errors.js'
import { isCuratedEvmChainId } from '../../../chains.js'

export const ZERO_X_NATIVE_TOKEN_ADDRESS =
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export type ProviderTokenIdentity = {
    chainId: number
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
        !isCuratedEvmChainId(chainId) ||
        !normalized ||
        isNative !== (normalized === NATIVE_TOKEN_ADDRESS)
    ) {
        throw new ProviderError({
            code: 'PROVIDER_TOKEN_INVALID',
            message: 'Token identity must use an enabled chain and the canonical native-token sentinel.',
            statusCode: 400,
            outcome: 'validation',
        })
    }

    return {
        chainId,
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
