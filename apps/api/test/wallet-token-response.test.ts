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

vi.mock('../src/providers/recognition/curated-token-lists.js', async (importOriginal) => ({
    ...await importOriginal(),
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
const xautAddress = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const officialXaut = {
    chainId: 56,
    address: xautAddress,
    name: 'Tether Gold',
    symbol: 'XAUt',
    decimals: 6,
    issuer: 'Tether',
    recognitionStatus: 'established' as const,
    verifiedContract: true as const,
    officialAsset: true as const,
    coinGeckoId: 'tether-gold',
    officialWebsite: 'https://gold.tether.to/',
    logoURI: '/icons/tether-gold.png',
    logoCandidates: [
        '/icons/tether-gold.png',
        'https://example.com/trusted-xaut-fallback.png',
    ],
}
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
        mocks.alchemyRpc.mockImplementation(async (request) =>
            request.method === 'alchemy_getTokenBalances'
                ? {
                      tokenBalances: tokenAddresses.map((address) => ({
                          contractAddress: address,
                          tokenBalance: '0xde0b6b3a7640000',
                      })),
                  }
                : '0xde0b6b3a7640000',
        )
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
        const hidden = tokens.filter((token) => token.visibility === 'hidden')

        expect(tokens).toHaveLength(8)
        expect(hidden).toHaveLength(7)
        expect(hidden.every((token) => token.rawBalance === '1000000000000000000'))
            .toBe(true)
        expect(hidden.every((token) => token.visibilityReasons.includes(
            'unverified-identity',
        ))).toBe(true)
        expect(hidden.every((token) =>
            token.valueUSD === null && token.trustedPriceUSD === null,
        )).toBe(true)
        expect(tokens.every((token) => token.classificationVersion === 6)).toBe(true)
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

    it('does not fetch native prices for a zero native balance', async () => {
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000063',
            inventory: {
                balances: new Map(),
                nativeBalance: 0n,
                pageCount: 1,
                metadata: new Map(),
                prices: new Map(),
                nativePriceUSD: null,
                source: 'alchemy-portfolio',
            },
        })

        expect(tokens).toEqual([])
        expect(mocks.getNativeBnbPrice).not.toHaveBeenCalled()
    })

    it('does not fetch native prices for empty non-BSC portfolio chains', async () => {
        const tokens = await getWalletTokens({
            chainId: 100,
            walletAddress: '0x1000000000000000000000000000000000000064',
            inventory: {
                balances: new Map(),
                nativeBalance: 0n,
                pageCount: 1,
                metadata: new Map(),
                prices: new Map(),
                nativePriceUSD: null,
                source: 'alchemy-portfolio',
            },
        })

        expect(tokens).toEqual([])
        expect(mocks.getNativeBnbPrice).not.toHaveBeenCalled()
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
            visibility: 'hidden',
            priceUSD: '100000',
            trustedPriceUSD: null,
            valueUSD: null,
            priceConfidence: 'untrusted',
        })
        expect(result?.marketPriceUSD).toBe('100000')
    })

    it('treats Portfolio metadata and prices as candidates while preserving spam classification', async () => {
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
                name: null,
                symbol: null,
                decimals: null,
                logoURI: null,
                priceUSD: null,
                valueUSD: null,
                source: 'moralis',
            }]]),
        })
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000059',
            inventory: {
                balances: new Map([[address, 10n ** 18n]]),
                nativeBalance: null,
                pageCount: 1,
                metadata: new Map([[address, {
                    chainId: 56,
                    address,
                    name: 'Alchemy candidate',
                    symbol: 'ALCH',
                    decimals: 18,
                    logoURI: 'https://example.com/alchemy.png',
                }]]),
                prices: new Map([[address, '9.5']]),
                nativePriceUSD: null,
                source: 'alchemy-portfolio',
            },
        })
        expect(tokens[0]).toMatchObject({
            name: 'Alchemy candidate',
            symbol: 'ALCH',
            recognitionStatus: 'unverified',
            spamStatus: 'possible-spam',
            visibility: 'hidden',
            priceUSD: '9.5',
            marketPriceUSD: '9.5',
            trustedPriceUSD: null,
            valueUSD: null,
            priceConfidence: 'untrusted',
        })
        expect(tokens[0].verificationReasons)
            .toContain('alchemy-portfolio-metadata')
        expect(mocks.getTokenMetadataBatch).not.toHaveBeenCalled()
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
            securityStatus: 'caution',
            visibility: 'hidden',
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
        expect(mocks.alchemyRpc).toHaveBeenCalled()
        expect(tokens.every((token) => token.classificationVersion === 6)).toBe(true)
        expect(tokens.find((item) => item.address === tokenAddresses[0])).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'hidden',
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
            recognitionStatus: 'unverified',
            visibility: 'hidden',
            trustedPriceUSD: null,
            priceConfidence: 'untrusted',
            classificationTier: 'hidden',
        })
        expect(tokens.find((item) => item.address === tokenAddresses[1])).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'hidden',
        })
    })

    it('keeps Moralis source-code verification informational and hidden without curated identity', async () => {
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
            recognitionStatus: 'unverified',
            recognitionReasons: ['moralis-verified-contract'],
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: true,
            visibility: 'hidden',
            trustedPriceUSD: null,
            marketPriceUSD: '2',
            valueUSD: null,
        })
    })

    it('hides SecantX-style verified market-catalog scams and strips fake value', async () => {
        const address = tokenAddresses[0]
        mocks.getCatalog.mockResolvedValue({
            catalog: {
                generatedAt: Date.now(),
                tokens: [{
                    chainId: 56,
                    address,
                    name: 'SecantX AI',
                    symbol: 'SECA',
                    decimals: 18,
                    priceUSD: '447463.12',
                    verifiedContract: true,
                    recognitionReasons: ['trusted-market-contract'],
                }],
            },
            stale: false,
        })
        mocks.getMoralisWalletTokens.mockResolvedValue({
            available: true,
            checkedAt: new Date(0).toISOString(),
            pageCount: 1,
            tokens: new Map([[address, {
                chainId: 56,
                address,
                possibleSpam: false,
                verifiedContract: true,
                name: 'SecantX AI',
                symbol: 'SECA',
                decimals: 18,
                logoURI: null,
                priceUSD: '447463.12',
                valueUSD: '447463.12',
                source: 'moralis',
            }]]),
        })
        mocks.fetchTokenMarkets.mockResolvedValue({
            markets: new Map([[address, {
                address,
                name: 'SecantX AI',
                symbol: 'SECA',
                priceUSD: '447463.12',
                volume24hUsd: 0,
                liquidityUsd: 5,
                largestTrustedPoolLiquidityUsd: 5,
                transactionCount24h: 0,
                uniqueTraders24h: 0,
                pairCount: 4,
                pairUrl: null,
                oldestPairCreatedAt: null,
            }]]),
            partial: false,
            successfulBatches: 1,
            failedBatches: 0,
        })
        mocks.getCachedAndRefresh.mockReturnValue({
            securityStatus: 'low',
            securityScore: 0,
            securityReasons: ['security-risk-low'],
            honeypot: { available: true, checkedAt: new Date(0).toISOString(), risk: 'low', riskLevel: 0, isHoneypot: false },
            goPlus: { available: false, checkedAt: null, isHoneypot: null },
        })

        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000062',
        })
        const result = tokens.find((item) => item.address === address)
        expect(result).toMatchObject({
            name: 'SecantX AI',
            symbol: 'SECA',
            verifiedContract: true,
            possibleSpam: false,
            recognitionStatus: 'unverified',
            visibility: 'hidden',
            includeInPortfolioValue: false,
            valueUSD: null,
            trustedPriceUSD: null,
            marketPriceUSD: '447463.12',
            priceConfidence: 'untrusted',
        })
        expect(result?.visibilityReasons).toEqual(expect.arrayContaining([
            'moralis-verified-contract',
            'market-catalog-only',
            'untrusted-price',
            'insufficient-trusted-liquidity',
        ]))
        expect(result?.visibilityReasons).not.toContain('trusted-market-contract')
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
            visibilityReasons: expect.arrayContaining(['provider-spam']),
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
            visibilityReasons: expect.arrayContaining(['security-blocked']),
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
            visibilityReasons: expect.arrayContaining(['manual-blocklist']),
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
            visibility: 'hidden',
        })
    })

    it('classifies official BNB XAUt before optional providers and preserves market pricing', async () => {
        mocks.getCuratedBscRecognition.mockResolvedValue(new Map([[xautAddress, {
            pancakeSwap: false,
            trustWallet: false,
            officialAsset: officialXaut,
        }]]))
        const tokens = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000060',
            inventory: {
                balances: new Map([[xautAddress, 1_500_000n]]),
                nativeBalance: null,
                pageCount: 1,
                metadata: new Map([[xautAddress, {
                    chainId: 56,
                    address: xautAddress,
                    name: 'Provider metadata mismatch',
                    symbol: 'XAUT',
                    decimals: 18,
                    logoURI: 'https://example.com/untrusted-provider.png',
                }]]),
                prices: new Map([[xautAddress, '2400.25']]),
                nativePriceUSD: null,
                source: 'alchemy-portfolio',
            },
        })
        expect(tokens).toEqual([
            expect.objectContaining({
                classificationVersion: 6,
                id: `56:${xautAddress}`,
                name: 'Tether Gold',
                symbol: 'XAUt',
                decimals: 6,
                rawBalance: '1500000',
                balance: '1.5',
                recognitionStatus: 'established',
                recognitionReasons: expect.arrayContaining([
                    'curated-official-contract',
                ]),
                verifiedContract: true,
                officialAsset: true,
                visibility: 'primary',
                possibleSpam: false,
                spamStatus: 'clean',
                logoURI: '/icons/tether-gold.png',
                logoSource: 'curated',
                priceUSD: '2400.25',
                marketPriceUSD: null,
                trustedPriceUSD: '2400.25',
                valueUSD: '3600.375',
                priceConfidence: 'trusted',
                classificationTier: 'core',
                classificationReasons: expect.arrayContaining(['core-asset']),
            }),
        ])
        expect(tokens[0].logoCandidates[1])
            .toContain('trustwallet/assets/master/blockchains/smartchain')
    })

    it('keeps genuine high-risk findings on the official XAUt identity', async () => {
        mocks.getCuratedBscRecognition.mockResolvedValue(new Map([[xautAddress, {
            pancakeSwap: false,
            trustWallet: false,
            officialAsset: officialXaut,
        }]]))
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
        const [token] = await getWalletTokens({
            chainId: 56,
            walletAddress: '0x1000000000000000000000000000000000000061',
            inventory: {
                balances: new Map([[xautAddress, 1_000_000n]]),
                nativeBalance: null,
                pageCount: 1,
                metadata: new Map(),
                prices: new Map(),
                nativePriceUSD: null,
                source: 'alchemy-portfolio',
            },
        })
        expect(token).toMatchObject({
            recognitionStatus: 'established',
            verifiedContract: true,
            securityStatus: 'blocked',
            visibility: 'hidden',
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
