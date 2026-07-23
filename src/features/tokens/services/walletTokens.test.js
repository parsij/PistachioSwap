import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    clearLegacyWalletTokenCacheKeys,
    fetchWalletTokens,
    formatWalletTokenAmount,
    formatWalletUsdValue,
    isCurrentWalletTokenRecord,
    mergeWalletBalances,
    resolveWalletUsdValue,
    WALLET_TOKEN_CACHE_NAMESPACE,
} from './walletTokens.js'

const address = '0x0000000000000000000000000000000000000011'

describe('wallet token presentation data', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('formats USD values and quantities without scientific notation', () => {
        expect(formatWalletUsdValue({ valueUSD: '0', priceUSD: '1' })).toBe('$0.00')
        expect(formatWalletUsdValue({ valueUSD: '0.0004', priceUSD: '1' }))
            .toBe('<$0.01')
        expect(formatWalletUsdValue({ valueUSD: '113' })).toBe('$113')
        expect(formatWalletUsdValue({ valueUSD: '1234.56' })).toBe('$1,234.56')
        expect(formatWalletUsdValue({ balance: '2', priceUSD: null })).toBe('—')
        expect(formatWalletTokenAmount('2.074720000')).toBe('2.07472')
        expect(formatWalletTokenAmount('0.0000004')).toBe('<0.000001')
        expect(formatWalletTokenAmount('1234567.5')).toBe('1,234,567.5')
    })

    it('keeps wallet balances and valid prices during exact-address merging', () => {
        const [merged] = mergeWalletBalances(
            [{
                chainId: 56,
                address,
                name: 'Catalog token',
                symbol: 'CAT',
                decimals: 18,
                balance: '0',
                priceUSD: null,
                verificationStatus: 'established',
            }],
            [{
                classificationVersion: 6,
                chainId: 56,
                address,
                name: 'Fallback token',
                symbol: '0x0000',
                decimals: 18,
                rawBalance: '2000000000000000000',
                formattedBalance: '2',
                balance: '2',
                priceUSD: '3.5',
                trustedPriceUSD: '3.5',
                valueUSD: '7',
                priceConfidence: 'trusted',
                recognitionStatus: 'recognized',
                recognitionReasons: ['coingecko-exact-contract'],
                spamStatus: 'clean',
                possibleSpam: false,
                verifiedContract: null,
                spamReasons: ['moralis-clean'],
                securityStatus: 'low',
                verificationReasons: ['fallback-metadata'],
                visibility: 'primary',
                visibilityReasons: ['no-verified-market-pairs'],
            }],
        )

        expect(merged).toMatchObject({
            name: 'Catalog token',
            symbol: 'CAT',
            rawBalance: '2000000000000000000',
            balance: '2',
            priceUSD: '3.5',
            valueUSD: '7',
            verificationStatus: 'recognized',
            visibility: 'primary',
        })
    })

    it('does not inherit a catalog valuation when the backend did not trust it', () => {
        const [merged] = mergeWalletBalances(
            [{ chainId: 56, address, priceUSD: '4', balance: '0' }],
            [{
                classificationVersion: 6,
                chainId: 56,
                address,
                rawBalance: '2500000000000000000',
                formattedBalance: '2.5',
                priceUSD: null,
                trustedPriceUSD: null,
                valueUSD: null,
                priceConfidence: 'unknown',
                recognitionStatus: 'unverified',
                recognitionReasons: [],
                spamStatus: 'unknown',
                possibleSpam: null,
                verifiedContract: null,
                spamReasons: ['moralis-spam-unknown'],
                securityStatus: 'unknown',
                visibility: 'unverified',
            }],
        )

        expect(merged.balance).toBe('2.5')
        expect(merged.rawBalance).toBe('2500000000000000000')
        expect(merged.priceUSD).toBeNull()
        expect(merged.valueUSD).toBeNull()
    })

    it('does not format an untrusted market price as portfolio value', () => {
        expect(formatWalletUsdValue({
            balance: '5',
            priceUSD: '100000',
            marketPriceUSD: '100000',
            valueUSD: null,
            priceConfidence: 'market',
        })).toBe('—')
    })

    it('uses value, trusted price, then a gated recognized market price', () => {
        const safe = {
            balance: '2.5',
            valueUSD: null,
            trustedPriceUSD: null,
            marketPriceUSD: '2400',
            priceConfidence: 'market',
            recognitionStatus: 'recognized',
            visibility: 'primary',
            possibleSpam: false,
            securityStatus: 'caution',
        }
        expect(formatWalletUsdValue({ ...safe, valueUSD: '6100' })).toBe('$6,100')
        expect(formatWalletUsdValue({ ...safe, trustedPriceUSD: '2500' })).toBe('$6,250')
        expect(formatWalletUsdValue(safe)).toBe('$6,000')
        expect(resolveWalletUsdValue({
            ...safe,
            balance: '12345678901234567890.123456789',
            marketPriceUSD: '0.000000001',
        })).toBe('12345678901.234567890123456789')
    })

    it('values official six-decimal XAUt with market confidence without promotion', () => {
        const xaut = {
            classificationVersion: 6,
            chainId: 56,
            address: '0x21caef8a43163eea865baee23b9c2e327696a3bf',
            decimals: 6,
            rawBalance: '1234567',
            balance: '1.234567',
            valueUSD: null,
            trustedPriceUSD: null,
            marketPriceUSD: '2400.25',
            priceConfidence: 'market',
            recognitionStatus: 'established',
            visibility: 'primary',
            possibleSpam: false,
            securityStatus: 'low',
        }
        expect(resolveWalletUsdValue(xaut)).toBe('2963.26944175')
        expect(formatWalletUsdValue(xaut)).toBe('$2,963.27')
        expect(xaut.trustedPriceUSD).toBeNull()
        expect(xaut.priceConfidence).toBe('market')
    })

    it.each([
        ['unverified', { recognitionStatus: 'unverified' }],
        ['spam', { possibleSpam: true }],
        ['hidden', { visibility: 'hidden' }],
        ['high risk', { securityStatus: 'high' }],
        ['blocked', { securityStatus: 'blocked' }],
    ])('does not apply market valuation to a %s token', (_label, override) => {
        expect(formatWalletUsdValue({
            balance: '2.5',
            marketPriceUSD: '2400',
            priceConfidence: 'market',
            recognitionStatus: 'recognized',
            visibility: 'primary',
            possibleSpam: false,
            securityStatus: 'low',
            ...override,
        })).toBe('—')
    })

    it('merges a catalog market candidate only by canonical chain and address', () => {
        const wallet = {
            classificationVersion: 6,
            chainId: 56,
            address,
            symbol: 'SAME',
            balance: '2',
            rawBalance: '2',
            trustedPriceUSD: null,
            marketPriceUSD: null,
            valueUSD: null,
            priceConfidence: 'unknown',
            recognitionStatus: 'recognized',
            recognitionReasons: [],
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: true,
            spamReasons: [],
            securityStatus: 'low',
            visibility: 'primary',
        }
        const [sameChain] = mergeWalletBalances([
            { chainId: 1, address, symbol: 'SAME', priceUSD: '9999' },
            { chainId: 56, address: '0x0000000000000000000000000000000000000022', symbol: 'SAME', priceUSD: '8888' },
            { chainId: 56, address, symbol: 'OTHER', priceUSD: '3.5' },
        ], [wallet]).filter((token) => token.chainId === 56 && token.address === address)
        expect(sameChain.marketPriceUSD).toBe('3.5')
        expect(sameChain.priceConfidence).toBe('market')
        expect(sameChain.trustedPriceUSD).toBeNull()
        expect(sameChain.recognitionStatus).toBe('recognized')
    })

    it('does not let market catalog data promote or value an unverified wallet token', () => {
        const [merged] = mergeWalletBalances(
            [{
                chainId: 56,
                address,
                name: 'Ordinary token',
                symbol: 'ORD',
                priceUSD: '100000',
                valueUSD: '500000',
                visibility: 'primary',
            }],
            [{
                classificationVersion: 6,
                chainId: 56,
                address,
                name: 'Ordinary token',
                symbol: 'ORD',
                balance: '5',
                rawBalance: '5',
                priceUSD: '100000',
                trustedPriceUSD: null,
                marketPriceUSD: '100000',
                valueUSD: null,
                priceConfidence: 'untrusted',
                recognitionStatus: 'unverified',
                recognitionReasons: [],
                spamStatus: 'clean',
                possibleSpam: false,
                verifiedContract: false,
                spamReasons: ['moralis-clean'],
                securityStatus: 'low',
                visibility: 'unverified',
            }],
        )

        expect(merged).toMatchObject({
            recognitionStatus: 'unverified',
            visibility: 'unverified',
            trustedPriceUSD: null,
            valueUSD: null,
            priceConfidence: 'untrusted',
        })
    })

    it('fails closed for a stale classification version 3 wallet record', () => {
        const [merged] = mergeWalletBalances([], [{
            classificationVersion: 3,
            chainId: 56,
            address,
            balance: '5',
            priceUSD: '100000',
            trustedPriceUSD: '100000',
            valueUSD: '500000',
            priceConfidence: 'trusted',
            recognitionStatus: 'recognized',
            securityStatus: 'low',
            visibility: 'primary',
        }])
        expect(merged).toMatchObject({
            classificationVersion: null,
            recognitionStatus: 'unverified',
            visibility: 'hidden',
            trustedPriceUSD: null,
            valueUSD: null,
            priceConfidence: 'untrusted',
        })
        expect(isCurrentWalletTokenRecord(merged)).toBe(false)
    })

    it('removes only legacy wallet-token cache keys', () => {
        const values = new Map([
            ['pistachioswap:wallet-tokens:v1:56:test', 'old'],
            ['pistachioswap:wallet-tokens:v2:56:test', 'old'],
            ['pistachioswap:wallet-tokens:v3:56:test', 'old'],
            [`${WALLET_TOKEN_CACHE_NAMESPACE}56:test`, 'current'],
            ['pistachioswap:swap-settings:v1', 'settings'],
        ])
        const storage = {
            get length() { return values.size },
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (key) => values.delete(key),
        }
        clearLegacyWalletTokenCacheKeys(storage)
        expect([...values.keys()]).toEqual([
            `${WALLET_TOKEN_CACHE_NAMESPACE}56:test`,
            'pistachioswap:swap-settings:v1',
        ])
    })

    it('rejects an unversioned wallet-token response before presentation', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            classificationVersion: 6,
            tokens: [{
                chainId: 56,
                address,
                visibility: 'primary',
                valueUSD: '500000',
            }],
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })))

        await expect(fetchWalletTokens({
            address: '0x0000000000000000000000000000000000000042',
            apiBaseUrl: 'http://api.invalid',
        })).rejects.toThrow('Backend returned invalid wallet tokens')
    })

    it('loads all chains with one backend request and validates partial status', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            classificationVersion: 6,
            address: '0x0000000000000000000000000000000000000042',
            source: 'alchemy-portfolio',
            tokens: [{
                classificationVersion: 6,
                chainId: 56,
                address,
                recognitionStatus: 'recognized',
                spamStatus: 'clean',
                possibleSpam: false,
                verifiedContract: true,
                securityStatus: 'low',
                visibility: 'primary',
                priceConfidence: 'unknown',
            }],
            queriedChainIds: [56, 137],
            successfulChainIds: [56],
            failedChainIds: [137],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            chainErrors: { 137: 'This network balance could not be refreshed.' },
            partial: true,
            stale: false,
        }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)

        const result = await fetchWalletTokens({
            chainId: 'all',
            chainIds: [56, 137],
            address: '0x0000000000000000000000000000000000000042',
            apiBaseUrl: 'http://api.invalid',
        })

        expect(result.tokens).toHaveLength(1)
        expect(result.chainErrors).toHaveProperty('137')
        expect(result.failedChainIds).toEqual([137])
        expect(result.partial).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('chainId'))
            .toBe('all')
    })
})
