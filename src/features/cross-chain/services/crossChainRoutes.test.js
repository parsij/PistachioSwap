import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    authenticateCrossChainWallet,
    claimCrossChainRoute,
    compareDecimalStrings,
    compareIntegerStrings,
    createCrossChainRouteRequest,
    CROSS_CHAIN_SORTS,
    fetchCrossChainRoutes,
    formatTokenAmount,
    getProviderDisplayName,
    getOrderedEvmSteps,
    normalizeCrossChainRoute,
    normalizeCrossChainRouteResponse,
    isExecutableCrossChainRouteForRequest,
    normalizePreparedCrossChainRoute,
    markCrossChainRouteSubmitted,
    persistPublicRouteId,
    readPersistedPublicRouteId,
    sortCrossChainRoutes,
    withPreparedSourceGasCosts,
} from './crossChainRoutes.js'

function route(overrides = {}) {
    return normalizeCrossChainRoute({
        id: overrides.id ?? 'route-a',
        provider: overrides.provider ?? 'Relay',
        state: overrides.state ?? 'quote-ready',
        executionModel: overrides.executionModel ?? 'evm-transaction',
        sourceChainId: 56,
        destinationChainId: 1,
        amountIn: '100',
        amountOut: overrides.amountOut ?? '110',
        fees: {
            totalUsd: Object.hasOwn(overrides, 'fee')
                ? overrides.fee
                : '1.5',
        },
        estimatedDurationSeconds: overrides.duration ?? 60,
        expiresAt: '2030-01-01T00:00:00.000Z',
    })
}

describe('cross-chain route normalization', () => {
    it('preserves provider-neutral partial costs without Relay-specific frontend fields', () => {
        const normalized = normalizeCrossChainRoute({
            id: 'partial-costs',
            provider: 'across',
            state: 'quote-ready',
            executionModel: 'evm-transaction',
            sourceChainId: 56,
            destinationChainId: 8453,
            inputAmount: '100',
            outputAmount: '90',
            minimumOutputAmount: '89',
            costs: {
                providerFeeUsd: '0.04',
                sourceGasUsd: null,
                confidence: 'quote',
            },
            costBreakdownAvailable: true,
        })

        expect(normalized.costs).toMatchObject({
            sourceGasUsd: null,
            providerFeeUsd: '0.04',
            confidence: 'quote',
        })
        expect(normalized).not.toHaveProperty('relayerService')
        expect(normalized.minimumOutputAmount).toBe('89')
    })

    it('adds prepared source gas without changing minimum received', () => {
        const costs = withPreparedSourceGasCosts({
            routeCostUsd: '0.04',
            confidence: 'quote',
        }, {
            sourceGasNative: '0.0001',
            sourceGasUsd: '0.06',
        })
        expect(costs).toMatchObject({
            sourceGasUsd: '0.06',
            routeCostUsd: '0.04',
            totalEstimatedUsd: '0.1',
            confidence: 'prepared',
        })
    })

    it('formats token base units with string arithmetic and professional provider names', () => {
        expect(formatTokenAmount('13373449432189293605', 18)).toBe('13.373449')
        expect(formatTokenAmount('1', 18)).toBe('<0.000001')
        expect(formatTokenAmount('1200000', 6)).toBe('1.2')
        expect(getProviderDisplayName('relay')).toBe('Relay')
        expect(getProviderDisplayName('debridge-dln')).toBe('deBridge DLN')
        expect(formatTokenAmount.toString()).not.toContain('Number(rawAmount)')
    })
    it('normalizes provider payloads and sorts each user priority deterministically', () => {
        const routes = [
            route({ id: 'a', amountOut: '110', fee: '2', duration: 80 }),
            route({ id: 'b', amountOut: '105', fee: '1', duration: 20 }),
        ]
        expect(sortCrossChainRoutes(routes, CROSS_CHAIN_SORTS.RETURN)[0].id).toBe('a')
        expect(sortCrossChainRoutes(routes, CROSS_CHAIN_SORTS.FASTEST)[0].id).toBe('b')
        expect(sortCrossChainRoutes(routes, CROSS_CHAIN_SORTS.FEES)[0].id).toBe('b')
    })

    it('retains the backend-selected route separately from the preview list', () => {
        const first = route({ id: 'a' })
        const second = route({ id: 'b' })
        const response = normalizeCrossChainRouteResponse({
            selectedRoute: second,
            routes: [first, second],
        })
        expect(response.selectedRoute.id).toBe('b')
        expect(response.routes.map(({ id }) => id)).toEqual(['a', 'b'])
    })

    it('builds the canonical backend quote request', () => {
        const request = createCrossChainRouteRequest({
            sourceChainId: 56,
            destinationChainId: 1,
            sourceToken: '0x0000000000000000000000000000000000000000',
            destinationToken: '0x0000000000000000000000000000000000000002',
            amount: '1000000000000000000',
            account: '0x0000000000000000000000000000000000000001',
            recipient: '0x0000000000000000000000000000000000000003',
            sourceDecimals: 18,
            slippageBps: 50,
        })
        expect(request).toMatchObject({
            mode: 'exactIn',
            sourceAsset: { chainId: 56, decimals: 18 },
            destinationAsset: { chainId: 1 },
            ownerAddress: '0x0000000000000000000000000000000000000001',
            recipient: '0x0000000000000000000000000000000000000003',
            walletCapabilities: {
                evmTransaction: true,
                depositChannel: true,
                vaultSwap: false,
            },
        })
    })

    it('canonicalizes the Celo alias in quote identity', () => {
        const request = createCrossChainRouteRequest({
            sourceChainId: 42220,
            destinationChainId: 8453,
            sourceToken: '0x471ece3750da237f93b8e339c536989b8978a438',
            destinationToken: '0x0000000000000000000000000000000000000002',
            amount: '1',
            account: '0x0000000000000000000000000000000000000001',
        })
        expect(request.sourceAsset.address)
            .toBe('0x0000000000000000000000000000000000000000')
    })

    it('accepts only routes delivering the exact selected destination token', async () => {
        const request = createCrossChainRouteRequest({
            sourceChainId: 56,
            destinationChainId: 1,
            sourceToken: '0x0000000000000000000000000000000000000001',
            destinationToken: '0x0000000000000000000000000000000000000002',
            amount: '100',
            account: '0x0000000000000000000000000000000000000003',
        })
        const payload = (destinationAddress) => ({
            selectedRoute: null,
            routes: [{
                publicRouteId: 'route-exact',
                provider: 'relay',
                state: 'quote-ready',
                executionModel: 'evm-transaction',
                sourceChainId: request.sourceAsset.chainId,
                destinationChainId: request.destinationAsset.chainId,
                sourceAsset: request.sourceAsset,
                destinationAsset: {
                    ...request.destinationAsset,
                    address: destinationAddress,
                    symbol: 'SAME',
                },
                recipient: request.recipient,
                inputAmount: '100',
                outputAmount: '90',
                minimumOutputAmount: '89',
                expiresAt: '2030-01-01T00:00:00.000Z',
            }],
        })
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => payload(request.destinationAsset.address),
        })
        vi.stubGlobal('fetch', fetchMock)
        await expect(fetchCrossChainRoutes({ endpoint: 'https://api.example', request }))
            .resolves.toMatchObject({ routes: [expect.objectContaining({ outputAmount: '90' })] })
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => payload('0x0000000000000000000000000000000000000004'),
        })
        await expect(fetchCrossChainRoutes({ endpoint: 'https://api.example', request }))
            .rejects.toThrow('exact selected destination asset')
        vi.unstubAllGlobals()
    })

    it('allows review only for a current executable route with exact request identity', () => {
        const request = createCrossChainRouteRequest({
            sourceChainId: 56,
            destinationChainId: 1,
            sourceToken: '0x0000000000000000000000000000000000000001',
            destinationToken: '0x0000000000000000000000000000000000000002',
            amount: '100',
            account: '0x0000000000000000000000000000000000000003',
        })
        const candidate = normalizeCrossChainRoute({
            publicRouteId: 'reviewable',
            provider: 'relay',
            state: 'quote-ready',
            executionModel: 'evm-transaction',
            sourceChainId: 56,
            destinationChainId: 1,
            sourceAsset: request.sourceAsset,
            destinationAsset: request.destinationAsset,
            recipient: request.recipient,
            inputAmount: '100',
            outputAmount: '90',
            minimumOutputAmount: '89',
            expiresAt: '2030-01-01T00:00:00.000Z',
        })

        expect(isExecutableCrossChainRouteForRequest(candidate, request)).toBe(true)
        expect(isExecutableCrossChainRouteForRequest({
            ...candidate,
            inputAmount: '101',
        }, request)).toBe(false)
        expect(isExecutableCrossChainRouteForRequest({
            ...candidate,
            expiresAt: '2020-01-01T00:00:00.000Z',
        }, request)).toBe(false)
        expect(isExecutableCrossChainRouteForRequest(null, request)).toBe(false)
    })

    it('maps structured cross-chain 503 codes to actionable messages', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: { code: 'CROSS_CHAIN_NOT_CONFIGURED' } }),
        }))
        const request = createCrossChainRouteRequest({
            sourceChainId: 56,
            destinationChainId: 1,
            sourceToken: '0x0000000000000000000000000000000000000001',
            destinationToken: '0x0000000000000000000000000000000000000002',
            amount: '100',
            account: '0x0000000000000000000000000000000000000003',
        })
        await expect(fetchCrossChainRoutes({ endpoint: 'https://api.example', request }))
            .rejects.toThrow('Cross-chain routing is not configured.')
        vi.unstubAllGlobals()
    })

    it('compares arbitrarily large integer amounts and decimal fees without Number coercion', () => {
        expect(compareIntegerStrings(
            '100000000000000000000000000000000000000',
            '99999999999999999999999999999999999999',
        )).toBeGreaterThan(0)
        expect(compareDecimalStrings('0.1000000000000000001', '0.10000000000000000009'))
            .toBeGreaterThan(0)
        expect(compareDecimalStrings(null, '999999999999999999999')).toBeGreaterThan(0)
    })

    it('sorts unknown fees last instead of claiming they are lowest', () => {
        const routes = [
            route({ id: 'unknown', fee: null }),
            route({ id: 'known', fee: '999999999999999999.1' }),
        ]
        expect(sortCrossChainRoutes(routes, CROSS_CHAIN_SORTS.FEES).map(({ id }) => id))
            .toEqual(['known', 'unknown'])
    })

    it('does not disclose a Chainflip deposit until the prepare response is normalized', () => {
        const quoted = normalizeCrossChainRoute({
            id: 'cf-1',
            provider: 'Chainflip',
            sourceChainId: 56,
            destinationChainId: 1,
            amountIn: '100',
            amountOut: '99',
            depositAddress: '0x0000000000000000000000000000000000000009',
        })
        expect(quoted.deposit).toBeUndefined()

        const prepared = normalizePreparedCrossChainRoute({
            id: 'cf-1',
            provider: 'Chainflip',
            deposit: {
                address: '0x0000000000000000000000000000000000000009',
                asset: {
                    chainId: 56,
                    address: '0x0000000000000000000000000000000000000000',
                    symbol: 'BNB',
                    decimals: 18,
                },
                minimumAmount: '100000000000000000',
                expiresAt: '2030-01-01T00:00:00.000Z',
            },
        })
        expect(prepared.deposit.address).toBe('0x0000000000000000000000000000000000000009')
        expect(prepared.deposit.minimumAmount).toBe('100000000000000000')
    })

    it('returns executable EVM steps in provider order and drops non-EVM steps', () => {
        const prepared = normalizePreparedCrossChainRoute({
            id: 'ordered',
            provider: 'Relay',
            steps: [
                { id: 'two', chainId: 1, transaction: { to: '0x2' } },
                { id: 'offchain', type: 'wait' },
                { id: 'one', chainId: 56, transaction: { to: '0x1' } },
            ],
        })
        expect(getOrderedEvmSteps(prepared).map((step) => step.id))
            .toEqual(['two', 'one'])
    })

    it('persists only the public route ID for reload status recovery', () => {
        const values = new Map()
        const storage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        }
        let replacedUrl = null
        const location = new URL('https://swap.example/bridge')
        persistPublicRouteId('public-123', {
            location,
            storage,
            history: {
                state: null,
                replaceState: (_state, _unused, url) => {
                    replacedUrl = String(url)
                },
            },
        })
        expect(replacedUrl).toBe('https://swap.example/bridge?route=public-123')
        expect(readPersistedPublicRouteId({ location, storage })).toBe('public-123')
        expect([...values.values()]).toEqual(['public-123'])
    })

    it('claims once and reports the returned source hash with backend field names', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'awaiting-source' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'source-submitted' }),
            })
        vi.stubGlobal('fetch', fetchMock)
        const options = {
            endpoint: 'https://api.example/v1/cross-chain',
            routeId: 'route-id',
            sessionToken: 'test-session-token-that-is-long-enough',
        }
        await claimCrossChainRoute(options)
        await markCrossChainRouteSubmitted({
            ...options,
            transactionHash: `0x${'a'.repeat(64)}`,
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[0][0]).toContain('/routes/route-id/claim')
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        })
        expect(fetchMock.mock.calls[0][1].headers.authorization)
            .toBe(`Bearer ${options.sessionToken}`)
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
            sourceTransactionHash: `0x${'a'.repeat(64)}`,
        })
        vi.unstubAllGlobals()
    })

    it('signs only the server challenge and returns an in-memory session', async () => {
        const signature = `0x${'12'.repeat(65)}`
        const signMessage = vi.fn().mockResolvedValue(signature)
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    challengeId: 'challenge-id',
                    message: 'chain-bound challenge',
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sessionToken: 'memory-only-token',
                    walletAddress: '0x0000000000000000000000000000000000000001',
                    chainId: 8453,
                }),
            })
        vi.stubGlobal('fetch', fetchMock)

        const session = await authenticateCrossChainWallet({
            endpoint: 'https://api.example/v1/cross-chain',
            walletAddress: '0x0000000000000000000000000000000000000001',
            sourceChainId: 8453,
            signMessage,
        })

        expect(signMessage).toHaveBeenCalledWith('chain-bound challenge')
        expect(session.sessionToken).toBe('memory-only-token')
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
            challengeId: 'challenge-id',
            signature,
        })
        vi.unstubAllGlobals()
    })
})
