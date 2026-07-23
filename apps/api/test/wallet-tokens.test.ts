import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    getApiConfig,
    validateStartupConfig,
} from '../src/config.js'
import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import {
    classifyWalletTokenVisibility,
    formatTokenUnits,
    createNativeWalletToken,
    fallbackTokenMetadata,
    getAlchemyTokenBalancesPaginated,
    resolveNativeBnbWalletPrice,
    resolveWalletTokenPrice,
    suspiciousMetadata,
    sortWalletTokens,
    walletTokenVisibility,
} from '../src/providers/alchemy/wallet-tokens.js'

const wallet = '0x1000000000000000000000000000000000000001'
const firstToken = '0x0000000000000000000000000000000000000011'
const laterToken = '0x0000000000000000000000000000000000000022'

describe('wallet token inventory', () => {
    const previousEnv = { ...process.env }

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.restoreAllMocks()
    })

    it('follows every Alchemy pageKey and keeps a later positive balance', async () => {
        const rpc = vi.fn(async (request) => {
            const options = request.params[2] as { pageKey?: string }
            return options.pageKey
                ? {
                      tokenBalances: [
                          { contractAddress: laterToken, tokenBalance: '0x2a' },
                      ],
                  }
                : {
                      tokenBalances: [
                          { contractAddress: firstToken, tokenBalance: '0x0' },
                      ],
                      pageKey: 'next-page',
                  }
        })

        const result = await getAlchemyTokenBalancesPaginated({
            walletAddress: wallet,
            rpc,
        })
        expect(rpc).toHaveBeenCalledTimes(2)
        expect(result.pageCount).toBe(2)
        expect(result.balances.get(laterToken)).toBe(42n)
        expect(rpc.mock.calls[0][0].params[1]).toBe('erc20')
        expect(rpc.mock.calls[0][0].params[2]).toMatchObject({ maxCount: 100 })
    })

    it('decodes raw ERC-20 balances with bigint and exact decimals', () => {
        expect(formatTokenUnits(123456789012345678901n, 18)).toBe(
            '123.456789012345678901',
        )
        expect(formatTokenUnits(1234567n, 6)).toBe('1.234567')
    })

    it('uses one canonical native BNB identity distinct from ERC-20 contracts', () => {
        const native = createNativeWalletToken(10n ** 18n, '500')
        expect(native).toMatchObject({
            classificationVersion: 6,
            chainId: 56,
            address: NATIVE_TOKEN_ADDRESS,
            symbol: 'BNB',
            decimals: 18,
            isNative: true,
            verificationStatus: 'established',
            formattedBalance: '1',
            valueUSD: '500',
        })
        expect(native.address).not.toBe(getApiConfig().market.wrappedNativeAddress)
    })

    it.each([
        ['CoinGecko recognition', { exactRecognition: true }],
        ['manual exact-address recognition', { allowlisted: true }],
        ['PancakeSwap curated membership', { pancakeSwapRecognized: true }],
        ['Trust Wallet reviewed membership', { trustWalletRecognized: true }],
    ])('keeps a token primary for %s', (_label, signal) => {
        expect(
            classifyWalletTokenVisibility({
                suspiciousIndicators: ['no-verified-market-pairs'],
                ...signal,
            }).visibility,
        ).toBe('primary')
    })

    it('does not keep a token primary for Moralis source-code verification alone', () => {
        expect(classifyWalletTokenVisibility({
            moralisVerified: true,
            possibleSpam: false,
            securityStatus: 'low',
            suspiciousIndicators: ['market-catalog-only'],
        })).toEqual({
            visibility: 'unverified',
            visibilityReasons: [
                'unverified-contract',
                'market-catalog-only',
            ],
        })
    })

    it('does not keep a token primary for market-catalog membership alone', () => {
        expect(classifyWalletTokenVisibility({
            established: true,
        })).toEqual({
            visibility: 'unverified',
            visibilityReasons: ['unverified-contract', 'market-catalog-only'],
        })
    })

    it.each([
        ['an exact-address price', { suspiciousIndicators: ['untrusted-market-price'] }],
        ['meaningful DexScreener liquidity', { suspiciousIndicators: [] }],
        ['low security risk', { securityStatus: 'low' as const }],
    ])('does not recognize an unknown token from %s', (_label, signal) => {
        expect(classifyWalletTokenVisibility({
            ...signal,
        }).visibility).toBe('unverified')
    })

    it('does not grant recognition to a duplicate legitimate symbol', () => {
        const result = classifyWalletTokenVisibility({
            suspiciousIndicators: [
                'duplicate-recognized-symbol',
                'no-verified-market-pairs',
            ],
        })
        expect(result).toEqual({
            visibility: 'unverified',
            visibilityReasons: [
                'unverified-contract',
                'duplicate-recognized-symbol',
                'no-verified-market-pairs',
            ],
        })
    })

    it('applies exact-address allowlist and blocklist overrides', () => {
        const input = {
            suspiciousIndicators: ['no-verified-market-pairs'],
        }
        expect(classifyWalletTokenVisibility({ ...input, allowlisted: true }).visibility)
            .toBe('primary')
        expect(classifyWalletTokenVisibility({ ...input, blocklisted: true }).visibility)
            .toBe('hidden')
        expect(classifyWalletTokenVisibility({
            ...input,
            exactRecognition: true,
            allowlisted: true,
            blocklisted: true,
        }).visibility).toBe('hidden')
        expect(classifyWalletTokenVisibility({
            ...input,
            exactRecognition: true,
            allowlisted: true,
            securityStatus: 'blocked',
        }).visibility).toBe('hidden')
    })

    it('normalizes configured wallet token lists and rejects malformed policy addresses', () => {
        process.env.WALLET_TOKEN_ALLOWLIST_56 = firstToken.toUpperCase()
        process.env.WALLET_TOKEN_BLOCKLIST_56 = laterToken
        const config = getApiConfig()

        expect(config.walletTokens.allowlist).toEqual(new Set([firstToken]))
        expect(config.walletTokens.blocklist).toEqual(new Set([laterToken]))
        process.env.WALLET_TOKEN_BLOCKLIST_56 = `${laterToken},not-an-address`
        expect(() => getApiConfig()).toThrow(
            'WALLET_TOKEN_BLOCKLIST_56 contains an invalid address.',
        )
    })

    it('rejects malformed booleans and legacy integer settings instead of enabling defaults', () => {
        process.env.ESTABLISHED_TOKEN_SNAPSHOT_ENABLED = 'flase'
        expect(() => getApiConfig()).toThrow(
            'ESTABLISHED_TOKEN_SNAPSHOT_ENABLED must be either true or false.',
        )

        process.env.ESTABLISHED_TOKEN_SNAPSHOT_ENABLED = 'false'
        process.env.QUOTE_TIMEOUT_MS = 'not-a-number'
        expect(() => getApiConfig()).toThrow(
            'QUOTE_TIMEOUT_MS must be an integer greater than or equal to 1.',
        )
    })

    it('validates Portfolio integer configuration and production key requirements', () => {
        process.env.ALCHEMY_PORTFOLIO_TIMEOUT_MS = '12000.5'
        expect(() => getApiConfig()).toThrow(
            'ALCHEMY_PORTFOLIO_TIMEOUT_MS must be an integer.',
        )

        process.env.ALCHEMY_PORTFOLIO_TIMEOUT_MS = '12000'
        process.env.ALCHEMY_PORTFOLIO_ENABLED = 'true'
        process.env.NODE_ENV = 'production'
        delete process.env.ALCHEMY_API_KEY
        expect(() => validateStartupConfig()).toThrow(
            'ALCHEMY_API_KEY is required when ALCHEMY_PORTFOLIO_ENABLED=true.',
        )
    })

    it('uses exact price priority and native WBNB only as fallback', () => {
        expect(resolveWalletTokenPrice({
            freshMarketPrice: '4',
            alchemyPrice: '3',
            coinGeckoPrice: '2',
            dexScreenerPrice: '1',
        })).toBe('4')
        expect(resolveNativeBnbWalletPrice({
            nativePrice: '600',
            wrappedNativePrice: '599',
        })).toBe('600')
        expect(resolveNativeBnbWalletPrice({
            nativePrice: null,
            wrappedNativePrice: '599',
        })).toBe('599')
    })

    it('separates suspicious unverified assets without deleting their identity', () => {
        expect(suspiciousMetadata('Visit reward.example.com', 'BONUS')).toBe(true)
        expect(
            walletTokenVisibility({
                suspiciousIndicators: ['promotional-metadata'],
            }),
        ).toBe('unverified')
        expect(walletTokenVisibility({
            exactRecognition: true,
        })).toBe('primary')
    })

    it('keeps Moralis spam hidden even when the exact contract is recognized', () => {
        expect(classifyWalletTokenVisibility({
            exactRecognition: true,
            possibleSpam: true,
        })).toEqual({
            visibility: 'hidden',
            visibilityReasons: ['moralis-possible-spam'],
        })
    })

    it('keeps an exact recognized caution token primary', () => {
        expect(classifyWalletTokenVisibility({
            exactRecognition: true,
            securityStatus: 'caution',
        })).toEqual({
            visibility: 'primary',
            visibilityReasons: ['coingecko-exact-contract'],
        })
        expect(classifyWalletTokenVisibility({
            exactRecognition: true,
            securityStatus: 'high',
        })).toEqual({
            visibility: 'hidden',
            visibilityReasons: ['security-high'],
        })
        expect(classifyWalletTokenVisibility({
            securityStatus: 'caution',
        })).toEqual({
            visibility: 'unverified',
            visibilityReasons: ['unverified-contract'],
        })
    })

    it('retains stable fallback metadata when token metadata is unavailable', () => {
        expect(fallbackTokenMetadata(laterToken)).toMatchObject({
            name: expect.stringContaining('0x0000'),
            logoURI: '/icons/token-fallback.svg',
        })
    })

    it('sorts primary wallet assets by USD value before recognition rank', () => {
        const base = createNativeWalletToken(1n, '1')
        const lower = { ...base, id: 'lower', name: 'Lower', valueUSD: '2' }
        const higher = { ...base, id: 'higher', name: 'Higher', valueUSD: '100' }
        const unpriced = {
            ...base,
            id: 'unpriced',
            name: 'Unpriced',
            priceUSD: null,
            valueUSD: null,
            verificationStatus: 'recognized' as const,
        }
        expect(sortWalletTokens([lower, unpriced, higher]).map((token) => token.id))
            .toEqual(['higher', 'lower', 'unpriced'])
    })

    it('sorts priced recognized assets above unverified unsolicited tokens', () => {
        const native = createNativeWalletToken(1n, '1')
        const hidden = {
            ...native,
            id: 'hidden',
            address: laterToken,
            name: 'Claim reward.example.com',
            symbol: 'BONUS',
            priceUSD: null,
            valueUSD: null,
            verificationStatus: 'unverified' as const,
            visibility: 'hidden' as const,
        }
        const recognized = {
            ...native,
            id: 'recognized',
            address: firstToken,
            name: 'Recognized',
            symbol: 'GOOD',
            verificationStatus: 'recognized' as const,
        }
        expect(sortWalletTokens([hidden, recognized]).map((token) => token.id)).toEqual([
            'recognized',
            'hidden',
        ])
    })
})
