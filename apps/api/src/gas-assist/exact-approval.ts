import {
    decodeFunctionData,
    encodeFunctionData,
    isAddressEqual,
    keccak256,
    parseTransaction,
    recoverTransactionAddress,
    serializeTransaction,
    toHex,
    zeroAddress,
} from 'viem'

import { GasAssistError } from './errors.js'

export const UINT256_MAX = (1n << 256n) - 1n
export const APPROVE_SELECTOR = '0x095ea7b3'
export const approveAbi = [
    {
        type: 'function',
        name: 'approve',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const

export function parseAmountIn(value: unknown) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw new GasAssistError('INVALID_AMOUNT', 'amountIn must be a positive integer base-unit string.')
    }
    const amount = BigInt(value)
    if (amount === UINT256_MAX) {
        throw new GasAssistError('UNLIMITED_APPROVAL_FORBIDDEN', 'Unlimited approvals are not sponsorable.')
    }
    return amount
}

export function buildExactApproval(spender: `0x${string}`, amount: bigint) {
    if (spender.toLowerCase() === zeroAddress || amount <= 0n || amount === UINT256_MAX) {
        throw new GasAssistError('UNSAFE_APPROVAL', 'Approval spender and amount must be exact and nonzero.')
    }
    return encodeFunctionData({
        abi: approveAbi,
        functionName: 'approve',
        args: [spender, amount],
    })
}

export function decodeExactApproval(data: `0x${string}`) {
    if (!data.startsWith(APPROVE_SELECTOR) || data.length !== 138) {
        throw new GasAssistError('WRONG_SELECTOR', 'Only approve(address,uint256) calldata is sponsorable.')
    }
    const decoded = decodeFunctionData({ abi: approveAbi, data })
    if (decoded.functionName !== 'approve') {
        throw new GasAssistError('WRONG_SELECTOR', 'Only approve(address,uint256) calldata is sponsorable.')
    }
    const [spender, amount] = decoded.args
    return { spender, amount }
}

export type ExactApprovalTransaction = {
    chainId: 56
    from: `0x${string}`
    to: `0x${string}`
    data: `0x${string}`
    value: '0x0'
    gas: `0x${string}`
    nonce: `0x${string}`
    gasPrice: '0x0'
}

export function unsignedTransactionEvidence(transaction: ExactApprovalTransaction) {
    const serialized = serializeTransaction({
        chainId: transaction.chainId,
        to: transaction.to,
        data: transaction.data,
        value: 0n,
        gas: BigInt(transaction.gas),
        nonce: Number(BigInt(transaction.nonce)),
        gasPrice: 0n,
        type: 'legacy',
    })
    return {
        unsignedTransactionHash: keccak256(serialized),
        calldataHash: keccak256(transaction.data),
    }
}

export async function verifySignedApproval({
    signedTransaction,
    wallet,
    token,
    spender,
    amount,
    nonce,
    gasLimit,
}: {
    signedTransaction: `0x${string}`
    wallet: `0x${string}`
    token: `0x${string}`
    spender: `0x${string}`
    amount: bigint
    nonce: bigint
    gasLimit: bigint
}) {
    let parsed: ReturnType<typeof parseTransaction>
    let signer: `0x${string}`
    try {
        parsed = parseTransaction(signedTransaction)
        signer = await recoverTransactionAddress({
            serializedTransaction: signedTransaction as Parameters<
                typeof recoverTransactionAddress
            >[0]['serializedTransaction'],
        })
    } catch {
        throw new GasAssistError('SIGNED_TRANSACTION_INVALID', 'The signed transaction is invalid.')
    }

    if (!isAddressEqual(signer, wallet)) {
        throw new GasAssistError('WRONG_SIGNER', 'The signed transaction does not belong to the quoted wallet.')
    }
    if (parsed.chainId !== 56) throw new GasAssistError('WRONG_CHAIN', 'The signed transaction chain must be 56.')
    if (!parsed.to || !isAddressEqual(parsed.to, token)) {
        throw new GasAssistError('WRONG_TOKEN_TARGET', 'The signed transaction target does not match the quoted token.')
    }
    if ((parsed.value ?? 0n) !== 0n) {
        throw new GasAssistError('NONZERO_VALUE', 'Sponsored approval value must be zero.')
    }
    if (BigInt(parsed.nonce ?? -1) !== nonce) {
        throw new GasAssistError('WRONG_NONCE', 'The signed transaction nonce does not match the quote.')
    }
    if (!parsed.gas || parsed.gas !== gasLimit) {
        throw new GasAssistError('WRONG_GAS_LIMIT', 'The signed transaction gas limit does not match the quote.')
    }
    if (parsed.type !== 'legacy' || (parsed.gasPrice ?? 0n) !== 0n) {
        throw new GasAssistError('NONZERO_SPONSORED_GAS_PRICE', 'MegaFuel approvals must be legacy transactions with gasPrice zero.')
    }
    if (!parsed.data) throw new GasAssistError('WRONG_SELECTOR', 'Approval calldata is missing.')
    const decoded = decodeExactApproval(parsed.data)
    if (!isAddressEqual(decoded.spender, spender)) {
        throw new GasAssistError('WRONG_SPENDER', 'Approval spender does not match the configured PistachioSwap contract.')
    }
    if (decoded.amount !== amount || decoded.amount === UINT256_MAX) {
        throw new GasAssistError('WRONG_APPROVAL_AMOUNT', 'Approval amount does not match the active swap amount.')
    }
    return { parsed, signer, transactionHash: keccak256(signedTransaction) }
}

export function hashPrivateScope(secret: string, value: string) {
    return keccak256(toHex(`${secret}:${value.toLowerCase()}`))
}
