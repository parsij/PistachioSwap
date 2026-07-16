import {
    hashTypedData,
    isHex,
    parseSignature,
    verifyTypedData,
    type Address,
    type Hex,
} from 'viem'

import { GasAssistError } from './errors.js'
import type { ZeroXTypedData } from './types.js'

export function normalizeZeroXTypedData(value: ZeroXTypedData) {
    if (
        !value ||
        typeof value.primaryType !== 'string' ||
        !value.types?.[value.primaryType] ||
        !value.domain ||
        !value.message
    ) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned invalid typed data.', 502)
    }
    const { EIP712Domain: _domain, ...types } = value.types
    return {
        domain: value.domain,
        types,
        primaryType: value.primaryType,
        message: value.message,
    }
}

export function hashZeroXTypedData(value: ZeroXTypedData) {
    return hashTypedData(normalizeZeroXTypedData(value) as never)
}

export async function verifyZeroXSignature(
    typedData: ZeroXTypedData,
    signature: string,
    wallet: string,
) {
    if (!isHex(signature) || signature.length !== 132) {
        throw new GasAssistError('SIGNATURE_INVALID', 'The typed-data signature is invalid.')
    }
    const valid = await verifyTypedData({
        address: wallet as Address,
        ...normalizeZeroXTypedData(typedData),
        signature: signature as Hex,
    } as never)
    if (!valid) throw new GasAssistError('SIGNER_MISMATCH', 'The signature does not match the quoted wallet.', 403)
}

export function splitZeroXSignature(signature: string) {
    if (!isHex(signature) || signature.length !== 132) {
        throw new GasAssistError('SIGNATURE_INVALID', 'The typed-data signature is invalid.')
    }
    const parsed = parseSignature(signature as Hex)
    if (!parsed.r || !parsed.s || parsed.yParity === undefined) {
        throw new GasAssistError('SIGNATURE_INVALID', 'The typed-data signature is invalid.')
    }
    return {
        signatureType: 2,
        v: parsed.yParity + 27,
        r: parsed.r,
        s: parsed.s,
    }
}
