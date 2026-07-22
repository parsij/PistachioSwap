import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    moralisWalletHistoryRequest: vi.fn(),
    getWalletTokens: vi.fn(),
}))

vi.mock('../src/providers/moralis/wallet-history.js', () => ({
    moralisWalletHistoryRequest: mocks.moralisWalletHistoryRequest,
}))

vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({
    getWalletTokens: mocks.getWalletTokens,
}))

import { createApp } from '../src/app.js'

const wallet = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const usdtAddress = '0x0000000000000000000000000000000000000101'
const scamAddress = '0x0000000000000000000000000000000000000666'

function token(address: string, overrides = {}) {
    return {
        chainId: 56,
        address,
        isNative: false,
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 18,
        recognitionStatus: 'recognized',
        recognitionReasons: ['coingecko-exact-contract'],
        possibleSpam: false,
        securityStatus: 'low',
        priceConfidence: 'trusted',
        includeInPortfolioValue: true,
        visibility: 'primary',
        ...overrides,
    }
}

function historyRow({
    hash,
    summary,
    transfers = [],
}: {
    hash: string
    summary: string
    transfers?: unknown[]
}) {
    return {
        hash: `0x${hash.padStart(64, '0')}`,
        receipt_status: '1',
        summary,
        method_label: summary,
        block_timestamp: '2026-07-22T12:00:00.000Z',
        from_address: wallet,
        to_address: recipient,
        erc20_transfers: transfers,
        native_transfers: [],
    }
}

function erc20Transfer(address: string, direction: 'incoming' | 'outgoing') {
    return {
        address,
        token_address: address,
        token_symbol: address === scamAddress ? 'RET' : 'USDT',
        token_name: address === scamAddress ? 'RETURN TO MEMES' : 'Tether USD',
        token_decimals: '18',
        value_formatted: '1',
        from_address: direction === 'outgoing' ? wallet : recipient,
        to_address: direction === 'outgoing' ? recipient : wallet,
        direction,
        possible_spam: false,
    }
}

describe('wallet activity route trust filtering', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('returns only trusted token activity and does not turn random interactions into swaps', async () => {
        mocks.getWalletTokens.mockResolvedValue([
            token(usdtAddress),
            token(scamAddress, {
                name: 'RETURN TO MEMES',
                symbol: 'RET',
                recognitionStatus: 'unverified',
                recognitionReasons: ['market-catalog-only'],
                securityStatus: 'caution',
                priceConfidence: 'untrusted',
                includeInPortfolioValue: false,
                visibility: 'hidden',
            }),
        ])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [
                historyRow({
                    hash: '101',
                    summary: 'Send',
                    transfers: [erc20Transfer(usdtAddress, 'outgoing')],
                }),
                historyRow({
                    hash: '666',
                    summary: 'Receive',
                    transfers: [erc20Transfer(scamAddress, 'incoming')],
                }),
                historyRow({
                    hash: '999',
                    summary: 'Contract interaction',
                    transfers: [],
                }),
            ],
        })

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-activity?address=${wallet}&chainIds=56&limit=20`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().items).toHaveLength(1)
        expect(response.json().items[0]).toMatchObject({
            type: 'sent',
            token: expect.objectContaining({
                symbol: 'USDT',
                visibility: 'primary',
            }),
        })
        expect(response.body).not.toContain('RETURN TO MEMES')
        expect(response.json().items.map((item: { type: string }) => item.type))
            .not.toContain('contract')
        expect(response.json().items.map((item: { type: string }) => item.type))
            .not.toContain('swapped')
    })
})
