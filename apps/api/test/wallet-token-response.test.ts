import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getTokenMetadataBatch: vi.fn(),
    getTokenDecimalsBatch: vi.fn(),
    getTokenPrices: vi.fn(),
    getNativeBnbPrice: vi.fn(),
    getCoinGeckoTokensBatch: vi.fn(),
    fetchTokenMarkets: vi.fn(),
    alchemyRpc: vi.fn(),
    getCachedAndRefresh: vi.fn(() => null),
    getCatalog: vi.fn(),
    getMoralisWalletTokens: vi.fn(),
    getCuratedBscRecognition: vi.fn(),
}))

vi.mock('../src/modules/market-tokens.js', () => ({
    marketCatalogService: {
        getCatalog: mocks.getCatalog,
    },
}))

vi.mock('../src/providers/alchemy/token-metadata.js', () => ({
    getTokenMetadataBatch: mocks.getTokenMetadataBatch,
}))

vi.mock('../src/providers/token-decimals.js', () => ({
    getTokenDecimalsBatch: mocks.getTokenDecimalsBatch,
}))

vi.mock('../src/providers/alchemy/token-prices.js', () => ({
    getTokenPrices: mocks.getTokenPrices,
    getNativeBnbPrice: mocks.getNativeBnbPrice,
}))

vi.mock('../src/providers/coingecko/token-data.js', () => ({
    getCoinGeckoTokensBatch: mocks.getCoinGeckoTokensBatch,
}))

vi.mock('../src/providers/dexscreener/token-markets.js', () => ({
    fetchTokenMarkets: mocks.fetchTokenMarkets,
}))

vi.mock('../src/providers/moralis/wallet-token-spam.js', () => ({
    moralisWalletTokenService: {
        getWalletTokens: mocks.getMoralisWalletTokens,
    },
}))

vi.mock('../src/providers/recognition/curated-token-lists.js', () => ({
    getCuratedBscRecognition: mocks.getCuratedBscRecognition,
}))

vi.mock('../src/providers/security/token-security.js', () => ({
    tokenSecurityService: {
        getCachedAndRefresh: mocks.getCachedAndRefresh,
    },
    subscribeTokenSecurityAssessments: vi.fn(() => vi.fn()),
}))

vi.mock('../src/providers/alchemy/alchemy-client.js', () => ({
    alchemyRpc: mocks.alchemyRpc,
    alchemyRpcBatch: vi.fn(),
}))

import {
    clearWalletTokenCacheForTest,
    getWalletTokens,
    setWalletTokenCacheForTest,
} from '../src/providers/alchemy/wallet-tokens.js'

const wallet = '0x1000000000000000000000000000000000000042'
const tokenAddresses = Array.from(
    { length: 7 },
    (_, index) => `0x${(index + 101).toString(16).padStart(40, '0')}`,
)

describe('normalized wallet token response', () => {
    const previousEnv = { ...process.env }

    beforeEach(() => {
        vi.clearAllMocks()
        clearWalletTokenCacheForTest()
        process.env.ALCHEMY_API_KEY = 'test-key'
        process.env.ALCHEMY_NETWORK = 'bnb-mainnet'
        delete process.env.WALLET_TOKEN_ALLOWLIST_56
        delete process.env.WALLET_TOKEN_BLOCKLIST_56
        mocks.getTokenMetadataBatch.mockRejectedValue(new Error('metadata unavailable'))
        mocks.getCatalog.mockResolvedValue({
            catalog: { generatedAt: Date.now(), tokens: [] },
            stale: false,
        })
        mocks.getTokenDecimalsBatch.mockResolvedValue(
            new Map(tokenAddresses.map((address) => [address, 18])),
        )
        mocks.getTokenPrices.mockResolvedValue(new Map())
        mocks.getNativeBnbPrice.mockResolvedValue('500')
        mocks.getCoinGeckoTokensBatch.mockResolvedValue({
            tokens: new Map(),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        })
        mocks.fetchTokenMarkets.mockResolvedValue({
            markets: new Map(),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        })
        mocks.getMoralisWalletTokens.mockResolvedValue({
            available: false,
            checkedAt: null,
            tokens: new Map(),
            pageCount: 0,
        })
        mocks.getCachedAndRefresh.mockReturnValue(null)
        mocks.getCuratedBscRecognition.mockResolvedValue(new Map())
        mocks.alchemyRpc.mockResolvedValue('0xde0b6b3a7640000')
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({
                data: {
                    tokens: tokenAddresses.map((address) => ({
                        network: 'bnb-mainnet',
                        tokenAddress: address,
                        tokenBalance: '0xde0b6b3a7640000',
                    })),
                },
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        ))
    })

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.unstubAllGlobals()
    })

    it('retains every positive unverified balance and native BNB through provider failure', async () => {
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: wallet,
        })
        const native = tokens.find((token) => token.isNative)
        const unverified = tokens.filter((token) => token.visibility === 'unverified')

        expect(tokens).toHaveLength(8)
        expect(unverified).toHaveLength(7)
        expect(unverified.every((token) => token.rawBalance === '1000000000000000000'))
            .toBe(true)
        expect(unverified.every((token) => token.visibilityReasons.includes(
            'unverified-contract',
        ))).toBe(true)
        expect(unverified.every((token) =>
            token.valueUSD === null && token.trustedPriceUSD === null,
        )).toBe(true)
        expect(tokens.every((token) => token.classificationVersion === 3)).toBe(true)
        expect(native).toMatchObject({
            symbol: 'BNB',
            balance: '1',
            priceUSD: '500',
            valueUSD: '500',
            trustedPriceUSD: '500',
            recognitionStatus: 'established',
            securityStatus: 'trusted',
            visibility: 'primary',
        })
    })

    it('keeps manipulated exact-address market value untrusted and unverified', async () => {
        const address = tokenAddresses[0]
        mocks.getTokenMetadataBatch.mockResolvedValue(new Map([[address, {
            address,
            name: 'USDT',
            symbol: 'USDT',
            decimals: 18,
            logoURI: 'https://example.com/logo.png',
        }]]))
        mocks.fetchTokenMarkets.mockResolvedValue({
            markets: new Map([[address, {
                address,
                name: 'USDT',
                symbol: 'USDT',
                priceUSD: '100000',
                volume24hUsd: 1,
                liquidityUsd: 100_000,
                pairCount: 1,
                pairUrl: null,
                oldestPairCreatedAt: null,
            }]]),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        })
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000043',
        })
        const result = tokens.find((item) => item.address === address)
        expect(result).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'unverified',
            priceUSD: '100000',
            trustedPriceUSD: null,
            valueUSD: null,
            priceConfidence: 'market',
        })
        expect(result?.marketPriceUSD).toBe('100000')
    })

    it('keeps a low-risk successful simulation unverified without exact recognition', async () => {
        mocks.getCachedAndRefresh.mockReturnValue({
            chainId: 56,
            address: tokenAddresses[0],
            securityStatus: 'low',
            securityScore: 0,
            securityReasons: ['security-risk-low'],
            honeypot: {
                available: true,
                checkedAt: new Date(0).toISOString(),
                risk: 'very_low',
                riskLevel: 0,
                isHoneypot: false,
            },
            goPlus: {
                available: false,
                checkedAt: null,
                isHoneypot: null,
            },
        })
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000045',
        })
        expect(tokens.find((item) => item.address === tokenAddresses[0])).toMatchObject({
            recognitionStatus: 'unverified',
            securityStatus: 'low',
            visibility: 'unverified',
            trustedPriceUSD: null,
            valueUSD: null,
        })
    })

    it('rejects a cached wallet response from classification version 2', async () => {
        const cachedWallet = '0x1000000000000000000000000000000000000046'
        setWalletTokenCacheForTest({
            chainId: 56,
            walletAddress: cachedWallet,
            tokens: [{
                chainId: 56,
                address: tokenAddresses[0],
                classificationVersion: 2,
                balance: '1',
                valueUSD: '500000',
                visibility: 'primary',
            }],
        })

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: cachedWallet,
        })
        expect(fetch).toHaveBeenCalled()
        expect(tokens.every((token) => token.classificationVersion === 3)).toBe(true)
        expect(tokens.find((item) => item.address === tokenAddresses[0])).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'unverified',
            valueUSD: null,
        })
    })

    it('recognizes CoinGecko only by the returned exact contract', async () => {
        const address = tokenAddresses[0]
        mocks.getCoinGeckoTokensBatch.mockResolvedValue({
            tokens: new Map([[address, {
                address,
                name: 'Exact token',
                symbol: 'EXACT',
                decimals: 18,
                imageUrl: null,
                coinGeckoId: 'exact-token',
                priceUSD: '2',
                imageSource: 'coingecko',
            }]]),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        })
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000044',
        })
        expect(tokens.find((item) => item.address === address)).toMatchObject({
            recognitionStatus: 'recognized',
            visibility: 'primary',
            trustedPriceUSD: '2',
            priceConfidence: 'trusted',
        })
        expect(tokens.find((item) => item.address === tokenAddresses[1])).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'unverified',
        })
    })

    it('keeps a newer exact contract primary when Moralis verifies it', async () => {
        const address = tokenAddresses[0]
        mocks.getMoralisWalletTokens.mockResolvedValue({
            available: true,
            checkedAt: new Date(0).toISOString(),
            pageCount: 1,
            tokens: new Map([[address, {
                chainId: 56,
                address,
                possibleSpam: false,
                verifiedContract: true,
                name: 'New chain deployment',
                symbol: 'NEW',
                decimals: 18,
                logoURI: null,
                priceUSD: '2',
                valueUSD: '2',
                source: 'moralis',
            }]]),
        })

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000047',
        })
        expect(tokens.find((item) => item.address === address)).toMatchObject({
            recognitionStatus: 'recognized',
            recognitionReasons: ['moralis-verified-contract'],
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: true,
            visibility: 'primary',
            trustedPriceUSD: '2',
            valueUSD: '2',
        })
    })

    it('hides Moralis possible spam even when contract risk is low', async () => {
        const address = tokenAddresses[0]
        mocks.getMoralisWalletTokens.mockResolvedValue({
            available: true,
            checkedAt: new Date(0).toISOString(),
            pageCount: 1,
            tokens: new Map([[address, {
                chainId: 56,
                address,
                possibleSpam: true,
                verifiedContract: false,
                name: 'Unsolicited token',
                symbol: 'DROP',
                decimals: 18,
                logoURI: null,
                priceUSD: '500000',
                valueUSD: '500000',
                source: 'moralis',
            }]]),
        })
        mocks.getCachedAndRefresh.mockReturnValue({
            securityStatus: 'low',
            securityScore: 0,
            securityReasons: ['security-risk-low'],
            honeypot: {
                available: true,
                checkedAt: new Date(0).toISOString(),
                risk: 'low',
                riskLevel: 0,
                isHoneypot: false,
            },
            goPlus: { available: false, checkedAt: null, isHoneypot: null },
        })

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000048',
        })
        expect(tokens.find((item) => item.address === address)).toMatchObject({
            spamStatus: 'possible-spam',
            possibleSpam: true,
            visibility: 'hidden',
            visibilityReasons: ['moralis-possible-spam'],
            trustedPriceUSD: null,
            valueUSD: null,
        })
        expect(tokens).toHaveLength(8)
    })

    it('returns positive confirmed-honeypot balances as hidden records', async () => {
        mocks.getCachedAndRefresh.mockReturnValue({
            securityStatus: 'blocked',
            securityScore: 100,
            securityReasons: ['honeypot-confirmed'],
            honeypot: {
                available: true,
                checkedAt: new Date(0).toISOString(),
                risk: 'honeypot',
                riskLevel: 100,
                isHoneypot: true,
            },
            goPlus: { available: false, checkedAt: null, isHoneypot: null },
        })

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000050',
        })

        expect(tokens).toHaveLength(8)
        expect(tokens.find((item) => item.address === tokenAddresses[0])).toMatchObject({
            securityStatus: 'blocked',
            securityReasons: ['honeypot-confirmed'],
            visibility: 'hidden',
            visibilityReasons: ['security-blocked'],
        })
    })

    it('returns positive manually blocklisted balances as hidden records', async () => {
        process.env.WALLET_TOKEN_BLOCKLIST_56 = tokenAddresses[0]

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000051',
        })

        expect(tokens).toHaveLength(8)
        expect(tokens.find((item) => item.address === tokenAddresses[0])).toMatchObject({
            securityStatus: 'blocked',
            visibility: 'hidden',
            visibilityReasons: ['manual-blocklist'],
        })
    })

    it('recognizes exact curated-list membership without symbol inheritance', async () => {
        const address = tokenAddresses[0]
        mocks.getTokenMetadataBatch.mockResolvedValue(new Map(tokenAddresses.map((item) => [item, {
            address: item,
            name: 'Shared symbol token',
            symbol: 'XAUT',
            decimals: 18,
            logoURI: null,
        }])))
        mocks.getCuratedBscRecognition.mockResolvedValue(new Map([[address, {
            pancakeSwap: true,
            trustWallet: false,
        }]]))

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000049',
        })
        expect(tokens.find((item) => item.address === address)).toMatchObject({
            recognitionStatus: 'recognized',
            visibility: 'primary',
        })
        expect(tokens.find((item) => item.address === tokenAddresses[1])).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'unverified',
        })
    })

    it('keeps an exact recognized clean caution token primary', async () => {
        const address = tokenAddresses[0]
        mocks.getCuratedBscRecognition.mockResolvedValue(new Map([[address, {
            pancakeSwap: false,
            trustWallet: true,
        }]]))
        mocks.getMoralisWalletTokens.mockResolvedValue({
            available: true,
            checkedAt: new Date(0).toISOString(),
            pageCount: 1,
            tokens: new Map([[address, {
                chainId: 56,
                address,
                possibleSpam: false,
                verifiedContract: true,
                name: 'Issuer-controlled asset',
                symbol: 'ISSUER',
                decimals: 18,
                logoURI: null,
                priceUSD: null,
                valueUSD: null,
                source: 'moralis',
            }]]),
        })
        mocks.getCachedAndRefresh.mockReturnValue({
            securityStatus: 'caution',
            securityScore: 20,
            securityReasons: [
                'transfer-control-capability',
                'transfer-pausable',
            ],
            honeypot: {
                available: true,
                checkedAt: new Date(0).toISOString(),
                risk: 'medium',
                riskLevel: 20,
                isHoneypot: false,
            },
            goPlus: { available: true, checkedAt: new Date(0).toISOString(), isHoneypot: false },
        })

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000052',
        })

        expect(tokens.find((item) => item.address === address)).toMatchObject({
            recognitionStatus: 'recognized',
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: true,
            securityStatus: 'caution',
            securityReasons: [
                'transfer-control-capability',
                'transfer-pausable',
            ],
            visibility: 'primary',
        })
    })
})
