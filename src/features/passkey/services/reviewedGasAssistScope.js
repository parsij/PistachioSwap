import { getAddress, isAddress } from 'viem'
import { isGasAssistSourceChainId } from '../../gas-assist/model/gasAssistChains.js'

const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const MAX_SCOPE_MS = 2 * 60_000
const FIELDS = [
    ['sender', 'address'], ['nonce', 'uint256'], ['initCode', 'bytes'],
    ['callData', 'bytes'], ['accountGasLimits', 'bytes32'],
    ['preVerificationGas', 'uint256'], ['gasFees', 'bytes32'],
    ['paymasterAndData', 'bytes'],
]
const sameAddress = (left, right) => isAddress(left ?? '') && isAddress(right ?? '') &&
    getAddress(left) === getAddress(right)

/** In-memory, one-operation scope. Created only after the first-party swap review
 * and full prepared-batch validation; deliberately not exposed by the provider RPC.
 * It binds the actual batch, wallet, chain, delegate and Paymaster, never just a
 * message title or primaryType. It grants neither normal sends nor arbitrary data signing.
 */
export function createReviewedGasAssistScope(input, { walletAddress, vaultId, trustedDelegate, now = Date.now() }) {
    const expiresAt = Math.min(Date.parse(input?.expiresAt), now + MAX_SCOPE_MS)
    if (!input?.orderId || !vaultId || !sameAddress(input.walletAddress, walletAddress) ||
        !isGasAssistSourceChainId(Number(input.chainId)) ||
        !sameAddress(input.delegate, trustedDelegate) || !isAddress(input.paymaster ?? '') ||
        !/^0x(?:[0-9a-f]{2}){4,}$/iu.test(input.callData ?? '') ||
        !Number.isFinite(expiresAt) || expiresAt <= now) {
        throw Object.assign(new Error('The reviewed smart swap is invalid or expired.'), { code: 'PISTACHIO_REVIEWED_SWAP_INVALID' })
    }
    return {
        id: crypto.randomUUID(), vaultId, walletAddress: getAddress(walletAddress),
        chainId: Number(input.chainId), delegate: getAddress(input.delegate),
        paymaster: getAddress(input.paymaster), callData: input.callData.toLowerCase(),
        expiresAt, authorizationSigned: false,
    }
}

export function matchesReviewedGasAssistAuthorization(scope, request) {
    return Boolean(scope && !scope.authorizationSigned && !request?.data?.previousDelegate &&
        request?.type === 'eip7702Auth' && Number(request.data.chainId) === scope.chainId &&
        sameAddress(request.data.address, scope.delegate))
}

export function matchesReviewedGasAssistUserOperation(scope, value) {
    if (!scope?.authorizationSigned) return false
    try {
        const typed = typeof value === 'string' ? JSON.parse(value) : value
        const fields = typed?.types?.PackedUserOperation
        const message = typed?.message
        return typed?.primaryType === 'PackedUserOperation' &&
            typed.domain?.name === 'ERC4337' && typed.domain?.version === '1' &&
            Number(typed.domain?.chainId) === scope.chainId &&
            sameAddress(typed.domain?.verifyingContract, ENTRY_POINT) &&
            Object.keys(typed.domain).every((key) => ['name', 'version', 'chainId', 'verifyingContract'].includes(key)) &&
            Object.keys(typed.types).every((key) => ['EIP712Domain', 'PackedUserOperation'].includes(key)) &&
            Array.isArray(fields) && fields.length === FIELDS.length &&
            fields.every((field, i) => field.name === FIELDS[i][0] && field.type === FIELDS[i][1]) &&
            Object.keys(message).length === FIELDS.length && FIELDS.every(([name]) => name in message) &&
            sameAddress(message.sender, scope.walletAddress) &&
            String(message.initCode).toLowerCase() === scope.delegate.toLowerCase() &&
            String(message.callData).toLowerCase() === scope.callData &&
            /^0x[0-9a-f]{64}$/iu.test(message.accountGasLimits) &&
            /^0x[0-9a-f]{64}$/iu.test(message.gasFees) &&
            /^0x(?:[0-9a-f]{2}){53,}$/iu.test(message.paymasterAndData) &&
            message.paymasterAndData.slice(0, 42).toLowerCase() === scope.paymaster.toLowerCase() &&
            BigInt(message.nonce) >= 0n && BigInt(message.nonce) < (1n << 256n) &&
            BigInt(message.preVerificationGas) >= 0n && BigInt(message.preVerificationGas) < (1n << 256n)
    } catch {
        return false
    }
}
