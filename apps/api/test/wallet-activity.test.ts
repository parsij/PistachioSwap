import { encodeFunctionData } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    alchemyRpcBatch: vi.fn(),
    moralisWalletHistoryRequest: vi.fn(),
    getWalletTokens: vi.fn(),
    getFallbackTokensForChain: vi.fn(),
}))

vi.mock('../src/providers/alchemy/alchemy-client.js', () => ({
    alchemyRpcBatch: mocks.alchemyRpcBatch,
    alchemyRpc: vi.fn().mockRejectedValue(new Error('Unexpected RPC call in activity test')),
}))

vi.mock('../src/providers/moralis/wallet-history.js', () => ({
    moralisWalletHistoryRequest: mocks.moralisWalletHistoryRequest,
}))

vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({
    getWalletTokens: mocks.getWalletTokens,
}))

vi.mock('../src/token-discovery/fallback-token-catalog.js', () => ({
    getFallbackTokensForChain: mocks.getFallbackTokensForChain,
}))

import { createApp } from '../src/app.js'
import { GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS } from '../src/modules/wallet-activity.js'

const wallet = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const treasury = '0x0000000000000000000000000000000000000003'
const router = '0x0000000000000000000000000000000000000004'
const usdtAddress = '0x0000000000000000000000000000000000000101'
const realBscUsdtAddress = '0x55d398326f99059ff775485246999027b3197955'
const wbnbAddress = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const scamAddress = '0x0000000000000000000000000000000000000666'

const gasAssistAtomicExecutorAbi = [
    {
        type: 'function',
        name: 'executeAtomicSwap',
        stateMutability: 'payable',
        inputs: [
            { name: 'treasury', type: 'address' },
            { name: 'paymentToken', type: 'address' },
            { name: 'feeAmount', type: 'uint256' },
            { name: 'sellToken', type: 'address' },
            { name: 'swapAmount', type: 'uint256' },
            { name: 'buyToken', type: 'address' },
            { name: 'router', type: 'address' },
            { name: 'swapCalldata', type: 'bytes' },
            { name: 'minOut', type: 'uint256' },
        ],
        outputs: [],
    },
] as const

const erc20ApproveAbi = [
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
        classificationTier: 'established',
        classificationReasons: ['established-market-asset'],
        visibility: 'primary',
        ...overrides,
    }
}

function fallbackToken(address: string) {
    return {
        chainId: 56,
        address,
        id: `56:${address}`,
        canonicalId: `56:${address}`,
        isNative: false,
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 18,
        logoURI: '/icons/token-fallback.svg',
        logoCandidates: ['/icons/token-fallback.svg'],
        chainLogoURI: '/networkIcons/bsc.webp',
        coinGeckoId: 'tether',
        metadataSources: ['coingecko'],
        iconSource: 'local',
        generatedAt: '2026-07-23T00:00:00.000Z',
        catalogSource: 'static-fallback',
        directoryStatus: 'listed',
        catalogSection: 'fallback',
        rank: null,
    }
}

function historyRow({
    hash,
    summary,
    transfers = [],
    input = '0x',
    fromAddress,
    toAddress,
    category,
    authorizationList,
}: {
    hash: string
    summary: string
    transfers?: unknown[]
    input?: string
    fromAddress?: string
    toAddress?: string
    category?: string
    authorizationList?: unknown[]
}) {
    const receiving = /^receive\b/i.test(summary)
    return {
        hash: `0x${hash.padStart(64, '0')}`,
        receipt_status: '1',
        summary,
        method_label: summary,
        category,
        input,
        block_timestamp: '2026-07-22T12:00:00.000Z',
        from_address: fromAddress ?? (receiving ? recipient : wallet),
        to_address: toAddress ?? (receiving ? wallet : recipient),
        erc20_transfers: transfers,
        native_transfers: [],
        authorization_list: authorizationList,
    }
}

function erc20Transfer(
    address: string,
    direction: 'incoming' | 'outgoing',
    possibleSpam = false,
    overrides: Record<string, unknown> = {},
) {
    return {
        address,
        token_address: address,
        token_symbol: address === scamAddress
            ? 'RET'
            : address === wbnbAddress
                ? 'WBNB'
                : 'USDT',
        token_name: address === scamAddress
            ? 'RETURN TO MEMES'
            : address === wbnbAddress
                ? 'Wrapped BNB'
                : 'Tether USD',
        token_decimals: '18',
        value_formatted: '1',
        value: '1000000000000000000',
        from_address: direction === 'outgoing' ? wallet : recipient,
        to_address: direction === 'outgoing' ? recipient : wallet,
        direction,
        possible_spam: possibleSpam,
        ...overrides,
    }
}

describe('wallet activity route trust filtering', () => {
    beforeEach(() => {
        mocks.getFallbackTokensForChain.mockResolvedValue([
            fallbackToken(realBscUsdtAddress),
        ])
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('keeps user-initiated history while filtering unsolicited untrusted receives', async () => {
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
        expect(response.json().items).toHaveLength(2)
        expect(response.json().items.find((item: { type: string }) =>
            item.type === 'sent')).toMatchObject({
            type: 'sent',
            token: expect.objectContaining({
                symbol: 'USDT',
                visibility: 'primary',
            }),
        })
        expect(response.json().items.find((item: { type: string }) =>
            item.type === 'contract')).toMatchObject({
            type: 'contract',
            recipient,
        })
        expect(response.body).not.toContain('RETURN TO MEMES')
        expect(response.json().items.map((item: { type: string }) => item.type))
            .not.toContain('swapped')
    })

    it('recognizes an atomic Gas Assist self-call as a swap even when the provider labels it Send', async () => {
        const feeRaw = 260209000000000000n
        const swapRaw = 10000000000000000000n
        const buyRaw = 20000000000000000n
        const input = encodeFunctionData({
            abi: gasAssistAtomicExecutorAbi,
            functionName: 'executeAtomicSwap',
            args: [
                treasury,
                realBscUsdtAddress,
                feeRaw,
                realBscUsdtAddress,
                swapRaw,
                wbnbAddress,
                router,
                '0x1234',
                19000000000000000n,
            ],
        })
        mocks.getWalletTokens.mockResolvedValue([
            token(realBscUsdtAddress),
            token(wbnbAddress, {
                name: 'Wrapped BNB',
                symbol: 'WBNB',
            }),
        ])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [historyRow({
                hash: '404',
                summary: 'Send',
                input,
                fromAddress: wallet,
                toAddress: wallet,
                authorizationList: [{ address: GAS_ASSIST_ATOMIC_EXECUTOR_ADDRESS }],
                transfers: [
                    erc20Transfer(realBscUsdtAddress, 'outgoing', false, {
                        value: feeRaw.toString(),
                        value_formatted: '0.260209',
                        to_address: treasury,
                    }),
                    erc20Transfer(realBscUsdtAddress, 'outgoing', false, {
                        value: swapRaw.toString(),
                        value_formatted: '10',
                        to_address: router,
                    }),
                    erc20Transfer(wbnbAddress, 'incoming', false, {
                        value: buyRaw.toString(),
                        value_formatted: '0.02',
                        from_address: router,
                    }),
                ],
            })],
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
            type: 'swapped',
            sellAmount: '10',
            buyAmount: '0.02',
            provider: 'pistachio-gas-assist',
            sellToken: expect.objectContaining({ symbol: 'USDT' }),
            buyToken: expect.objectContaining({ symbol: 'WBNB' }),
        })
        expect(response.json().items[0].sellAmount).not.toBe('0.260209')
    })

    it('does not promote an arbitrary self-call with token movement into a swap', async () => {
        mocks.alchemyRpcBatch.mockImplementation(async (requests) => new Map(
            requests.map(request => [request.id, { result: { status: '0x1', logs: [] } }]),
        ))
        mocks.getWalletTokens.mockResolvedValue([
            token(realBscUsdtAddress),
            token(wbnbAddress, { name: 'Wrapped BNB', symbol: 'WBNB' }),
        ])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [historyRow({
                hash: '405',
                summary: 'Send',
                input: '0x12345678',
                fromAddress: wallet,
                toAddress: wallet,
                transfers: [
                    erc20Transfer(realBscUsdtAddress, 'outgoing'),
                    erc20Transfer(wbnbAddress, 'incoming'),
                ],
            })],
        })

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-activity?address=${wallet}&chainIds=56&limit=20`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().items).toHaveLength(1)
        expect(response.json().items[0].type).toBe('sent')
        expect(mocks.alchemyRpcBatch).toHaveBeenCalledTimes(1)
    })

    it('recognizes a standard ERC20 approval even when there is no Transfer event', async () => {
        const amount = 5000000000000000000n
        mocks.getWalletTokens.mockResolvedValue([token(realBscUsdtAddress)])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [historyRow({
                hash: '406',
                summary: 'Contract interaction',
                input: encodeFunctionData({
                    abi: erc20ApproveAbi,
                    functionName: 'approve',
                    args: [router, amount],
                }),
                toAddress: realBscUsdtAddress,
                transfers: [],
            })],
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
            type: 'approved',
            amount: '5',
            recipient: router,
            token: expect.objectContaining({ symbol: 'USDT' }),
        })
    })

    it('keeps exact known USDT history after the current balance becomes zero', async () => {
        mocks.getWalletTokens.mockResolvedValue([])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [
                historyRow({
                    hash: '202',
                    summary: 'Send',
                    transfers: [erc20Transfer(realBscUsdtAddress, 'outgoing')],
                }),
                historyRow({
                    hash: '667',
                    summary: 'Receive',
                    transfers: [erc20Transfer(scamAddress, 'incoming')],
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
                address: realBscUsdtAddress,
                symbol: 'USDT',
                historyVerified: true,
                classificationTier: 'established',
                visibility: 'primary',
                includeInPortfolioValue: false,
            }),
        })
        expect(response.body).not.toContain(scamAddress)
    })

    it('still rejects a Moralis row explicitly marked as spam', async () => {
        mocks.getWalletTokens.mockResolvedValue([])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [historyRow({
                hash: '303',
                summary: 'Receive',
                transfers: [erc20Transfer(realBscUsdtAddress, 'incoming', true)],
            })],
        })

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-activity?address=${wallet}&chainIds=56&limit=20`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().items).toEqual([])
    })
})
