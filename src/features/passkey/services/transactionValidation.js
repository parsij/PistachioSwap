import {
    decodeFunctionData,
    erc20Abi,
    getAddress,
    keccak256,
    parseTransaction,
    recoverTransactionAddress,
} from 'viem'

import { getCuratedEvmChain, isCuratedEvmChainId } from '../../../web3/curatedEvmChains.js'

function mismatch(code, message) {
    const error = new Error(message)
    error.code = code
    throw error
}

function quantity(value, fallback = 0n) {
    return value === undefined || value === null ? fallback : BigInt(value)
}

function normalizedAddress(value) {
    try {
        return value ? getAddress(value) : null
    } catch {
        return null
    }
}

/**
 * Parses locally signed bytes and proves chain, sender, target, value, and calldata match the reviewed request.
 * @returns {Promise<object>} Parsed transaction and recovered signer evidence.
 * @throws A passkey transaction mismatch error before broadcast.
 */
export async function validateLocallySignedTransaction({ signedTransaction, request, walletAddress, mode }) {
    let parsed
    let signer
    try {
        parsed = parseTransaction(signedTransaction)
        signer = await recoverTransactionAddress({ serializedTransaction: signedTransaction })
    } catch {
        mismatch('WALLET_RAW_TRANSACTION_MALFORMED', 'The locally signed transaction is malformed.')
    }
    if (normalizedAddress(signer) !== normalizedAddress(walletAddress)) mismatch('WALLET_SIGNER_MISMATCH', 'The signed transaction account changed.')
    const requestedChainId = Number(request.chainId)
    if (!isCuratedEvmChainId(requestedChainId) || parsed.chainId !== requestedChainId) mismatch('WALLET_REWROTE_CHAIN_ID', 'The signed transaction chain changed.')
    if (mode === 'megafuel' && parsed.chainId !== 56) mismatch('WALLET_REWROTE_CHAIN_ID', 'MegaFuel transactions must remain on BNB Smart Chain.')
    if (normalizedAddress(parsed.to) !== normalizedAddress(request.to)) mismatch('WALLET_REWROTE_DESTINATION', 'The signed transaction destination changed.')
    if (BigInt(parsed.nonce) !== quantity(request.nonce)) mismatch('WALLET_REWROTE_NONCE', 'The signed transaction nonce changed.')
    if (parsed.gas !== quantity(request.gas ?? request.gasLimit)) mismatch('WALLET_REWROTE_GAS_LIMIT', 'The signed transaction gas limit changed.')
    if ((parsed.value ?? 0n) !== quantity(request.value)) mismatch('WALLET_REWROTE_VALUE', 'The signed transaction value changed.')
    if ((parsed.data ?? '0x').toLowerCase() !== String(request.data ?? '0x').toLowerCase()) mismatch('WALLET_REWROTE_CALLDATA', 'The signed transaction calldata changed.')
    if (mode === 'megafuel') {
        if (parsed.type !== 'legacy') mismatch('WALLET_REWROTE_TRANSACTION_TYPE', 'MegaFuel requires a legacy transaction.')
        if ((parsed.gasPrice ?? 0n) !== 0n) mismatch('WALLET_REWROTE_GAS_PRICE', 'MegaFuel gas price changed from zero.')
        if (parsed.maxFeePerGas != null || parsed.maxPriorityFeePerGas != null) mismatch('WALLET_ADDED_EIP1559_FIELDS', 'MegaFuel transaction gained EIP-1559 fields.')
        if (parsed.accessList?.length) mismatch('WALLET_ADDED_ACCESS_LIST', 'MegaFuel transaction gained an access list.')
    } else if (Number(request.type ?? 0) === 0 && (parsed.gasPrice ?? 0n) !== quantity(request.gasPrice)) {
        mismatch('WALLET_REWROTE_GAS_PRICE', 'The signed transaction gas price changed.')
    } else if (Number(request.type) === 2 && (
        parsed.maxFeePerGas !== quantity(request.maxFeePerGas) ||
        parsed.maxPriorityFeePerGas !== quantity(request.maxPriorityFeePerGas)
    )) {
        mismatch('WALLET_REWROTE_FEES', 'The signed transaction fee fields changed.')
    }
    return { signer: getAddress(signer), parsed }
}

/** Verifies the RPC-returned hash equals the deterministic hash of locally signed bytes. */
export function validateBroadcastTransactionHash({ signedTransaction, transactionHash }) {
    const expectedHash = keccak256(signedTransaction)
    if (String(transactionHash).toLowerCase() !== expectedHash.toLowerCase()) {
        mismatch('WALLET_BROADCAST_HASH_MISMATCH', 'The RPC returned a transaction hash that does not match the signed transaction.')
    }
    return expectedHash
}

/** Returns the stable, human-readable transaction fields shown by the passkey review UI. */
export function describeTransactionReview(transaction, mode) {
    const data = String(transaction.data ?? '0x')
    let tokenCall = null
    try {
        const decoded = decodeFunctionData({ abi: erc20Abi, data })
        if (decoded.functionName === 'approve' || decoded.functionName === 'transfer') {
            tokenCall = { functionName: decoded.functionName, args: decoded.args }
        }
    } catch {
        // Unknown contract data remains visible in the review.
    }
    const approval = tokenCall?.functionName === 'approve'
    const transfer = tokenCall?.functionName === 'transfer'
    const amount = approval || transfer ? BigInt(tokenCall.args[1]) : null
    const unlimited = (1n << 256n) - 1n
    const chain = getCuratedEvmChain(transaction.chainId)
    if (!chain) mismatch('PISTACHIO_CHAIN_NOT_ALLOWED', 'This network is not enabled in PistachioSwap.')
    return {
        actionType: mode === 'megafuel' ? 'MegaFuel sponsored transaction' : approval ? 'Token approval' : transfer ? 'Token transfer' : `${chain.name} transaction`,
        chain: `${chain.name} (${chain.id})`,
        destination: transaction.to ?? null,
        value: String(transaction.value ?? '0'),
        gasLimit: String(transaction.gas ?? transaction.gasLimit ?? ''),
        gasPrice: String(transaction.gasPrice ?? ''),
        calldata: data,
        calldataKnown: Boolean(tokenCall),
        token: tokenCall ? transaction.to : null,
        recipient: transfer ? getAddress(tokenCall.args[0]) : null,
        spender: approval ? getAddress(tokenCall.args[0]) : null,
        amount: amount?.toString() ?? null,
        approval,
        unlimitedWarning: approval && amount === unlimited,
        submission: mode === 'megafuel' ? 'PistachioSwap will submit this signed transaction.' : `A chain-specific public ${chain.name} RPC will broadcast after approval.`,
    }
}
