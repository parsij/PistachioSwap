import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getCatalog: vi.fn(),
}))

vi.mock('../src/modules/market-tokens.js', () => ({
    marketCatalogService: {
        getCatalog: mocks.getCatalog,
    },
}))

import {
    clearUnchainedWalletCacheForTest,
    getUnchainedWalletTokens,
    normalizeUnchainedAccount,
} from '../src/providers/unchained/wallet-tokens.js'

const wallet = '0x1000000000000000000000000000000000000042'
const token = '0x2000000000000000000000000000000000000042'

describe('Unchained account normalization', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        vi.clearAllMocks()
        clearUnchainedWalletCacheForTest()
        process.env.UNCHAINED_ENABLED = 'true'
        process.env.UNCHAINED_HTTP_URL_56 = 'http://127.0.0.1:9999'
        process.env.UNCHAINED_REQUEST_TIMEOUT_MS = '1000'
        mocks.getCatalog.mockResolvedValue({
            catalog: { generatedAt: Date.now(), tokens: [], commonTokens: [] },
            stale: false,
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        process.env = { ...previousEnv }
    })

    it('normalizes native and ERC-20 balances', () => {
        expect(normalizeUnchainedAccount({
            balance: '1000000000000000000',
            unconfirmedBalance: '0',
            nonce: 1,
            pubkey: wallet.toUpperCase(),
            tokens: [
                {
                    balance: '2500000',
                    contract: token.toUpperCase(),
                    decimals: 6,
                    name: 'USD Coin',
                    symbol: 'USDC',
                    type: 'ERC20',
                },
            ],
        })).toEqual({
            balance: 1000000000000000000n,
            pubkey: wallet,
            tokens: [
                {
                    balance: 2500000n,
                    contract: token,
                    decimals: 6,
                    name: 'USD Coin',
                    symbol: 'USDC',
                },
            ],
        })
    })

    it('classifies unknown holdings into the hidden token section', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            balance: '0',
            pubkey: wallet,
            tokens: [
                {
                    balance: '1000000000000000000',
                    contract: token,
                    decimals: 18,
                    name: 'Mystery Token',
                    symbol: 'MYSTERY',
                    type: 'ERC20',
                },
            ],
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })))

        const result = await getUnchainedWalletTokens({
            walletAddress: wallet,
            chainIds: [56],
        })

        expect(result.source).toBe('unchained')
        expect(result.tokens).toHaveLength(1)
        expect(result.tokens[0]).toMatchObject({
            address: token,
            recognitionStatus: 'unverified',
            classificationTier: 'hidden',
            visibility: 'unverified',
            includeInPortfolioValue: false,
            possibleSpam: null,
        })
    })

    it('drops malformed token rows without rejecting the account', () => {
        const account = normalizeUnchainedAccount({
            balance: '0',
            pubkey: wallet,
            tokens: [
                {
                    balance: '-1',
                    contract: token,
                    decimals: 18,
                    name: 'Bad balance',
                    symbol: 'BAD',
                },
                {
                    balance: '1',
                    contract: 'not-an-address',
                    decimals: 18,
                    name: 'Bad address',
                    symbol: 'BAD',
                },
            ],
        })
        expect(account).toEqual({
            balance: 0n,
            pubkey: wallet,
            tokens: [],
        })
    })

    it('rejects malformed account payloads', () => {
        expect(normalizeUnchainedAccount(null)).toBeNull()
        expect(normalizeUnchainedAccount({
            balance: 'not-a-balance',
            pubkey: wallet,
            tokens: [],
        })).toBeNull()
        expect(normalizeUnchainedAccount({
            balance: '0',
            pubkey: 'not-an-address',
            tokens: [],
        })).toBeNull()
    })
})
