import { describe, expect, it, vi } from 'vitest'

import { GasAssistError } from '../src/gas-assist/errors.js'
import { gaslessInternals } from '../src/gas-assist/gasless-service.js'
import {
    splitZeroXSignature,
    verifyZeroXSignature,
} from '../src/gas-assist/signature-verification.js'
import { UINT256_MAX, ZEROX_NATIVE_TOKEN } from '../src/gas-assist/types.js'
import { createZeroXGaslessClient } from '../src/providers/zero-x/gasless-client.js'
import { createApp } from '../src/app.js'

const wallet = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'
const tradeSignature = '0x94033d6aa58e1dbb64548a86d18b03278ad165e1168a5b6c6ac15703ac97028140e42c3bb873f58bd4517a96b7e00ccbab68af7ff1f95ec8384cef8f3dab260e1b'
const otherSignerTradeSignature = '0xf03c822fa5032654e26c68a0dc1cbc148e2d73710b755811cd9b2c2983f626c13fa81a0c6f10f8caf4b09fe97c42d870d1fd3fe9ed7bbcb98883d65bd42b77ef1b'
const token = '0x0000000000000000000000000000000000000011'
const permit2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const settler = '0x0000000000000000000000000000000000000022'
const deadline = '2000000000'

function approval(value = '1000000') {
    return {
        type: 'permit',
        hash: `0x${'aa'.repeat(32)}`,
        eip712: {
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' },
                ],
                Permit: [
                    { name: 'owner', type: 'address' },
                    { name: 'spender', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            },
            domain: { name: 'Token', version: '1', chainId: 56, verifyingContract: token },
            primaryType: 'Permit',
            message: { owner: wallet, spender: permit2, value, nonce: '0', deadline },
        },
    }
}

function trade() {
    const eip712 = {
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ],
            TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
            SlippageAndActions: [
                { name: 'recipient', type: 'address' },
                { name: 'buyToken', type: 'address' },
                { name: 'minAmountOut', type: 'uint256' },
                { name: 'actions', type: 'bytes[]' },
            ],
            PermitWitnessTransferFrom: [
                { name: 'permitted', type: 'TokenPermissions' },
                { name: 'spender', type: 'address' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
                { name: 'slippageAndActions', type: 'SlippageAndActions' },
            ],
        },
        domain: { name: 'Permit2', chainId: 56, verifyingContract: permit2 },
        primaryType: 'PermitWitnessTransferFrom',
        message: {
            permitted: { token, amount: '1000000' },
            spender: settler,
            nonce: '1',
            deadline,
            slippageAndActions: {
                recipient: wallet,
                buyToken: ZEROX_NATIVE_TOKEN,
                minAmountOut: '900000000000000',
                actions: ['0x'],
            },
        },
    }
    return { type: 'settler_metatransaction', hash: gaslessInternals.hashZeroXTypedData(eip712), eip712 }
}

function quote(overrides: Record<string, unknown> = {}) {
    return {
        zid: '0x111111111111111111111111',
        allowanceTarget: null,
        approval: null,
        buyAmount: '1000000000000000',
        buyToken: ZEROX_NATIVE_TOKEN,
        fees: { integratorFee: null, gasFee: { amount: '1000', token }, zeroExFee: { amount: '1000', token } },
        issues: { allowance: null, balance: null, simulationIncomplete: false, invalidSourcesPassed: [] },
        liquidityAvailable: true,
        minBuyAmount: '900000000000000',
        route: { fills: [] },
        sellAmount: '998000',
        sellToken: token,
        tokenMetadata: { sellToken: { buyTaxBps: '0', sellTaxBps: '0', transferTaxBps: '0' } },
        trade: trade(),
        ...overrides,
    }
}

const input = {
    chainId: 56 as const,
    walletAddress: wallet.toLowerCase(),
    sellToken: token,
    sellAmount: '1000000',
    slippageBps: 50,
    clientIp: '127.0.0.1',
}

function code(error: unknown) {
    return error instanceof GasAssistError ? error.code : null
}

describe('0x Gasless v2 quote validation', () => {
    it('accepts an existing allowance with trade signature only', () => {
        const result = gaslessInternals.validateProviderQuote(quote(), input)
        expect(result.approvalRequired).toBe(false)
        expect(result.approval).toBeNull()
    })

    it('accepts an EIP-2612 approval and discloses its scope', () => {
        const result = gaslessInternals.validateProviderQuote(quote({
            allowanceTarget: permit2,
            approval: approval(UINT256_MAX),
            issues: { allowance: { actual: '0', spender: permit2 }, balance: null, simulationIncomplete: false },
        }), input)
        expect(result.approvalRequired).toBe(true)
        expect(result.approvalUnlimited).toBe(true)
        expect(result.approvalAmount).toBe(UINT256_MAX)
    })

    it.each([
        ['missing trade', { trade: null }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['no liquidity', { liquidityAvailable: false }, 'ZEROX_NO_LIQUIDITY'],
        ['wrong sell token', { sellToken: settler }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['wrong buy token', { buyToken: settler }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['incomplete simulation', { issues: { allowance: null, balance: null, simulationIncomplete: true } }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['balance issue', { issues: { allowance: null, balance: { actual: '0' }, simulationIncomplete: false } }, 'INSUFFICIENT_TOKEN_BALANCE'],
        ['taxed token', { tokenMetadata: { sellToken: { sellTaxBps: '1' } } }, 'TOKEN_UNSAFE'],
    ])('rejects %s', (_name, change, expected) => {
        try {
            gaslessInternals.validateProviderQuote(quote(change), input)
            throw new Error('expected failure')
        } catch (error) {
            expect(code(error)).toBe(expected)
        }
    })

    it('returns ONCHAIN_APPROVAL_REQUIRED without a gasless approval', () => {
        expect(() => gaslessInternals.validateProviderQuote(quote({
            allowanceTarget: permit2,
            issues: { allowance: { actual: '0', spender: permit2 }, balance: null, simulationIncomplete: false },
        }), input)).toThrowError(expect.objectContaining({ code: 'ONCHAIN_APPROVAL_REQUIRED' }))
    })

    it('rejects an allowance issue without its authoritative spender', () => {
        expect(() => gaslessInternals.validateProviderQuote(quote({
            issues: { allowance: { actual: '0' }, balance: null, simulationIncomplete: false },
        }), input)).toThrowError(expect.objectContaining({ code: 'ZEROX_GASLESS_RESPONSE_INVALID' }))
    })

    it('rejects unlimited permits when policy is enabled', () => {
        const previous = process.env.GAS_ASSIST_REJECT_UNLIMITED_PERMITS
        process.env.GAS_ASSIST_REJECT_UNLIMITED_PERMITS = 'true'
        try {
            expect(() => gaslessInternals.validateProviderQuote(quote({
                allowanceTarget: permit2,
                approval: approval(UINT256_MAX),
                issues: { allowance: { actual: '0', spender: permit2 }, balance: null, simulationIncomplete: false },
            }), input)).toThrowError(expect.objectContaining({ code: 'UNLIMITED_PERMIT_NOT_ALLOWED' }))
        } finally {
            if (previous === undefined) delete process.env.GAS_ASSIST_REJECT_UNLIMITED_PERMITS
            else process.env.GAS_ASSIST_REJECT_UNLIMITED_PERMITS = previous
        }
    })

    it.each([
        ['owner', { owner: settler }],
        ['spender', { spender: settler }],
    ])('rejects approval %s mismatch', (_name, message) => {
        const bad = approval()
        bad.eip712.message = { ...bad.eip712.message, ...message }
        expect(() => gaslessInternals.validateProviderQuote(quote({
            allowanceTarget: permit2,
            approval: bad,
            issues: { allowance: { actual: '0', spender: permit2 }, balance: null, simulationIncomplete: false },
        }), input)).toThrowError(expect.objectContaining({ code: 'ZEROX_GASLESS_RESPONSE_INVALID' }))
    })

    it('rejects wrong trade recipient, amount, token, chain, or output', () => {
        for (const mutate of [
            (item: ReturnType<typeof trade>) => { item.eip712.message.permitted.amount = '1' },
            (item: ReturnType<typeof trade>) => { item.eip712.message.permitted.token = settler },
            (item: ReturnType<typeof trade>) => { item.eip712.message.slippageAndActions.recipient = settler },
            (item: ReturnType<typeof trade>) => { item.eip712.message.slippageAndActions.buyToken = settler },
            (item: ReturnType<typeof trade>) => { item.eip712.domain.chainId = 1 },
        ]) {
            const bad = trade()
            mutate(bad)
            expect(() => gaslessInternals.validateProviderQuote(quote({ trade: bad }), input))
                .toThrowError(expect.objectContaining({ code: 'ZEROX_GASLESS_RESPONSE_INVALID' }))
        }
    })
})

describe('0x EIP-712 signatures', () => {
    it('verifies a fixed public fixture and splits signature type 2', async () => {
        const typedData = trade().eip712
        await expect(verifyZeroXSignature(typedData, tradeSignature, wallet)).resolves.toBeUndefined()
        expect(splitZeroXSignature(tradeSignature)).toMatchObject({ signatureType: 2 })
    })

    it('rejects malformed and mismatched signatures', async () => {
        await expect(verifyZeroXSignature(trade().eip712, '0x12', wallet))
            .rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
        await expect(verifyZeroXSignature(trade().eip712, otherSignerTradeSignature, wallet))
            .rejects.toMatchObject({ code: 'SIGNER_MISMATCH' })
    })
})

describe('0x Gasless HTTP client', () => {
    it('uses v2 headers, taker, native token, and does not retry submit', async () => {
        process.env.ZEROX_API_KEY = 'test-only-key'
        const fetcher = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => quote() })
            .mockRejectedValueOnce(new Error('timeout'))
        const client = createZeroXGaslessClient({ fetch: fetcher as never, timeoutMs: 1000 })
        await client.getGaslessQuote({
            chainId: 56, sellToken: token, buyToken: ZEROX_NATIVE_TOKEN,
            sellAmount: '1000000', taker: wallet, recipient: wallet,
        })
        const [url, init] = fetcher.mock.calls[0]
        expect(url).toContain('taker=')
        expect(url).toContain(`buyToken=${ZEROX_NATIVE_TOKEN}`)
        expect(init.headers).toMatchObject({ '0x-version': 'v2', '0x-api-key': 'test-only-key' })
        await expect(client.submitGaslessTrade({ chainId: 56 })).rejects.toThrow('timeout')
        expect(fetcher).toHaveBeenCalledTimes(2)
    })
})

describe('0x Gas Assist public routes', () => {
    it('stays disabled without database or 0x configuration', async () => {
        const previousMode = process.env.GAS_ASSIST_MODE
        const previousDatabase = process.env.DATABASE_URL
        process.env.GAS_ASSIST_MODE = 'disabled'
        delete process.env.DATABASE_URL
        const app = createApp()
        try {
            const config = await app.inject({ method: 'GET', url: '/v1/gas-assist/config' })
            expect(config.statusCode).toBe(200)
            expect(config.json()).toMatchObject({ enabled: false, mode: 'disabled', buyToken: 'native' })
            expect(JSON.stringify(config.json())).not.toContain('test-only-key')
            const quoteResponse = await app.inject({
                method: 'POST', url: '/v1/gas-assist/quote',
                payload: { chainId: 56, walletAddress: wallet, sellToken: token, sellAmount: '1000000', slippageBps: 50 },
            })
            expect(quoteResponse.statusCode).toBe(503)
            expect(quoteResponse.json()).toMatchObject({ error: { code: 'GAS_ASSIST_DISABLED' } })
        } finally {
            await app.close()
            if (previousMode === undefined) delete process.env.GAS_ASSIST_MODE
            else process.env.GAS_ASSIST_MODE = previousMode
            if (previousDatabase === undefined) delete process.env.DATABASE_URL
            else process.env.DATABASE_URL = previousDatabase
        }
    })
})
