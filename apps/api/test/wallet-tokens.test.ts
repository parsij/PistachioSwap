import { afterEach, describe, expect, it, vi } from 'vitest'

import { getApiConfig } from '../src/config.js'
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
            classificationVersion: 3,
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
        ['established catalog membership', { established: true }],
        ['manual exact-address recognition', { allowlisted: true }],
        ['Moralis exact-contract verification', { moralisVerified: true }],
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

    it('normalizes configured wallet token lists and sanitizes invalid warnings', () => {
        process.env.WALLET_TOKEN_ALLOWLIST_56 = firstToken.toUpperCase()
        process.env.WALLET_TOKEN_BLOCKLIST_56 = `${laterToken},not-an-address`
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const config = getApiConfig()

        expect(config.walletTokens.allowlist).toEqual(new Set([firstToken]))
        expect(config.walletTokens.blocklist).toEqual(new Set([laterToken]))
        expect(warning).toHaveBeenCalledWith(
            'WALLET_TOKEN_BLOCKLIST_56 ignored an invalid address entry.',
        )
        expect(JSON.stringify(warning.mock.calls)).not.toContain('not-an-address')
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
