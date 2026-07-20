import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import { ProviderError } from '../src/lib/errors.js'
import {
    ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST,
    chunkAlchemyPortfolioNetworks,
    getAlchemyPortfolioChainIds,
    getAlchemyPortfolioNetwork,
    getChainIdForAlchemyPortfolioNetwork,
    getUnsupportedPortfolioChainIds,
} from '../src/providers/alchemy/portfolio-networks.js'
import {
    ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY,
    clearAlchemyPortfolioSupportCacheForTest,
    fetchAlchemyPortfolioTokens,
} from '../src/providers/alchemy/portfolio-tokens.js'

const wallet = '0x1000000000000000000000000000000000000042'
const token = '0x00000000000000000000000000000000000000Aa'
const config = {
    apiKey: 'test-key',
    timeoutMs: 1_000,
    maxPages: 10,
}

function response(tokens: unknown[], pageKey?: string) {
    return new Response(JSON.stringify({
        data: { tokens, ...(pageKey ? { pageKey } : {}) },
    }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })
}

function record(overrides: Record<string, unknown> = {}) {
    return {
        address: wallet,
        network: 'bnb-mainnet',
        tokenAddress: token,
        tokenBalance: '1000000000000000000',
        tokenMetadata: {
            decimals: 18,
            logo: 'https://static.alchemy.example/token.png',
            name: 'Candidate token',
            symbol: 'CAND',
        },
        tokenPrices: [{ currency: 'usd', value: '2.5' }],
        ...overrides,
    }
}

describe('Alchemy Portfolio network mapping', () => {
    it('round-trips every explicit unique network identifier', () => {
        const networks = getAlchemyPortfolioChainIds().map((chainId) => {
            const network = getAlchemyPortfolioNetwork(chainId)
            expect(network).not.toBeNull()
            expect(getChainIdForAlchemyPortfolioNetwork(network!)).toBe(chainId)
            return network
        })
        expect(new Set(networks).size).toBe(networks.length)
        expect(getAlchemyPortfolioNetwork(56)).toBe('bnb-mainnet')
    })

    it('reports unsupported chains without guessing a network', () => {
        expect(getUnsupportedPortfolioChainIds([56, 25, 34443, 25]))
            .toEqual([25, 34443])
        expect(getAlchemyPortfolioNetwork(34443)).toBeNull()
        expect(getAlchemyPortfolioNetwork(1088)).toBe('metis-mainnet')
        expect(getChainIdForAlchemyPortfolioNetwork('shape-mainnet')).toBeNull()
    })

    it('deduplicates deterministically and enforces the five-network batch limit', () => {
        const input = [
            'bnb-mainnet',
            'eth-mainnet',
            'bnb-mainnet',
            'polygon-mainnet',
            'arb-mainnet',
            'base-mainnet',
            'opt-mainnet',
        ]
        expect(chunkAlchemyPortfolioNetworks(input)).toEqual([
            [
                'bnb-mainnet',
                'eth-mainnet',
                'polygon-mainnet',
                'arb-mainnet',
                'base-mainnet',
            ],
            ['opt-mainnet'],
        ])
        expect(input).toHaveLength(7)
        expect(() => chunkAlchemyPortfolioNetworks([''])).toThrow()
        expect(() => chunkAlchemyPortfolioNetworks(['unknown-mainnet'])).toThrow()
        expect(() => chunkAlchemyPortfolioNetworks(['eth-mainnet'], 6)).toThrow()
        expect(ALCHEMY_PORTFOLIO_MAX_NETWORKS_PER_REQUEST).toBe(5)
    })
})

describe('Alchemy Portfolio token provider', () => {
    beforeEach(() => clearAlchemyPortfolioSupportCacheForTest())

    it('sends supported networks in one valid batch and normalizes metadata, prices, and balances', async () => {
        const fetchImpl = vi.fn(async () => response([
            record(),
            record({
                tokenAddress: null,
                tokenBalance: '0x2a',
                tokenMetadata: null,
                tokenPrices: [],
            }),
        ]))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet.toUpperCase(),
            chainIds: [56, 1],
        }, { fetchImpl, config })

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)
        expect(body.addresses).toEqual([{
            address: wallet,
            networks: ['eth-mainnet', 'bnb-mainnet'],
        }])
        expect(body).toMatchObject({
            withMetadata: true,
            withPrices: true,
            includeNativeTokens: true,
            includeErc20Tokens: true,
        })
        expect(result.tokens).toEqual(expect.arrayContaining([
            expect.objectContaining({
                chainId: 56,
                address: token.toLowerCase(),
                rawBalance: '1000000000000000000',
                marketPriceUSD: '2.5',
                metadata: expect.objectContaining({ symbol: 'CAND', decimals: 18 }),
            }),
            expect.objectContaining({
                chainId: 56,
                address: NATIVE_TOKEN_ADDRESS,
                isNative: true,
                rawBalance: '42',
            }),
        ]))
    })

    it.each([
        [1, 1],
        [5, 1],
        [6, 2],
        [20, 4],
    ])('uses %i supported networks in %i request batches', async (
        networkCount,
        requestCount,
    ) => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, networkCount)
        const fetchImpl = vi.fn(async () => response([]))
        await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config })

        expect(fetchImpl).toHaveBeenCalledTimes(requestCount)
        for (const call of fetchImpl.mock.calls) {
            const body = JSON.parse(String(call[1]?.body))
            expect(body.addresses[0].networks.length).toBeLessThanOrEqual(5)
        }
    })

    it('sorts chain IDs before deterministic batching', async () => {
        const chainIds = [...getAlchemyPortfolioChainIds().slice(0, 6)].reverse()
        const fetchImpl = vi.fn(async () => response([]))
        await fetchAlchemyPortfolioTokens({ walletAddress: wallet, chainIds }, {
            fetchImpl,
            config,
        })
        const requestedNetworks = fetchImpl.mock.calls.map((call) =>
            JSON.parse(String(call[1]?.body)).addresses[0].networks,
        )
        const expectedNetworks = [...chainIds]
            .sort((left, right) => left - right)
            .map((chainId) => getAlchemyPortfolioNetwork(chainId))
        expect(requestedNetworks.flat()).toEqual(expectedNetworks)
    })

    it('keeps independent pageKey sequences for every batch', async () => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, 6)
        const callsByBatch = new Map<string, number>()
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            const batch = body.addresses[0].networks.join(',')
            const count = callsByBatch.get(batch) ?? 0
            callsByBatch.set(batch, count + 1)
            if (count === 0) return response([], `page-for-${batch}`)
            expect(body.pageKey).toBe(`page-for-${batch}`)
            return response([])
        })
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config })

        expect(fetchImpl).toHaveBeenCalledTimes(4)
        expect([...callsByBatch.values()]).toEqual([2, 2])
        expect(result.pageCount).toBe(4)
    })

    it('contains a later-page failure to its originating batch', async () => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, 6)
        const callsByBatch = new Map<string, number>()
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            const batch = body.addresses[0].networks.join(',')
            const count = callsByBatch.get(batch) ?? 0
            callsByBatch.set(batch, count + 1)
            if (body.addresses[0].networks.length === 5) {
                return count === 0
                    ? response([record({ network: body.addresses[0].networks[0] })], 'next')
                    : new Response('{}', { status: 503 })
            }
            return response([record({ network: body.addresses[0].networks[0] })])
        })
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config })

        expect(result.tokens).toHaveLength(1)
        expect(result.successfulChainIds).toHaveLength(1)
        expect(result.failedChainIds).toHaveLength(5)
        expect(result.partial).toBe(true)
    })

    it('applies maximum-page protection independently to every batch', async () => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, 6)
        const fetchImpl = vi.fn(async () => response([], 'more'))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config: { ...config, maxPages: 1 } })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        expect(result.batches).toHaveLength(2)
        expect(result.batches.every((batch) =>
            batch.failureCode === 'ALCHEMY_PORTFOLIO_MAX_PAGES_REACHED')).toBe(true)
        expect(result.partial).toBe(true)
    })

    it('never runs more than two network batches concurrently', async () => {
        let active = 0
        let maximum = 0
        const fetchImpl = vi.fn(async () => {
            active += 1
            maximum = Math.max(maximum, active)
            await new Promise((resolve) => setTimeout(resolve, 5))
            active -= 1
            return response([])
        })
        await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: getAlchemyPortfolioChainIds(),
        }, { fetchImpl, config })
        expect(fetchImpl).toHaveBeenCalledTimes(4)
        expect(maximum).toBe(ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY)
    })

    it('preserves successful batch tokens and reports safe failed-batch diagnostics', async () => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, 6)
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            const networks = body.addresses[0].networks
            if (networks.length === 5) {
                return new Response('raw upstream secret', { status: 503 })
            }
            return response([record({ network: networks[0] })])
        })
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config })

        expect(result.tokens).toHaveLength(1)
        expect(result.partial).toBe(true)
        expect(result.failedChainIds).toHaveLength(5)
        expect(result.successfulChainIds).toHaveLength(1)
        expect(result.batchErrors).toEqual([{
            batchIndex: 0,
            chainIds: expect.any(Array),
            code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
        }])
        expect(JSON.stringify(result)).not.toContain('raw upstream secret')
    })

    it('recursively isolates one invalid network and preserves four valid networks', async () => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, 5)
        const badNetwork = getAlchemyPortfolioNetwork(chainIds[2])!
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            const networks: string[] = body.addresses[0].networks
            if (networks.includes(badNetwork)) {
                return new Response('{}', { status: 400 })
            }
            return response(networks.map((network) => record({ network })))
        })
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config })

        expect(result.successfulChainIds).toHaveLength(4)
        expect(result.failedChainIds).toEqual([])
        expect(result.providerRejectedChainIds).toEqual([chainIds[2]])
        expect(result.tokens).toHaveLength(4)
        expect(result.partial).toBe(true)
        expect(fetchImpl.mock.calls.every((call) =>
            JSON.parse(String(call[1]?.body)).addresses[0].networks.length <= 5,
        )).toBe(true)
    })

    it.each([401, 403, 429, 500])(
        'does not recursively split an HTTP %i failure',
        async (status) => {
            const fetchImpl = vi.fn(async () => new Response('{}', { status }))
            await expect(fetchAlchemyPortfolioTokens({
                walletAddress: wallet,
                chainIds: getAlchemyPortfolioChainIds().slice(0, 5),
            }, { fetchImpl, config })).rejects.toBeInstanceOf(ProviderError)
            expect(fetchImpl).toHaveBeenCalledTimes(1)
        },
    )

    it('caches only confirmed singleton provider rejection outcomes', async () => {
        const rejectedFetch = vi.fn(async () =>
            new Response('{}', { status: 400 }))
        const first = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl: rejectedFetch, config })
        expect(first.providerRejectedChainIds).toEqual([56])
        expect(first.queriedChainIds).toEqual([56])

        const omittedFetch = vi.fn(async () => response([]))
        const second = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl: omittedFetch, config })
        expect(omittedFetch).not.toHaveBeenCalled()
        expect(second.queriedChainIds).toEqual([])
        expect(second.providerRejectedChainIds).toEqual([56])

        clearAlchemyPortfolioSupportCacheForTest()
        const temporaryFetch = vi.fn(async () =>
            new Response('{}', { status: 503 }))
        await expect(fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl: temporaryFetch, config })).rejects.toMatchObject({
            code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
        })
        const retryFetch = vi.fn(async () => response([]))
        await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl: retryFetch, config })
        expect(retryFetch).toHaveBeenCalledOnce()
    })

    it('rejects records claiming a network outside their originating batch', async () => {
        const chainIds = getAlchemyPortfolioChainIds().slice(0, 6)
        const sortedNetworks = [...chainIds]
            .sort((left, right) => left - right)
            .map((chainId) => getAlchemyPortfolioNetwork(chainId)!)
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(String(options?.body))
            return body.addresses[0].networks.length === 5
                ? response([record({ network: sortedNetworks[5] })])
                : response([record({ network: 'invalid-mainnet' })])
        })
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds,
        }, { fetchImpl, config })
        expect(result.tokens).toEqual([])
        expect(result.skippedRecordCount).toBe(2)
        expect(result.partial).toBe(true)
    })

    it('returns a safe non-200 provider error when every batch fails', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response('private upstream body', { status: 503 }))
        const promise = fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: getAlchemyPortfolioChainIds().slice(0, 6),
        }, { fetchImpl, config })
        await expect(promise).rejects.toMatchObject({
            code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            statusCode: 503,
            retryable: true,
        })
        await promise.catch((error: ProviderError) => {
            expect(error.message).not.toContain('private upstream body')
        })
    })

    it('follows pageKey and stops when it disappears', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response([record()], 'next'))
            .mockResolvedValueOnce(response([record({ tokenAddress: null })]))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl, config })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string).pageKey)
            .toBe('next')
        expect(result.pageCount).toBe(2)
    })

    it('stops safely on a repeated page key', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response([record()], 'repeat'))
            .mockResolvedValueOnce(response([], 'repeat'))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl, config })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        expect(result).toMatchObject({
            partial: true,
            failureCode: 'ALCHEMY_PORTFOLIO_PAGE_KEY_REPEATED',
        })
    })

    it('stops at the configured maximum page count', async () => {
        const fetchImpl = vi.fn(async () => response([], 'more'))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl, config: { ...config, maxPages: 1 } })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(result.failureCode).toBe('ALCHEMY_PORTFOLIO_MAX_PAGES_REACHED')
    })

    it('keeps very large balances exact, filters zeroes, and deduplicates identities', async () => {
        const large = '340282366920938463463374607431768211455'
        const fetchImpl = vi.fn(async () => response([
            record({ tokenBalance: large }),
            record({ tokenBalance: `0x${BigInt(large).toString(16)}` }),
            record({
                tokenAddress: '0x00000000000000000000000000000000000000bb',
                tokenBalance: '0',
            }),
        ]))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl, config })
        expect(result.tokens).toHaveLength(1)
        expect(result.tokens[0].rawBalance).toBe(large)
    })

    it('skips malformed and unknown-network records without losing valid tokens', async () => {
        const fetchImpl = vi.fn(async () => response([
            null,
            record({ network: 'shape-mainnet' }),
            record({ tokenBalance: '1e18' }),
            record(),
        ]))
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56, 34443],
        }, { fetchImpl, config })
        expect(result.tokens).toHaveLength(1)
        expect(result.unsupportedChainIds).toEqual([34443])
        expect(result.skippedRecordCount).toBe(3)
        expect(result.partial).toBe(true)
    })

    it.each([
        [429, 'ALCHEMY_PORTFOLIO_RATE_LIMITED', true],
        [401, 'ALCHEMY_PORTFOLIO_AUTH_FAILED', false],
        [403, 'ALCHEMY_PORTFOLIO_AUTH_FAILED', false],
        [500, 'ALCHEMY_PORTFOLIO_UNAVAILABLE', true],
    ])('maps HTTP %i to a safe provider error', async (status, code, retryable) => {
        const fetchImpl = vi.fn(async () => new Response('secret provider body', { status }))
        const promise = fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, { fetchImpl, config })
        await expect(promise).rejects.toMatchObject({ code, retryable })
        await promise.catch((error: ProviderError) => {
            expect(error.message).not.toContain('secret provider body')
            expect(JSON.stringify(error)).not.toContain(config.apiKey)
        })
    })

    it('maps malformed success, timeout, and network failures to stable codes', async () => {
        const malformed = fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, {
            fetchImpl: vi.fn(async () => new Response('{', { status: 200 })),
            config,
        })
        await expect(malformed).rejects.toMatchObject({
            code: 'ALCHEMY_PORTFOLIO_RESPONSE_INVALID',
        })

        const timeoutFetch = vi.fn((_url, options) =>
            new Promise<Response>((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => {
                    reject(options.signal?.reason)
                }, { once: true })
            }))
        await expect(fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, {
            fetchImpl: timeoutFetch,
            config: { ...config, timeoutMs: 5 },
        })).rejects.toMatchObject({ code: 'ALCHEMY_PORTFOLIO_TIMEOUT' })

        await expect(fetchAlchemyPortfolioTokens({
            walletAddress: wallet,
            chainIds: [56],
        }, {
            fetchImpl: vi.fn(async () => {
                throw new TypeError('network failed')
            }),
            config,
        })).rejects.toMatchObject({ code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE' })
    })
})
