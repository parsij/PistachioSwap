import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    clearMoralisWalletTokenCacheForTest,
    createMoralisWalletTokenService,
    normalizeMoralisWalletToken,
} from '../src/providers/moralis/wallet-token-spam.js'
import { moralisWalletTokensRequest } from '../src/providers/moralis/moralis-client.js'

const wallet = '0x1000000000000000000000000000000000000001'
const firstToken = '0x0000000000000000000000000000000000000011'
const secondToken = '0x0000000000000000000000000000000000000022'

describe('Moralis wallet-token spam enrichment', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        clearMoralisWalletTokenCacheForTest()
        process.env.MORALIS_ENABLED = 'true'
        process.env.MORALIS_API_KEY = 'test-only-key'
        process.env.MORALIS_WALLET_CACHE_TTL_MS = '300000'
    })

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('follows every cursor and normalizes exact lowercase contracts', async () => {
        const requestPage = vi.fn(async ({ cursor }: { cursor?: string | null }) =>
            cursor === 'next-page'
                ? {
                      result: [{
                          token_address: secondToken.toUpperCase(),
                          possible_spam: false,
                          verified_contract: true,
                          name: 'New deployment',
                          symbol: 'NEW',
                          decimals: '18',
                      }],
                      cursor: null,
                  }
                : {
                      result: [{
                          token_address: firstToken,
                          possible_spam: true,
                          verified_contract: false,
                          usd_price: '2.5',
                      }],
                      cursor: 'next-page',
                  },
        )
        const service = createMoralisWalletTokenService({
            requestPage: requestPage as never,
            now: () => 1_000,
        })

        const result = await service.getWalletTokens(wallet)

        expect(requestPage).toHaveBeenCalledTimes(2)
        expect(requestPage.mock.calls.map(([request]) => request.cursor ?? null))
            .toEqual([null, 'next-page'])
        expect(result).toMatchObject({ available: true, pageCount: 2 })
        expect([...result.tokens.keys()]).toEqual([firstToken, secondToken])
        expect(result.tokens.get(firstToken)).toMatchObject({
            possibleSpam: true,
            verifiedContract: false,
            priceUSD: '2.5',
        })
        expect(result.tokens.get(secondToken)).toMatchObject({
            possibleSpam: false,
            verifiedContract: true,
        })
    })

    it('preserves missing booleans as unknown rather than false', () => {
        expect(normalizeMoralisWalletToken({
            token_address: firstToken,
        })).toMatchObject({
            possibleSpam: null,
            verifiedContract: null,
        })
    })

    it('deduplicates concurrent requests and reuses the five-minute cache', async () => {
        let release: (() => void) | null = null
        const waiting = new Promise<void>((resolve) => {
            release = resolve
        })
        const requestPage = vi.fn(async () => {
            await waiting
            return { result: [], cursor: null }
        })
        const service = createMoralisWalletTokenService({
            requestPage: requestPage as never,
            now: () => 1_000,
        })

        const first = service.getWalletTokens(wallet)
        const second = service.getWalletTokens(wallet)
        release?.()
        await Promise.all([first, second])
        await service.getWalletTokens(wallet)

        expect(requestPage).toHaveBeenCalledTimes(1)
    })

    it('returns unavailable without failing when enabled without a key', async () => {
        delete process.env.MORALIS_API_KEY
        const requestPage = vi.fn()
        const service = createMoralisWalletTokenService({
            requestPage: requestPage as never,
        })

        await expect(service.getWalletTokens(wallet)).resolves.toMatchObject({
            available: false,
            checkedAt: null,
            pageCount: 0,
        })
        expect(requestPage).not.toHaveBeenCalled()
    })

    it('briefly caches outages without replacing the last valid result', async () => {
        let now = 1_000
        const requestPage = vi.fn()
            .mockResolvedValueOnce({
                result: [{
                    token_address: firstToken,
                    possible_spam: false,
                    verified_contract: true,
                }],
                cursor: null,
            })
            .mockRejectedValue(new Error('temporary outage'))
        const service = createMoralisWalletTokenService({
            requestPage: requestPage as never,
            now: () => now,
        })

        const valid = await service.getWalletTokens(wallet)
        now += 300_001
        const stale = await service.getWalletTokens(wallet)
        const cachedOutage = await service.getWalletTokens(wallet)

        expect(requestPage).toHaveBeenCalledTimes(2)
        expect(stale.tokens.get(firstToken)).toEqual(valid.tokens.get(firstToken))
        expect(cachedOutage.tokens.get(firstToken)).toEqual(valid.tokens.get(firstToken))
    })

    it('requests the BSC wallet endpoint with spam and unverified contracts included', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            result: [],
            cursor: null,
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }))
        vi.stubGlobal('fetch', fetchMock)

        await moralisWalletTokensRequest({
            walletAddress: wallet,
            cursor: 'next-page',
        })

        const [requestUrl, requestInit] = fetchMock.mock.calls[0]
        const url = new URL(String(requestUrl))
        expect(url.pathname).toBe(`/api/v2.2/wallets/${wallet}/tokens`)
        expect(url.searchParams.get('chain')).toBe('bsc')
        expect(url.searchParams.get('exclude_spam')).toBe('false')
        expect(url.searchParams.get('exclude_unverified_contracts')).toBe('false')
        expect(url.searchParams.get('limit')).toBe('100')
        expect(url.searchParams.get('cursor')).toBe('next-page')
        expect(requestInit.headers['X-API-Key']).toBe('test-only-key')
    })
})
