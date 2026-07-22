import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getWalletTokens: vi.fn() }))

vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({
    WALLET_TOKEN_CLASSIFICATION_VERSION: 4,
    getWalletTokens: mocks.getWalletTokens,
    isCurrentWalletTokenRecord: (value: unknown) =>
        typeof value === 'object' && value !== null &&
        (value as { classificationVersion?: number }).classificationVersion === 5,
}))

import {
    clearAlchemyPortfolioWalletCacheForTest,
    getAlchemyPortfolioWalletTokens,
    setAlchemyPortfolioWalletCacheForTest,
} from '../src/providers/alchemy/portfolio-wallet-tokens.js'
import { clearAlchemyPortfolioSupportCacheForTest } from '../src/providers/alchemy/portfolio-tokens.js'

const walletA = '0x1000000000000000000000000000000000000042'
const walletB = '0x1000000000000000000000000000000000000043'

function providerResponse(wallet: string) {
    return new Response(JSON.stringify({ data: { tokens: [{
        address: wallet,
        network: 'bnb-mainnet',
        tokenAddress: null,
        tokenBalance: '1',
        tokenMetadata: null,
        tokenPrices: [],
    }] } }), { status: 200 })
}

describe('Alchemy Portfolio wallet cache', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearAlchemyPortfolioWalletCacheForTest()
        clearAlchemyPortfolioSupportCacheForTest()
        process.env.ALCHEMY_API_KEY = 'test-key'
        process.env.ALCHEMY_PORTFOLIO_CACHE_TTL_MS = '1000'
        process.env.ALCHEMY_PORTFOLIO_STALE_TTL_MS = '5000'
        mocks.getWalletTokens.mockImplementation(async ({ chainId, walletAddress }) => [{
            classificationVersion: 5,
            chainId,
            address: walletAddress,
        }])
    })

    it('shares one in-flight provider request for identical requests', async () => {
        let resolveFetch: (value: Response) => void = () => undefined
        const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
            resolveFetch = resolve
        }))
        const first = getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })
        const second = getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
        resolveFetch(providerResponse(walletA))
        await expect(Promise.all([first, second])).resolves.toHaveLength(2)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('never shares cache entries between wallet addresses', async () => {
        const fetchImpl = vi.fn(async (url, options) => {
            const body = JSON.parse(String(options?.body))
            return providerResponse(body.addresses[0].address)
        })
        await getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })
        await getAlchemyPortfolioWalletTokens({
            walletAddress: walletB,
            chainIds: [56],
            fetchImpl,
        })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('never shares cache entries between complete network sets', async () => {
        const fetchImpl = vi.fn(async () => providerResponse(walletA))
        await getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })
        await getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [1, 56],
            fetchImpl,
        })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it.each([
        ['v3', { classificationVersion: 3, tokens: [] }],
        ['malformed', { classificationVersion: 5, tokens: 'invalid' }],
    ])('ignores a %s legacy cache entry under v5', async (_name, value) => {
        setAlchemyPortfolioWalletCacheForTest({
            walletAddress: walletA,
            chainIds: [56],
            entry: {
                value,
                expiresAt: Date.now() + 60_000,
                staleUntil: Date.now() + 60_000,
                pageCount: 1,
                failureCode: null,
            },
        })
        const fetchImpl = vi.fn(async () => providerResponse(walletA))
        const result = await getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(result.classificationVersion).toBe(5)
        expect(result.diagnostics.cacheStatus).toBe('miss')
    })

    it('removes a failed in-flight request so a retry can succeed', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response('{}', { status: 503 }))
            .mockResolvedValueOnce(providerResponse(walletA))
        await expect(getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })).rejects.toMatchObject({ code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE' })
        await expect(getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [56],
            fetchImpl,
        })).resolves.toMatchObject({ stale: false })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('classifies successful batches while retaining failed batch diagnostics', async () => {
        const badNetwork = 'polygon-mainnet'
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            return body.addresses[0].networks.includes(badNetwork)
                ? new Response('{}', { status: 400 })
                : new Response(JSON.stringify({ data: { tokens: [] } }), {
                      status: 200,
                  })
        })
        const result = await getAlchemyPortfolioWalletTokens({
            walletAddress: walletA,
            chainIds: [1, 10, 56, 100, 137, 204],
            fetchImpl,
        })
        expect(result.partial).toBe(true)
        expect(result.successfulChainIds).toEqual([1, 10, 56, 100, 204])
        expect(result.failedChainIds).toEqual([])
        expect(result.providerRejectedChainIds).toEqual([137])
        expect(result.batchErrors[0]).toMatchObject({
            batchIndex: 0,
            code: 'ALCHEMY_PORTFOLIO_REQUEST_INVALID',
        })
        expect(mocks.getWalletTokens).toHaveBeenCalledTimes(5)
    })

    it('returns stale cached balances after a temporary provider failure', async () => {
        vi.useFakeTimers()
        try {
            const fetchImpl = vi.fn()
                .mockResolvedValueOnce(providerResponse(walletA))
                .mockResolvedValueOnce(new Response('{}', { status: 503 }))
            const fresh = await getAlchemyPortfolioWalletTokens({
                walletAddress: walletA,
                chainIds: [56],
                fetchImpl,
            })
            expect(fresh.stale).toBe(false)
            await vi.advanceTimersByTimeAsync(1_001)
            const stale = await getAlchemyPortfolioWalletTokens({
                walletAddress: walletA,
                chainIds: [56],
                fetchImpl,
            })
            expect(stale.stale).toBe(true)
            expect(stale.partial).toBe(true)
            expect(stale.tokens).toEqual(fresh.tokens)
            expect(stale.diagnostics.cacheStatus).toBe('stale')
        } finally {
            vi.useRealTimers()
        }
    })
})
