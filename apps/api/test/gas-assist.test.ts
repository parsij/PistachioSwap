import { describe, expect, it, vi } from 'vitest'

import {
    APPROVE_SELECTOR,
    UINT256_MAX,
    buildExactApproval,
    decodeExactApproval,
    parseAmountIn,
} from '../src/gas-assist/exact-approval.js'
import {
    authorizeRule,
    loadExactSponsorRule,
    type SponsorRule,
} from '../src/gas-assist/rules.js'
import { createPaymasterClient } from '../src/gas-assist/paymaster.js'
import {
    getApprovalQuoteStatus,
    submitApprovalQuote,
} from '../src/gas-assist/service.js'
import { persistSwapIntent } from '../src/gas-assist/intents.js'
import { validateStartupConfig } from '../src/config.js'

const wallet = '0x0000000000000000000000000000000000000011' as const
const token = '0x0000000000000000000000000000000000000022' as const
const spender = '0x0000000000000000000000000000000000000044' as const

function rule(overrides: Partial<SponsorRule> = {}): SponsorRule {
    return {
        id: 'rule-id',
        chainId: 56,
        walletAddress: wallet,
        tokenAddress: token,
        minimumAmountBaseUnits: '100',
        maximumAmountBaseUnits: '1000',
        enabled: true,
        expiresAt: null,
        maximumSponsorshipsPerDay: null,
        maximumTotalAmountPerDayBaseUnits: null,
        ...overrides,
    }
}

describe('Gas Assist exact sponsor rules', () => {
    it('looks up only the exact chain, wallet, and token tuple', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [rule()] })
        await loadExactSponsorRule({ query } as never, 56, wallet, token)
        expect(query.mock.calls[0]?.[1]).toEqual([56, wallet, token])
        expect(String(query.mock.calls[0]?.[0])).toContain(
            'chain_id=$1 AND wallet_address=$2 AND token_address=$3',
        )
    })

    it('accepts the exact minimum, values above it, and the exact maximum', () => {
        expect(authorizeRule(rule(), 100n).id).toBe('rule-id')
        expect(authorizeRule(rule(), 101n).id).toBe('rule-id')
        expect(authorizeRule(rule(), 1000n).id).toBe('rule-id')
    })

    it('accepts any larger amount when maximum is absent', () => {
        expect(authorizeRule(rule({ maximumAmountBaseUnits: null }), 10n ** 30n).id).toBe('rule-id')
    })

    it.each([
        [null, 100n, 'GAS_ASSIST_RULE_NOT_FOUND'],
        [rule({ enabled: false }), 100n, 'GAS_ASSIST_RULE_DISABLED'],
        [rule({ expiresAt: new Date('2020-01-01') }), 100n, 'GAS_ASSIST_RULE_EXPIRED'],
        [rule(), 99n, 'BELOW_SPONSOR_MINIMUM'],
        [rule(), 1001n, 'ABOVE_SPONSOR_MAXIMUM'],
    ])('rejects invalid rule authorization', (candidate, amount, code) => {
        expect(() => authorizeRule(candidate, amount, new Date('2026-01-01')))
            .toThrow(expect.objectContaining({ code }))
    })

    it('compares base units without token decimal conversion', () => {
        expect(() => authorizeRule(rule({
            minimumAmountBaseUnits: '1000000',
            maximumAmountBaseUnits: null,
        }), 999999n))
            .toThrow(expect.objectContaining({ code: 'BELOW_SPONSOR_MINIMUM' }))
        expect(authorizeRule(rule({
            minimumAmountBaseUnits: '1000000',
            maximumAmountBaseUnits: null,
        }), 1000000n).id)
            .toBe('rule-id')
    })
})

describe('Gas Assist startup and paymaster boundaries', () => {
    it('keeps normal startup available while Gas Assist is disabled', () => {
        const previous = process.env.GAS_ASSIST_ENABLED
        process.env.GAS_ASSIST_ENABLED = 'false'
        try {
            expect(validateStartupConfig().gasAssist.enabled).toBe(false)
        } finally {
            if (previous === undefined) delete process.env.GAS_ASSIST_ENABLED
            else process.env.GAS_ASSIST_ENABLED = previous
        }
    })

    it('rejects disabled status and submission requests before opening PostgreSQL', async () => {
        const previous = { ...process.env }
        process.env.GAS_ASSIST_ENABLED = 'false'
        delete process.env.DATABASE_URL
        try {
            await expect(getApprovalQuoteStatus('00000000-0000-0000-0000-000000000000'))
                .rejects.toMatchObject({ code: 'GAS_ASSIST_DISABLED' })
            await expect(submitApprovalQuote({
                quoteId: '00000000-0000-0000-0000-000000000000',
                signedTransaction: '0x01',
                clientIp: '127.0.0.1',
            }))
                .rejects.toMatchObject({ code: 'GAS_ASSIST_DISABLED' })
        } finally {
            process.env = previous
        }
    })

    it('does not open PostgreSQL while persisting a quote intent when disabled', async () => {
        const previous = { ...process.env }
        process.env.GAS_ASSIST_ENABLED = 'false'
        delete process.env.DATABASE_URL
        try {
            await expect(persistSwapIntent({} as never, {} as never)).resolves.toBeNull()
        } finally {
            process.env = previous
        }
    })

    it('fails closed with all material mainnet configuration gaps', () => {
        const previous = { ...process.env }
        process.env.GAS_ASSIST_ENABLED = 'true'
        process.env.GAS_ASSIST_CHAIN_ID = '56'
        delete process.env.DATABASE_URL
        delete process.env.GAS_ASSIST_SWAP_CONTRACT_ADDRESS_56
        delete process.env.GAS_ASSIST_PAYMASTER_RPC_URL
        delete process.env.GAS_ASSIST_PAYMASTER_POLICY_ID
        delete process.env.GAS_ASSIST_IP_HASH_SECRET
        delete process.env.GAS_ASSIST_MAINNET_CONFIRMATION
        try {
            expect(() => validateStartupConfig()).toThrow(/configuration is unsafe/)
            try {
                validateStartupConfig()
            } catch (error) {
                const message = String(error)
                expect(message).toContain('GAS_ASSIST_MAINNET_CONFIRMATION')
                expect(message).toContain('DATABASE_URL')
                expect(message).toContain('GAS_ASSIST_IP_HASH_SECRET')
            }
        } finally {
            process.env = previous
        }
    })

    it('uses only pm_isSponsorable and eth_sendRawTransaction with the policy header', async () => {
        const previous = { ...process.env }
        process.env.GAS_ASSIST_PAYMASTER_RPC_URL = 'https://paymaster.test.invalid/rpc'
        process.env.GAS_ASSIST_PAYMASTER_POLICY_ID = 'local-test-policy'
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                jsonrpc: '2.0', id: 1, result: { sponsorable: true },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                jsonrpc: '2.0', id: 1,
                result: '0x1111111111111111111111111111111111111111111111111111111111111111',
            }), { status: 200 }))
        try {
            const client = createPaymasterClient(fetcher)
            const transaction = {
                from: wallet,
                to: token,
                data: buildExactApproval(spender, 123n),
                value: '0x0',
                gas: '0x124f8',
            }
            await expect(client.isSponsorable(transaction)).resolves.toBe(true)
            await expect(client.submit('0x01')).resolves.toMatch(/^0x1{64}$/)
            const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
            const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
            expect(first).toMatchObject({ method: 'pm_isSponsorable', params: [transaction] })
            expect(second).toMatchObject({ method: 'eth_sendRawTransaction', params: ['0x01'] })
            expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
                'x-megafuel-policy-uuid': 'local-test-policy',
            })
        } finally {
            process.env = previous
        }
    })
})

describe('Gas Assist exact approval calldata', () => {
    it('builds only approve(fixedSpender, exactAmount)', () => {
        const data = buildExactApproval(spender, 123n)
        expect(data.startsWith(APPROVE_SELECTOR)).toBe(true)
        expect(decodeExactApproval(data)).toEqual({ spender, amount: 123n })
    })

    it.each(['0', '-1', '1.5', '', '01'])('rejects invalid amount %s', (amount) => {
        expect(() => parseAmountIn(amount)).toThrow()
    })

    it('rejects unlimited approval amounts', () => {
        expect(() => parseAmountIn(UINT256_MAX.toString()))
            .toThrow(expect.objectContaining({ code: 'UNLIMITED_APPROVAL_FORBIDDEN' }))
    })

    it('rejects another selector and trailing arbitrary calldata', () => {
        expect(() => decodeExactApproval('0xa9059cbb' as `0x${string}`)).toThrow()
        expect(() => decodeExactApproval(`${buildExactApproval(spender, 1n)}00`)).toThrow()
    })
})
