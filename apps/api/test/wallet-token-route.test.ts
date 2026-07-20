import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getWalletTokens: vi.fn(),
    getAlchemyPortfolioWalletTokens: vi.fn(),
}))

vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({
    getWalletTokens: mocks.getWalletTokens,
    WALLET_TOKEN_CLASSIFICATION_VERSION: 4,
}))

vi.mock('../src/providers/alchemy/portfolio-wallet-tokens.js', () => ({
    getAlchemyPortfolioWalletTokens: mocks.getAlchemyPortfolioWalletTokens,
    hasStaleAlchemyPortfolioWalletCache: () => false,
}))

import { createApp } from '../src/app.js'

const wallet = '0x1000000000000000000000000000000000000042'
const token = '0x0000000000000000000000000000000000000011'

describe('wallet-token route', () => {
    const previousPortfolioEnabled = process.env.ALCHEMY_PORTFOLIO_ENABLED
    const previousAlchemyApiKey = process.env.ALCHEMY_API_KEY

    afterEach(() => {
        vi.clearAllMocks()
        if (previousPortfolioEnabled === undefined) {
            delete process.env.ALCHEMY_PORTFOLIO_ENABLED
        } else {
            process.env.ALCHEMY_PORTFOLIO_ENABLED = previousPortfolioEnabled
        }
        if (previousAlchemyApiKey === undefined) delete process.env.ALCHEMY_API_KEY
        else process.env.ALCHEMY_API_KEY = previousAlchemyApiKey
    })

    it('returns normalized security fields without provider secrets', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'false'
        mocks.getWalletTokens.mockResolvedValue([{
            classificationVersion: 4,
            id: `56:${token}`,
            chainId: 56,
            address: token,
            rawBalance: '1',
            balance: '1',
            recognitionStatus: 'unverified',
            recognitionReasons: [],
            spamStatus: 'unknown',
            possibleSpam: null,
            verifiedContract: null,
            spamReasons: ['moralis-spam-unknown'],
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
            classificationVersion: 4,
            recognitionStatus: 'unverified',
            spamStatus: 'unknown',
            possibleSpam: null,
            verifiedContract: null,
            visibility: 'unverified',
            securityStatus: 'unknown',
        })
        expect(response.json().classificationVersion).toBe(4)
        expect(response.body).not.toMatch(/api.?key|authorization|access.?token/i)
    })

    it('uses one Portfolio service call for all enabled supported chains', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        mocks.getAlchemyPortfolioWalletTokens.mockResolvedValue({
            classificationVersion: 4,
            address: wallet,
            source: 'alchemy-portfolio',
            tokens: [],
            queriedChainIds: [1, 56],
            successfulChainIds: [1, 56],
            failedChainIds: [],
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
            stale: false,
            partial: false,
        })
        expect(response.json().unsupportedChainIds)
            .toEqual(expect.arrayContaining([25, 1284, 34443, 167000]))
        expect(response.json().queriedChainIds).toEqual(expect.arrayContaining([
            1,
            56,
        ]))
        expect(response.json().queriedChainIds).not.toContain(25)
        expect(response.json().failedChainIds).toEqual([])
    })

    it('returns HTTP 200 and balances when one Portfolio batch is partial', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        mocks.getAlchemyPortfolioWalletTokens.mockResolvedValue({
            classificationVersion: 4,
            address: wallet,
            source: 'alchemy-portfolio',
            tokens: [{ chainId: 56, address: token }],
            queriedChainIds: [1, 56],
            successfulChainIds: [56],
            failedChainIds: [1],
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
            partial: true,
            stale: false,
            successfulChainIds: [56],
            failedChainIds: [1],
            tokens: [{ chainId: 56, address: token }],
        })
        expect(response.body).not.toContain('Wallet balances could not be loaded.')
    })

    it('returns a safe error after a total uncached Portfolio failure', async () => {
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.ALCHEMY_API_KEY = 'test-key'
        const { ProviderError } = await import('../src/lib/errors.js')
        mocks.getAlchemyPortfolioWalletTokens.mockRejectedValue(new ProviderError({
            code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
            message: 'Wallet balances are temporarily unavailable.',
            statusCode: 503,
            retryable: true,
        }))
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=all&address=${wallet}`,
        })
        await app.close()

        expect(response.statusCode).toBe(503)
        expect(response.json()).toEqual({
            error: {
                code: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
                message: 'Wallet balances are temporarily unavailable.',
            },
        })
        expect(response.body).not.toMatch(/test-key|api\.g\.alchemy/i)
    })
})
