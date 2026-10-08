import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getWalletTokens: vi.fn(),
    getAlchemyPortfolioWalletTokens: vi.fn(),
    getConfiguredUnchainedChainIds: vi.fn(),
    getUnchainedWalletTokens: vi.fn(),
    isUnchainedWalletEnabled: vi.fn(),
}))

vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({
    getWalletTokens: mocks.getWalletTokens,
    WALLET_TOKEN_CLASSIFICATION_VERSION: 6,
}))

vi.mock('../src/providers/alchemy/portfolio-wallet-tokens.js', () => ({
    getAlchemyPortfolioWalletTokens: mocks.getAlchemyPortfolioWalletTokens,
    hasStaleAlchemyPortfolioWalletCache: () => false,
}))

vi.mock('../src/providers/unchained/wallet-tokens.js', () => ({
    getConfiguredUnchainedChainIds: mocks.getConfiguredUnchainedChainIds,
    getUnchainedWalletTokens: mocks.getUnchainedWalletTokens,
    isUnchainedWalletEnabled: mocks.isUnchainedWalletEnabled,
}))

import { createApp } from '../src/app.js'

const wallet = '0x1000000000000000000000000000000000000042'
const token = '0x0000000000000000000000000000000000000011'

function legacyToken(overrides = {}) {
    return {
        classificationVersion: 6,
        id: `56:${token}`,
        chainId: 56,
        address: token,
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 18,
        rawBalance: '1',
        formattedBalance: '1',
        balance: '1',
        recognitionStatus: 'recognized',
        recognitionReasons: ['coingecko-exact-contract'],
        verificationStatus: 'recognized',
        verificationReasons: ['coingecko-exact-contract'],
        spamStatus: 'clean',
        possibleSpam: false,
        verifiedContract: true,
        classificationTier: 'established',
        classificationReasons: ['established-market-asset'],
        securityStatus: 'low',
        securityReasons: ['minimum-liquidity-met'],
        visibility: 'primary',
        visibilityReasons: ['recognized-token'],
        priceConfidence: 'unknown',
        ...overrides,
    }
}

describe('wallet-token route', () => {
    const previousPortfolioEnabled = process.env.ALCHEMY_PORTFOLIO_ENABLED
    const previousAlchemyApiKey = process.env.ALCHEMY_API_KEY
    const previousAllChainDeadline = process.env.WALLET_TOKEN_ALL_CHAIN_DEADLINE_MS

    beforeEach(() => {
        process.env.WALLET_TOKEN_ALL_CHAIN_DEADLINE_MS = '600'
        mocks.isUnchainedWalletEnabled.mockReturnValue(false)
        mocks.getConfiguredUnchainedChainIds.mockReturnValue([])
        mocks.getWalletTokens.mockResolvedValue([])
    })

    afterEach(() => {
        vi.clearAllMocks()
        if (previousPortfolioEnabled === undefined) {
            delete process.env.ALCHEMY_PORTFOLIO_ENABLED
        } else {
            process.env.ALCHEMY_PORTFOLIO_ENABLED = previousPortfolioEnabled
        }
        if (previousAlchemyApiKey === undefined) delete process.env.ALCHEMY_API_KEY
        else process.env.ALCHEMY_API_KEY = previousAlchemyApiKey
        if (previousAllChainDeadline === undefined) {
            delete process.env.WALLET_TOKEN_ALL_CHAIN_DEADLINE_MS
        } else {
            process.env.WALLET_TOKEN_ALL_CHAIN_DEADLINE_MS = previousAllChainDeadline
        }
    })

    it('passes explicit refresh to the selected wallet provider', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'false'
        mocks.getWalletTokens.mockResolvedValue([legacyToken()])
        const app = await createApp()
        try {
            const response = await app.inject(`/v1/wallet-tokens?chainId=56&address=${wallet}&refresh=true`)
            expect(response.statusCode).toBe(200)
            expect(mocks.getWalletTokens).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }))
            const invalid = await app.inject(`/v1/wallet-tokens?chainId=56&address=${wallet}&refresh=garbage`)
            expect(invalid.statusCode).toBe(400)
        } finally { await app.close() }
    })

    it('returns normalized security fields without provider secrets', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'false'
        mocks.getWalletTokens.mockResolvedValue([{
            ...legacyToken(),
            recognitionStatus: 'unverified',
            recognitionReasons: [],
            verificationStatus: 'unverified',
            verificationReasons: [],
            spamStatus: 'unknown',
            possibleSpam: null,
            verifiedContract: null,
            spamReasons: ['moralis-spam-unknown'],
            classificationTier: 'hidden',
            classificationReasons: ['unverified-contract'],
            securityStatus: 'unknown',
            securityScore: null,
            securityReasons: ['security-provider-unavailable'],
            securityProviders: {
                honeypot: {
                    available: false, checkedAt: null, risk: null,
                    riskLevel: null, isHoneypot: null,
                },
                goPlus: { available: false, checkedAt: null, isHoneypot: null },
            },
            visibility: 'unverified',
            visibilityReasons: ['unverified-contract'],
        }])
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=56&address=${wallet}`,
        })
        await app.close()
        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            classificationVersion: 6,
            recognitionStatus: 'unverified',
            spamStatus: 'unknown',
            possibleSpam: null,
            verifiedContract: null,
            visibility: 'unverified',
            securityStatus: 'unknown',
        })
        expect(response.json().classificationVersion).toBe(6)
        expect(response.body).not.toMatch(/api.?key|authorization|access.?token/i)
    })

    it('uses Portfolio plus legacy coverage for all enabled chains', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        mocks.getAlchemyPortfolioWalletTokens.mockResolvedValue({
            classificationVersion: 6,
            address: wallet,
            source: 'alchemy-portfolio',
            tokens: [],
            queriedChainIds: [1, 56],
            successfulChainIds: [1, 56],
            failedChainIds: [],
            providerRejectedChainIds: [],
            chainErrors: {},
            batchErrors: [],
            partial: false,
            stale: false,
            diagnostics: {
                pageCount: 1,
                cacheStatus: 'miss',
                failureCode: null,
            },
        })
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(mocks.getAlchemyPortfolioWalletTokens).toHaveBeenCalledTimes(1)
        const requested = mocks.getAlchemyPortfolioWalletTokens.mock.calls[0][0]
        expect(requested.chainIds).toEqual(expect.arrayContaining([1, 56]))
        expect(response.json()).toMatchObject({
            source: 'alchemy-portfolio',
            provider: 'alchemy-portfolio',
            stale: false,
            partial: false,
        })
        expect(response.json().unsupportedChainIds).toEqual([])
        expect(response.json().queriedChainIds).toEqual(expect.arrayContaining([
            1,
            56,
            25,
            1284,
            34443,
            167000,
        ]))
        expect(response.json().failedChainIds).toEqual([])
        expect(response.json().diagnostics.attemptedProviders)
            .toEqual(expect.arrayContaining(['alchemy-portfolio', 'legacy']))
    })

    it('returns HTTP 200 and keeps balances when a Portfolio batch is recovered', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        mocks.getAlchemyPortfolioWalletTokens.mockResolvedValue({
            classificationVersion: 6,
            address: wallet,
            source: 'alchemy-portfolio',
            tokens: [legacyToken()],
            queriedChainIds: [1, 56],
            successfulChainIds: [56],
            failedChainIds: [1],
            providerRejectedChainIds: [],
            chainErrors: { 1: 'This network balance could not be refreshed.' },
            batchErrors: [{
                batchIndex: 0,
                chainIds: [1],
                code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            }],
            partial: true,
            stale: false,
            diagnostics: {
                pageCount: 1,
                cacheStatus: 'miss',
                failureCode: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            },
        })
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            partial: false,
            stale: false,
            successfulChainIds: expect.arrayContaining([1, 56]),
            failedChainIds: [],
            providerRejectedChainIds: [],
            tokens: [expect.objectContaining({ chainId: 56, address: token })],
        })
        expect(response.body).not.toContain('Wallet balances could not be loaded.')
    })

    it('falls back safely after a total uncached Portfolio failure', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        const { ProviderError } = await import('../src/lib/errors.js')
        mocks.getAlchemyPortfolioWalletTokens.mockRejectedValue(new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            message: 'Wallet balances are temporarily unavailable.',
            statusCode: 503,
            retryable: true,
        }))
        mocks.getWalletTokens.mockImplementation(async ({ chainId }) =>
            chainId === 56 ? [legacyToken()] : [])
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            source: 'legacy',
            provider: 'legacy',
            diagnostics: {
                provider: 'legacy',
                attemptedProviders: expect.arrayContaining(['alchemy-portfolio', 'legacy']),
            },
            tokens: [expect.objectContaining({ address: token, rawBalance: '1' })],
        })
        expect(response.body).not.toMatch(/test-key|api\.g\.alchemy/i)
    })

    it('removes stale provider rejection metadata after a chain is recovered', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'false'
        mocks.isUnchainedWalletEnabled.mockReturnValue(true)
        mocks.getConfiguredUnchainedChainIds.mockReturnValue([56])
        mocks.getUnchainedWalletTokens.mockResolvedValue({
            classificationVersion: 6,
            address: wallet,
            source: 'unchained',
            tokens: [],
            queriedChainIds: [56],
            successfulChainIds: [],
            failedChainIds: [],
            providerRejectedChainIds: [56],
            chainErrors: { 56: 'Unchained rejected the chain.' },
            batchErrors: [],
            partial: true,
            stale: false,
            diagnostics: {
                pageCount: 0,
                cacheStatus: 'miss',
                failureCode: 'UNCHAINED_PARTIAL',
            },
        })
        mocks.getWalletTokens.mockResolvedValue([legacyToken()])

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            successfulChainIds: expect.arrayContaining([56]),
            failedChainIds: [],
            providerRejectedChainIds: [],
            chainErrors: {},
            tokens: [expect.objectContaining({ address: token, rawBalance: '1' })],
        })
    })

    it('returns partial HTTP 200 before the aggregate deadline when an optional provider hangs after BNB succeeds', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        mocks.isUnchainedWalletEnabled.mockReturnValue(true)
        mocks.getConfiguredUnchainedChainIds.mockReturnValue([56])
        mocks.getUnchainedWalletTokens.mockResolvedValue({
            classificationVersion: 6,
            address: wallet,
            source: 'unchained',
            tokens: [legacyToken()],
            queriedChainIds: [56],
            successfulChainIds: [56],
            failedChainIds: [],
            providerRejectedChainIds: [],
            chainErrors: {},
            batchErrors: [],
            partial: false,
            stale: false,
            diagnostics: {
                pageCount: 0,
                cacheStatus: 'miss',
                failureCode: null,
            },
        })
        mocks.getAlchemyPortfolioWalletTokens.mockImplementation(() =>
            new Promise(() => undefined))

        const app = createApp()
        const startedAt = Date.now()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(Date.now() - startedAt).toBeLessThan(1_500)
        expect(response.statusCode).toBe(200)
        expect(response.body).toBeTruthy()
        expect(response.json()).toMatchObject({
            partial: true,
            successfulChainIds: expect.arrayContaining([56]),
            tokens: [expect.objectContaining({ chainId: 56, rawBalance: '1' })],
        })
        expect(response.json().failedChainIds).not.toContain(56)
        for (const chainId of response.json().providerRejectedChainIds) {
            expect(response.json().failedChainIds).not.toContain(chainId)
            expect(response.json().successfulChainIds).not.toContain(chainId)
        }
    })

    it('returns structured HTTP 503 JSON when every provider misses the aggregate deadline', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        mocks.getAlchemyPortfolioWalletTokens.mockImplementation(() =>
            new Promise(() => undefined))
        mocks.getWalletTokens.mockResolvedValue([])

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(response.statusCode).toBe(503)
        expect(response.body).toMatch(/"error"/)
        expect(response.json().error.code).toBe('WALLET_TOKEN_REQUEST_DEADLINE_EXCEEDED')
    })
})
