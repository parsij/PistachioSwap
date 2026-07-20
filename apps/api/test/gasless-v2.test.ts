import { describe, expect, it, vi } from 'vitest'

import { GasAssistError, gasAssistErrorBody } from '../src/gas-assist/errors.js'
import { createGaslessService, gaslessInternals } from '../src/gas-assist/gasless-service.js'
import {
    splitZeroXSignature,
    verifyZeroXSignature,
} from '../src/gas-assist/signature-verification.js'
import { UINT256_MAX, ZEROX_NATIVE_TOKEN } from '../src/gas-assist/types.js'
import { createZeroXGaslessClient } from '../src/providers/zero-x/gasless-client.js'
import * as honeypotSecurity from '../src/providers/security/honeypot-token-security.js'
import * as goPlusSecurity from '../src/providers/security/goplus-token-security.js'
import * as internalSecurity from '../src/providers/security/token-security.js'
import { moralisWalletTokenService } from '../src/providers/moralis/wallet-token-spam.js'
import { createApp } from '../src/app.js'

const wallet = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'
const tradeSignature = '0x94033d6aa58e1dbb64548a86d18b03278ad165e1168a5b6c6ac15703ac97028140e42c3bb873f58bd4517a96b7e00ccbab68af7ff1f95ec8384cef8f3dab260e1b'
const otherSignerTradeSignature = '0xf03c822fa5032654e26c68a0dc1cbc148e2d73710b755811cd9b2c2983f626c13fa81a0c6f10f8caf4b09fe97c42d870d1fd3fe9ed7bbcb98883d65bd42b77ef1b'
const token = '0x0000000000000000000000000000000000000011'
const permit2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const settler = '0x0000000000000000000000000000000000000022'
const buyToken = '0x0000000000000000000000000000000000000033'
const xaut = '0x68749665ff8d2d112fa859aa293f07a622782f38'
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

function trade(outputToken = ZEROX_NATIVE_TOKEN, minimumOutput = '900000000000000', inputToken = token) {
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
            permitted: { token: inputToken, amount: '1000000' },
            spender: settler,
            nonce: '1',
            deadline,
            slippageAndActions: {
                recipient: wallet,
                buyToken: outputToken,
                minAmountOut: minimumOutput,
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
    buyToken: ZEROX_NATIVE_TOKEN,
    sellAmount: '1000000',
    slippageBps: 50,
    clientIp: '127.0.0.1',
}

function code(error: unknown) {
    return error instanceof GasAssistError ? error.code : null
}

describe('0x Gasless v2 quote validation', () => {
    it('accepts the selected BEP-20 output token and binds it in typed data', () => {
        const tokenInput = { ...input, buyToken }
        const result = gaslessInternals.validateProviderQuote(quote({ buyToken, trade: trade(buyToken) }), tokenInput)
        expect(result.buyAmount).toBe('1000000000000000')
    })

    it('normalizes native output and rejects malformed or identical buy tokens', () => {
        expect(gaslessInternals.normalizeInput({ ...input, buyToken: '0x0000000000000000000000000000000000000000' }).buyToken)
            .toBe(ZEROX_NATIVE_TOKEN)
        expect(() => gaslessInternals.normalizeInput({ ...input, buyToken: 'not-an-address' }))
            .toThrowError(expect.objectContaining({ code: 'INVALID_BUY_TOKEN' }))
        expect(() => gaslessInternals.normalizeInput({ ...input, buyToken: token }))
            .toThrowError(expect.objectContaining({ code: 'IDENTICAL_TOKEN_PAIR' }))
    })
    it('accepts an existing allowance with trade signature only', () => {
        const result = gaslessInternals.validateProviderQuote(quote(), input)
        expect(result.approvalRequired).toBe(false)
        expect(result.approval).toBeNull()
    })

    it('accepts a bounded EIP-2612 approval and discloses its scope', () => {
        const result = gaslessInternals.validateProviderQuote(quote({
            allowanceTarget: permit2,
            approval: approval(1_000_000n),
            issues: { allowance: { actual: '0', spender: permit2 }, balance: null, simulationIncomplete: false },
        }), input)
        expect(result.approvalRequired).toBe(true)
        expect(result.approvalUnlimited).toBe(false)
        expect(result.approvalAmount).toBe('1000000')
    })

    it.each([
        ['missing trade', { trade: null }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['no liquidity', { liquidityAvailable: false }, 'ZEROX_NO_LIQUIDITY'],
        ['wrong sell token', { sellToken: settler }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['wrong buy token', { buyToken: settler }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['incomplete simulation', { issues: { allowance: null, balance: null, simulationIncomplete: true } }, 'ZEROX_GASLESS_RESPONSE_INVALID'],
        ['balance issue', { issues: { allowance: null, balance: { actual: '0' }, simulationIncomplete: false } }, 'INSUFFICIENT_TOKEN_BALANCE'],
    ])('rejects %s', (_name, change, expected) => {
        try {
            gaslessInternals.validateProviderQuote(quote(change), input)
            throw new Error('expected failure')
        } catch (error) {
            expect(code(error)).toBe(expected)
        }
    })

    it('does not apply PistachioSwap tax or token-safety policy to the 0x response', () => {
        expect(() => gaslessInternals.validateProviderQuote(quote({
            tokenMetadata: { sellToken: { buyTaxBps: '9000', sellTaxBps: '9000', transferTaxBps: '9000' } },
        }), input)).not.toThrow()
    })

    it('still rejects malformed/native sell tokens and invalid amounts', () => {
        expect(() => gaslessInternals.normalizeInput({ ...input, sellToken: 'bad' }))
            .toThrowError(expect.objectContaining({ code: 'INVALID_SELL_TOKEN' }))
        expect(() => gaslessInternals.normalizeInput({ ...input, sellToken: ZEROX_NATIVE_TOKEN }))
            .toThrowError(expect.objectContaining({ code: 'NATIVE_SELL_TOKEN_UNSUPPORTED' }))
        expect(() => gaslessInternals.normalizeInput({ ...input, sellAmount: '0' }))
            .toThrowError(expect.objectContaining({ code: 'INVALID_AMOUNT' }))
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

    it('rejects unlimited permits by default', () => {
        const previous = process.env.GAS_ASSIST_REJECT_UNLIMITED_PERMITS
        delete process.env.GAS_ASSIST_REJECT_UNLIMITED_PERMITS
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
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        const fetcher = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify(quote()),
            })
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
        expect(log).toHaveBeenCalledWith('[0x Gasless quote success]', {
            liquidityAvailable: true,
            buyAmount: '1000000000000000',
            minBuyAmount: '900000000000000',
            issues: expect.any(Object),
            approvalAvailable: false,
            tradeAvailable: true,
            fees: expect.any(Object),
        })
        expect(JSON.stringify(log.mock.calls)).not.toContain('eip712')
        await expect(client.submitGaslessTrade({ chainId: 56 })).rejects.toThrow('timeout')
        expect(fetcher).toHaveBeenCalledTimes(2)
        log.mockRestore()
    })

    it.each(['price', 'quote'] as const)('preserves the real provider details for failed %s requests', async (operation) => {
        const previousKey = process.env.ZEROX_API_KEY
        process.env.ZEROX_API_KEY = 'test-only-key'
        const providerBody = {
            code: 'INPUT_INVALID',
            reason: 'SELL_TOKEN_INVALID',
            message: 'The provider rejected this token address.',
        }
        const fetcher = vi.fn().mockImplementation(async () => ({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => JSON.stringify(providerBody),
        }))
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            const client = createZeroXGaslessClient({ fetch: fetcher as never, timeoutMs: 1000 })
            const request = {
                chainId: 56 as const,
                sellToken: xaut,
                buyToken: ZEROX_NATIVE_TOKEN,
                sellAmount: '1000000',
                taker: wallet,
                recipient: wallet,
            }
            let failure: unknown
            try {
                if (operation === 'price') await client.getGaslessPrice(request)
                else await client.getGaslessQuote(request)
            } catch (error) {
                failure = error
            }
            expect(gasAssistErrorBody(failure)).toMatchObject({
                statusCode: 400,
                body: {
                    error: {
                        code: 'ZEROX_QUOTE_FAILED',
                        message: `0x could not provide a Gasless ${operation}.`,
                        details: {
                            httpStatus: 400,
                            providerCode: 'INPUT_INVALID',
                            providerReason: 'SELL_TOKEN_INVALID',
                            providerMessage: 'The provider rejected this token address.',
                        },
                    },
                },
            })
            expect(errorLog).toHaveBeenCalledWith(`[0x Gasless ${operation} response]`, {
                status: 400,
                statusText: 'Bad Request',
                body: providerBody,
            })
            expect(fetcher).toHaveBeenCalledTimes(1)
        } finally {
            errorLog.mockRestore()
            if (previousKey === undefined) delete process.env.ZEROX_API_KEY
            else process.env.ZEROX_API_KEY = previousKey
        }
    })

    it('handles and returns a sanitized non-JSON provider error body', async () => {
        const previousKey = process.env.ZEROX_API_KEY
        process.env.ZEROX_API_KEY = 'secret-provider-key'
        const fetcher = vi.fn().mockImplementation(async () => ({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
            text: async () => 'upstream failed; 0x-api-key=secret-provider-key',
        }))
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            const client = createZeroXGaslessClient({ fetch: fetcher as never, timeoutMs: 1000 })
            await expect(client.getGaslessQuote({
                chainId: 56, sellToken: xaut, buyToken: ZEROX_NATIVE_TOKEN,
                sellAmount: '1000000', taker: wallet, recipient: wallet,
            })).rejects.toMatchObject({
                code: 'ZEROX_QUOTE_FAILED',
                details: {
                    httpStatus: 502,
                    providerMessage: 'upstream failed; [REDACTED]',
                },
            })
            expect(JSON.stringify(errorLog.mock.calls)).toContain('upstream failed; [REDACTED]')
            expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-provider-key')
            expect(fetcher).toHaveBeenCalledTimes(2)
        } finally {
            errorLog.mockRestore()
            if (previousKey === undefined) delete process.env.ZEROX_API_KEY
            else process.env.ZEROX_API_KEY = previousKey
        }
    })

    it('never logs API keys, headers, authorization values, or wallet signatures', async () => {
        const previousKey = process.env.ZEROX_API_KEY
        const apiKey = 'log-secret-api-key'
        const authorization = 'Bearer log-secret-authorization'
        process.env.ZEROX_API_KEY = apiKey
        const fetcher = vi.fn().mockImplementation(async () => ({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => JSON.stringify({
                code: 'INPUT_INVALID',
                message: 'Rejected',
                apiKey,
                requestHeaders: { Authorization: authorization },
                walletSignature: tradeSignature,
            }),
        }))
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            const client = createZeroXGaslessClient({ fetch: fetcher as never, timeoutMs: 1000 })
            await expect(client.getGaslessPrice({
                chainId: 56, sellToken: xaut, buyToken: ZEROX_NATIVE_TOKEN,
                sellAmount: '1000000', taker: wallet, recipient: wallet,
            })).rejects.toMatchObject({ code: 'ZEROX_QUOTE_FAILED' })
            const logged = JSON.stringify(errorLog.mock.calls)
            expect(logged).not.toContain(apiKey)
            expect(logged).not.toContain(authorization)
            expect(logged).not.toContain(tradeSignature)
            expect(logged).not.toContain('requestHeaders')
        } finally {
            errorLog.mockRestore()
            if (previousKey === undefined) delete process.env.ZEROX_API_KEY
            else process.env.ZEROX_API_KEY = previousKey
        }
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
            expect(config.json()).toMatchObject({ enabled: false, mode: 'disabled', supportedBuyTokens: ['native', 'bep20'] })
            expect(JSON.stringify(config.json())).not.toContain('test-only-key')
            const quoteResponse = await app.inject({
                method: 'POST', url: '/v1/gas-assist/quote',
                payload: { chainId: 56, walletAddress: wallet, sellToken: token, buyToken, sellAmount: '1000000', slippageBps: 50 },
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

describe('dynamic Gas Assist fee', () => {
    const schedule = {
        feePercentBps: 300,
        fixedFeeUsd: '0.067',
        maximumFeeUsd: '5',
    }
    it.each([
        ['$1', '1000000', '0.097', 970, '97000'],
        ['$10', '10000000', '0.367', 367, '367000'],
        ['$100', '100000000', '3.067', 306, '3060000'],
        ['$200', '200000000', '5', 250, '5000000'],
        ['$1,000', '1000000000', '5', 50, '5000000'],
    ])('calculates %s with floor-rounded BPS', (_label, amount, target, bps, rawFee) => {
        const plan = gaslessInternals.calculateFeePlan(amount, 6, '1', schedule, '2026-01-01T00:00:00.000Z')
        expect(gaslessInternals.publicFee(plan)).toMatchObject({
            targetFeeUsd: target,
            dynamicFeeBps: bps,
            expectedFeeTokenAmount: rawFee,
        })
        expect(plan.estimatedFeeUsd).toBeLessThanOrEqual(plan.targetFeeUsd)
    })

    it('fails closed for malformed trusted prices and unrepresentable fees', () => {
        expect(() => gaslessInternals.calculateFeePlan('1000000', 6, 'bad', schedule))
            .toThrowError(expect.objectContaining({ code: 'TRUSTED_PRICE_UNAVAILABLE' }))
        expect(() => gaslessInternals.calculateFeePlan('1', 6, '1', schedule))
            .toThrowError(expect.objectContaining({ code: 'GAS_ASSIST_FEE_NOT_REPRESENTABLE' }))
    })

    it('rejects missing, wrong-token, and wrong-amount integrator fees', () => {
        const plan = gaslessInternals.calculateFeePlan('1000000', 6, '1', schedule)
        for (const integratorFee of [null, { amount: '97000', token: buyToken }, { amount: '97001', token }]) {
            expect(() => gaslessInternals.validateProviderQuote(
                quote({ fees: { integratorFee }, sellAmount: '903000' }),
                input,
                plan,
            )).toThrowError(expect.objectContaining({ code: 'GAS_ASSIST_INTEGRATOR_FEE_MISMATCH' }))
        }
        expect(gaslessInternals.validateProviderQuote(
            quote({ fees: { integratorFee: { amount: '97000', token } }, sellAmount: '903000' }),
            input,
            plan,
        ).fees).toBeTruthy()
    })
})

describe('authoritative selected output and fee persistence', () => {
    it('passes the selected buy token and dynamic BPS to 0x and stores both', async () => {
        const previous = Object.fromEntries([
            'GAS_ASSIST_MODE',
            'DATABASE_URL',
            'ZEROX_API_KEY',
            'TREASURY_ADDRESS',
        ].map((key) => [key, process.env[key]]))
        process.env.GAS_ASSIST_MODE = 'zero-x-gasless'
        process.env.DATABASE_URL = 'postgresql://test.invalid/test'
        process.env.ZEROX_API_KEY = 'test-only-key'
        process.env.TREASURY_ADDRESS = '0x0000000000000000000000000000000000000044'
        const providerRequest = vi.fn().mockResolvedValue(quote({
            buyToken,
            buyAmount: '800000',
            minBuyAmount: '700000',
            sellAmount: '903000',
            fees: { integratorFee: { amount: '97000', token } },
            trade: trade(buyToken, '700000'),
        }))
        const databaseQuery = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT count')) return { rows: [{ count: '0' }] }
            if (sql.includes('INSERT INTO gas_assist_gasless_quotes')) {
                return { rows: [{ id: '00000000-0000-4000-8000-000000000001' }] }
            }
            throw new Error(`unexpected query: ${sql}`)
        })
        try {
            const service = createGaslessService({
                database: { query: databaseQuery } as never,
                client: { getGaslessQuote: providerRequest } as never,
                now: () => new Date('2026-01-01T00:00:00.000Z'),
                getBalanceAndDecimals: async () => ({ balance: 1_000_000n, decimals: 6 }),
                getTokenDecimals: async () => 6,
                getTokenPrice: async () => '1',
            })
            const result = await service.quote({ ...input, buyToken })
            expect(providerRequest).toHaveBeenCalledWith(expect.objectContaining({
                buyToken,
                swapFeeBps: 970,
                swapFeeToken: token,
            }))
            const insert = databaseQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO gas_assist_gasless_quotes'))
            expect(insert?.[1]?.[3]).toBe(buyToken)
            expect(JSON.parse(insert?.[1]?.[8] as string).pistachioSwap).toMatchObject({
                dynamicFeeBps: 970,
                expectedFeeTokenAmount: '97000',
            })
            expect(result).toMatchObject({ buyToken, fee: { dynamicFeeBps: 970 } })
        } finally {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key]
                else process.env[key] = value
            }
        }
    })
})

describe('zero-x mode has no PistachioSwap token-security policy', () => {
    it('sends unsafe, honeypot, blocklisted, and non-allowlisted XAUT to price and firm quote', async () => {
        const previous = { ...process.env }
        process.env.GAS_ASSIST_MODE = 'zero-x-gasless'
        process.env.DATABASE_URL = 'postgresql://test.invalid/test'
        process.env.ZEROX_API_KEY = 'test-only-key'
        process.env.TREASURY_ADDRESS = '0x0000000000000000000000000000000000000044'
        process.env.GAS_ASSIST_REQUIRE_STRICT_TOKEN_SECURITY = 'true'
        process.env.WALLET_TOKEN_BLOCKLIST_56 = xaut
        process.env.GAS_ASSIST_ALLOWED_TOKENS_56 = token

        const honeypot = vi.spyOn(honeypotSecurity, 'getHoneypotTokenSecurity')
            .mockRejectedValue(new Error('zero-x must not call Honeypot'))
        const goPlus = vi.spyOn(goPlusSecurity, 'getGoPlusTokenSecurity')
            .mockRejectedValue(new Error('zero-x must not call GoPlus'))
        const moralis = vi.spyOn(moralisWalletTokenService, 'getWalletTokens')
            .mockRejectedValue(new Error('zero-x must not call Moralis'))
        const refreshSecurity = vi.spyOn(internalSecurity.tokenSecurityService, 'refresh')
            .mockRejectedValue(new Error('zero-x must not refresh token security'))
        const classifySecurity = vi.spyOn(internalSecurity, 'classifyTokenSecurity')

        const providerPayload = quote({
            sellToken: xaut,
            buyToken,
            buyAmount: '800000',
            minBuyAmount: '700000',
            sellAmount: '903000',
            fees: { integratorFee: { amount: '97000', token: xaut } },
            tokenMetadata: {
                sellToken: { buyTaxBps: '9000', sellTaxBps: '9000', transferTaxBps: '9000' },
            },
            trade: trade(buyToken, '700000', xaut),
        })
        const getGaslessPrice = vi.fn().mockResolvedValue(providerPayload)
        const getGaslessQuote = vi.fn().mockResolvedValue(providerPayload)
        const databaseQuery = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT count')) return { rows: [{ count: '0' }] }
            if (sql.includes('INSERT INTO gas_assist_gasless_quotes')) {
                return { rows: [{ id: '00000000-0000-4000-8000-000000000001' }] }
            }
            throw new Error(`unexpected query: ${sql}`)
        })
        let trustedPricesAvailable = true
        try {
            const service = createGaslessService({
                database: { query: databaseQuery } as never,
                client: { getGaslessPrice, getGaslessQuote } as never,
                now: () => new Date('2026-01-01T00:00:00.000Z'),
                getBalanceAndDecimals: async () => ({ balance: 1_000_000n, decimals: 6 }),
                getTokenDecimals: async () => 6,
                getTokenPrice: async () => trustedPricesAvailable ? '1' : null,
            })
            const request = { ...input, sellToken: xaut, buyToken }
            await expect(service.price(request)).resolves.toMatchObject({ sellToken: xaut, buyToken })
            await expect(service.quote(request)).resolves.toMatchObject({ sellToken: xaut, buyToken })
            expect(getGaslessPrice).toHaveBeenCalledOnce()
            expect(getGaslessQuote).toHaveBeenCalledOnce()
            expect(honeypot).not.toHaveBeenCalled()
            expect(goPlus).not.toHaveBeenCalled()
            expect(moralis).not.toHaveBeenCalled()
            expect(refreshSecurity).not.toHaveBeenCalled()
            expect(classifySecurity).not.toHaveBeenCalled()

            trustedPricesAvailable = false
            await expect(service.price(request)).rejects.toMatchObject({ code: 'TRUSTED_PRICE_UNAVAILABLE' })
            expect(getGaslessPrice).toHaveBeenCalledOnce()
        } finally {
            vi.restoreAllMocks()
            process.env = previous
        }
    })
})
