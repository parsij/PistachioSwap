import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTokenPrices } from '../src/providers/alchemy/token-prices.js'

import { tokenPriceInternals } from '../src/providers/alchemy/token-prices.js'

const {
    ALCHEMY_TOKEN_PRICE_BATCH_SIZE,
    clearCacheForTest,
    normalizeUsdPrice,
    resolveNativePriceSources,
} = tokenPriceInternals

function tokenAddress(index: number) {
    return `0x${index.toString(16).padStart(40, '0')}`
}

function responseFor(addresses: readonly string[], missing = new Set<string>()) {
    return new Response(JSON.stringify({
        data: addresses.map((address, index) => ({
            address,
            prices: missing.has(address.toLowerCase())
                ? []
                : [{ currency: 'usd', value: String(index + 1) }],
        })),
    }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function failedResponse(status = 400) {
    return new Response(JSON.stringify({ message: 'Maximum 25 addresses per request' }), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

function requestBatches(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.map(([, init]) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        return body.addresses.map((item: { address: string }) => item.address)
    })
}

function mockAlchemy(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubEnv('ALCHEMY_API_KEY', 'test-only-key')
    vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
    clearCacheForTest()
})

afterEach(() => {
    clearCacheForTest()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('provider USD price normalization', () => {
    it('keeps values that already fit USD micros', () => {
        expect(normalizeUsdPrice('4187.123456')).toBe('4187.123456')
        expect(normalizeUsdPrice('4187.12')).toBe('4187.12')
        expect(normalizeUsdPrice('4187')).toBe('4187')
    })

    it('rounds provider values with more than six decimal places', () => {
        expect(normalizeUsdPrice('4187.1234564')).toBe('4187.123456')
        expect(normalizeUsdPrice('4187.1234565')).toBe('4187.123457')
        expect(normalizeUsdPrice('0.9999999')).toBe('1')
    })

    it('rejects invalid provider values without using floating point math', () => {
        expect(normalizeUsdPrice('-1')).toBeNull()
        expect(normalizeUsdPrice('1e3')).toBeNull()
        expect(normalizeUsdPrice('not-a-price')).toBeNull()
    })
})

describe('trusted native price fallback', () => {
    it('uses Moralis wrapped-native pricing when Alchemy has no usable native price', async () => {
        const alchemy = vi.fn().mockResolvedValue(null)
        const moralis = vi.fn().mockResolvedValue('742.123456')
        const coinGecko = vi.fn().mockResolvedValue('743.000000')

        await expect(resolveNativePriceSources(56, [
            { provider: 'alchemy', load: alchemy },
            { provider: 'moralis', load: moralis },
            { provider: 'coingecko', load: coinGecko },
        ])).resolves.toEqual({
            value: '742.123456',
            provider: 'moralis',
        })

        expect(alchemy).toHaveBeenCalledTimes(1)
        expect(moralis).toHaveBeenCalledTimes(1)
        expect(coinGecko).not.toHaveBeenCalled()
    })

    it('continues after provider errors and uses CoinGecko as the final fallback', async () => {
        const alchemy = vi.fn().mockRejectedValue(new Error('alchemy unavailable'))
        const moralis = vi.fn().mockResolvedValue(null)
        const coinGecko = vi.fn().mockResolvedValue('744.5')

        await expect(resolveNativePriceSources(56, [
            { provider: 'alchemy', load: alchemy },
            { provider: 'moralis', load: moralis },
            { provider: 'coingecko', load: coinGecko },
        ])).resolves.toEqual({
            value: '744.5',
            provider: 'coingecko',
        })
    })

    it('returns null only after every trusted provider fails or returns no price', async () => {
        await expect(resolveNativePriceSources(56, [
            { provider: 'alchemy', load: async () => null },
            { provider: 'moralis', load: async () => null },
            { provider: 'coingecko', load: async () => null },
        ])).resolves.toBeNull()
    })
})

describe('Alchemy token-price batching', () => {
    it('uses the documented Alchemy batch size', () => {
        expect(ALCHEMY_TOKEN_PRICE_BATCH_SIZE).toBe(25)
    })

    it('sends zero provider requests for zero addresses', async () => {
        const fetchMock = vi.fn()
        mockAlchemy(fetchMock)

        await expect(getTokenPrices({ addresses: [] })).resolves.toEqual(new Map())
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([
        [1, [1]],
        [25, [25]],
        [26, [25, 1]],
        [50, [25, 25]],
        [51, [25, 25, 1]],
    ])('splits %i addresses into request sizes %j', async (count, sizes) => {
        const addresses = Array.from({ length: count }, (_, index) => tokenAddress(index + 1))
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            return responseFor(body.addresses.map((item: { address: string }) => item.address))
        })
        mockAlchemy(fetchMock)

        await getTokenPrices({ addresses })

        expect(requestBatches(fetchMock).map((batch) => batch.length)).toEqual(sizes)
        expect(requestBatches(fetchMock).every((batch) => batch.length <= 25)).toBe(true)
    })

    it('deduplicates and removes invalid addresses before batching', async () => {
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            return responseFor(body.addresses.map((item: { address: string }) => item.address))
        })
        mockAlchemy(fetchMock)
        const valid = tokenAddress(1)

        await getTokenPrices({
            addresses: [
                valid,
                valid.toUpperCase(),
                'not-an-address',
                '0x1234',
                tokenAddress(2),
            ],
        })

        expect(requestBatches(fetchMock)).toEqual([[valid, tokenAddress(2)]])
    })

    it('merges successful batch results into one map', async () => {
        const addresses = Array.from({ length: 26 }, (_, index) => tokenAddress(index + 1))
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            return responseFor(body.addresses.map((item: { address: string }) => item.address))
        })
        mockAlchemy(fetchMock)

        const prices = await getTokenPrices({ addresses })

        expect(prices.size).toBe(26)
        expect(prices.get(tokenAddress(1))).toBe('1')
        expect(prices.get(tokenAddress(26))).toBe('1')
    })

    it('caches explicit no-price rows as null in best-effort mode', async () => {
        const address = tokenAddress(1)
        const fetchMock = vi.fn(async () => responseFor([address], new Set([address])))
        mockAlchemy(fetchMock)

        await expect(getTokenPrices({ addresses: [address] })).resolves.toEqual(new Map())
        await expect(getTokenPrices({ addresses: [address] })).resolves.toEqual(new Map())

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('preserves successful batches in best-effort mode when one batch fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const addresses = Array.from({ length: 26 }, (_, index) => tokenAddress(index + 1))
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            const batch = body.addresses.map((item: { address: string }) => item.address)
            return batch.length === 1 ? failedResponse() : responseFor(batch)
        })
        mockAlchemy(fetchMock)

        const prices = await getTokenPrices({ addresses })

        expect(prices.size).toBe(25)
        expect(prices.has(tokenAddress(26))).toBe(false)
        expect(warn).toHaveBeenCalledWith('[alchemy-token-prices-batch-failed]', expect.objectContaining({
            chainId: 56,
            batch: '2-of-2',
            batchSize: 1,
        }))
    })

    it('does not cache failed-batch addresses as null', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const addresses = Array.from({ length: 26 }, (_, index) => tokenAddress(index + 1))
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            const batch = body.addresses.map((item: { address: string }) => item.address)
            if (fetchMock.mock.calls.length === 2) return failedResponse()
            return responseFor(batch)
        })
        mockAlchemy(fetchMock)

        await getTokenPrices({ addresses })
        const retried = await getTokenPrices({ addresses: [tokenAddress(26)] })

        expect(retried).toEqual(new Map([[tokenAddress(26), '1']]))
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('rejects strict mode when one batch fails', async () => {
        const addresses = Array.from({ length: 26 }, (_, index) => tokenAddress(index + 1))
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            const batch = body.addresses.map((item: { address: string }) => item.address)
            return batch.length === 1 ? failedResponse() : responseFor(batch)
        })
        mockAlchemy(fetchMock)

        await expect(getTokenPrices({
            addresses,
            requireProviderSuccess: true,
        })).rejects.toMatchObject({
            code: 'TRUSTED_PRICE_PROVIDER_UNAVAILABLE',
            upstreamStatus: 400,
        })
    })

    it('deduplicates concurrent identical batch requests', async () => {
        const addresses = Array.from({ length: 25 }, (_, index) => tokenAddress(index + 1))
        let resolveFetch: ((value: Response) => void) | null = null
        const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
            resolveFetch = resolve
        }))
        mockAlchemy(fetchMock)

        const first = getTokenPrices({ addresses })
        const second = getTokenPrices({ addresses: addresses.toReversed() })
        resolveFetch?.(responseFor(addresses))

        await expect(Promise.all([first, second])).resolves.toHaveLength(2)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('stops scheduling remaining batches after abort', async () => {
        const addresses = Array.from({ length: 51 }, (_, index) => tokenAddress(index + 1))
        const controller = new AbortController()
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            controller.abort(new DOMException('aborted', 'AbortError'))
            return responseFor(body.addresses.map((item: { address: string }) => item.address))
        })
        mockAlchemy(fetchMock)

        await getTokenPrices({ addresses, signal: controller.signal })

        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2)
        expect(requestBatches(fetchMock).every((batch) => batch.length <= 25)).toBe(true)
    })

    it.each([56, 8453])('keeps chain %i requests under Alchemy address limits', async (chainId) => {
        const addresses = Array.from({ length: 51 }, (_, index) => tokenAddress(chainId * 100 + index))
        const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
            const body = JSON.parse(String(init.body))
            const batch = body.addresses.map((item: { address: string }) => item.address)
            if (batch.length > 25) return failedResponse()
            return responseFor(batch)
        })
        mockAlchemy(fetchMock)

        await expect(getTokenPrices({ chainId, addresses })).resolves.toHaveProperty('size', 51)
        expect(requestBatches(fetchMock).map((batch) => batch.length)).toEqual([25, 25, 1])
    })
})
