import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import { describe, expect, it } from 'vitest'
import { encodeFunctionData, erc20Abi, keccak256 as viemKeccak256 } from 'viem'

import {
    describeTransactionReview,
    validateBroadcastTransactionHash,
    validateLocallySignedTransaction,
} from './transactionValidation.js'

const wallet = new Wallet(keccak256(toUtf8Bytes('pistachio-wallet-test-key-not-for-funds')))
const request = {
    type: 0,
    chainId: 56,
    from: wallet.address,
    to: '0x000000000000000000000000000000000000dEaD',
    nonce: 7,
    gas: 55_000,
    gasPrice: 0,
    value: 123,
    data: '0x1234',
}

describe('Pistachio local transaction validation', () => {
    it('recovers the signer and preserves exact EIP-7702 MegaFuel fields', async () => {
        const executor = '0x2222222222222222222222222222222222222222'
        const eip7702Request = {
            type: 4,
            chainId: 56,
            from: wallet.address,
            to: wallet.address,
            nonce: 7,
            gas: 400_000,
            maxFeePerGas: 0,
            maxPriorityFeePerGas: 0,
            value: 0,
            data: '0x1234',
            authorizationList: [{
                chainId: 56,
                address: executor,
                nonce: 8,
            }],
        }
        const signedTransaction = await wallet.signTransaction({
            ...eip7702Request,
            gasLimit: eip7702Request.gas,
        })
        const result = await validateLocallySignedTransaction({
            signedTransaction,
            request: eip7702Request,
            walletAddress: wallet.address,
            mode: 'megafuel',
        })
        expect(result.signer).toBe(wallet.address)
        expect(result.parsed.type).toBe('eip7702')
        expect(result.parsed.maxFeePerGas ?? 0n).toBe(0n)
        expect(result.parsed.authorizationList).toHaveLength(1)
        expect(result.parsed.authorizationList[0].address.toLowerCase()).toBe(executor)
        expect(Number(result.parsed.authorizationList[0].nonce)).toBe(8)
    })

    it('recovers the signer and preserves exact legacy zero-gas fields', async () => {
        const signedTransaction = await wallet.signTransaction({ ...request, gasLimit: request.gas })
        const result = await validateLocallySignedTransaction({ signedTransaction, request, walletAddress: wallet.address, mode: 'megafuel' })
        expect(result.signer).toBe(wallet.address)
        expect(result.parsed.gasPrice ?? 0n).toBe(0n)
        expect(result.parsed.type).toBe('legacy')
    })

    it.each([
        ['wrong signer', { walletAddress: '0x0000000000000000000000000000000000000001' }, 'WALLET_SIGNER_MISMATCH'],
        ['rewritten destination', { request: { ...request, to: '0x0000000000000000000000000000000000000001' } }, 'WALLET_REWROTE_DESTINATION'],
        ['rewritten value', { request: { ...request, value: 124 } }, 'WALLET_REWROTE_VALUE'],
    ])('rejects %s', async (_label, overrides, code) => {
        const signedTransaction = await wallet.signTransaction({ ...request, gasLimit: request.gas })
        await expect(validateLocallySignedTransaction({ signedTransaction, request, walletAddress: wallet.address, mode: 'megafuel', ...overrides })).rejects.toMatchObject({ code })
    })

    it('describes standard token approvals without hiding exact calldata', () => {
        const spender = '0x0000000000000000000000000000000000000001'
        const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender, 123n],
        })
        expect(describeTransactionReview({ ...request, data }, 'normal')).toMatchObject({
            actionType: 'Token approval',
            amount: '123',
            approval: true,
            calldata: data,
            calldataKnown: true,
            spender,
            token: request.to,
            unlimitedWarning: false,
        })
    })

    it('keeps unknown contract data marked for an explicit warning', () => {
        expect(describeTransactionReview(request, 'megafuel')).toMatchObject({
            actionType: 'MegaFuel sponsored transaction',
            calldata: request.data,
            calldataKnown: false,
            gasPrice: '0',
        })
    })

    it('validates an allowlisted non-BNB transaction against its exact chain', async () => {
        const baseRequest = {
            ...request,
            chainId: 8453,
            gasPrice: 1,
        }
        const signedTransaction = await wallet.signTransaction({ ...baseRequest, gasLimit: baseRequest.gas })
        await expect(validateLocallySignedTransaction({
            signedTransaction,
            request: baseRequest,
            walletAddress: wallet.address,
            mode: 'normal',
        })).resolves.toMatchObject({ signer: wallet.address })
        await expect(validateLocallySignedTransaction({
            signedTransaction,
            request: { ...baseRequest, chainId: 1 },
            walletAddress: wallet.address,
            mode: 'normal',
        })).rejects.toMatchObject({ code: 'WALLET_REWROTE_CHAIN_ID' })
        expect(describeTransactionReview(baseRequest, 'normal')).toMatchObject({
            chain: 'Base (8453)',
            actionType: 'Base transaction',
        })
    })

    it('requires the RPC transaction hash to match the signed bytes', async () => {
        const signedTransaction = await wallet.signTransaction({ ...request, gasLimit: request.gas })
        const transactionHash = viemKeccak256(signedTransaction)
        expect(validateBroadcastTransactionHash({ signedTransaction, transactionHash })).toBe(transactionHash)
        expect(() => validateBroadcastTransactionHash({
            signedTransaction,
            transactionHash: `0x${'00'.repeat(32)}`,
        })).toThrowError(expect.objectContaining({ code: 'WALLET_BROADCAST_HASH_MISMATCH' }))
    })
})
