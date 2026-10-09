// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWalletTokens } from '../services/walletTokens.js'
import {
    mergeKnownWalletTokenBalances,
    readWalletTokenCache,
    walletTokenCacheKey,
    writeWalletTokenCache,
} from '../services/walletTokenCache.js'
import { useWalletTokens } from './useWalletTokens.js'
import { beginOptimisticWalletTransaction, confirmOptimisticWalletTransaction, finishOptimisticWalletTransaction } from '../../wallet/services/optimisticBalances.js'

vi.mock('../services/walletTokens.js', () => ({
    WALLET_TOKEN_CLASSIFICATION_VERSION: 4,
    WALLET_TOKEN_CACHE_NAMESPACE: 'pistachioswap:wallet-tokens:v5:',
    isCurrentWalletTokenRecord: (token) =>
        [4, 6].includes(token?.classificationVersion) &&
        /^0x[a-f0-9]{40}$/.test(String(token?.address ?? '')) &&
        ['primary', 'unverified', 'hidden'].includes(token?.visibility ?? 'primary') &&
        ['core', 'established', 'hidden', 'blocked'].includes(token?.classificationTier ?? 'established'),
    fetchWalletTokens: vi.fn(),
}))

const WALLET = '0xe448af520b5a16293321cf0251c97fd4a1486ce0'
const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const NATIVE = '0x0000000000000000000000000000000000000000'

function token(rawBalance = '40') {
    return {
        classificationVersion: 6,
        chainId: 56,
        address: XAUT,
        decimals: 6,
        symbol: 'XAUT',
        name: 'Tether Gold',
        rawBalance,
        balance: String(Number(rawBalance) / 1_000_000),
        formattedBalance: String(Number(rawBalance) / 1_000_000),
    }
}

function fullResult(tokens) {
    return {
        tokens,
        chainErrors: {},
        queriedChainIds: [56],
        successfulChainIds: [56],
        failedChainIds: [],
        providerRejectedChainIds: [],
        unsupportedChainIds: [],
        partial: false,
        stale: false,
    }
}

describe('cached wallet token hydration', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        localStorage.clear()
    })

    it.each([56, 137, 8453, 10])('never adds the pending swap output again to refreshed holdings on chain %s', async chainId => {
        const held = { ...token('56000000'), chainId }
        const hash = `0x${chainId.toString(16).padStart(64, '0')}`
        fetchWalletTokens.mockResolvedValue(fullResult([held]))
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            address: WALLET,
            balances: [{ chainId, address: XAUT, rawBalance: '56000000' }],
            successfulChainIds: [chainId], failedChainIds: [], chainErrors: {}, partial: false,
        }), { status: 200 })))
        const { result, unmount } = renderHook(() => useWalletTokens({ chainId: 'all', walletAddress: WALLET }))
        await waitFor(() => expect(result.current.loading).toBe(false))
        const reads = fetchWalletTokens.mock.calls.length
        try {
            act(() => beginOptimisticWalletTransaction({ walletAddress: WALLET, transactionHash: hash, operation: 'swapping',
                settlementMode: 'external', changes: [{ chainId, token: held, deltaRaw: 56000000n }] }))
            expect(result.current.tokens[0].rawBalance).toBe('56000000')
            await waitFor(() => expect(fetchWalletTokens.mock.calls.length).toBeGreaterThan(reads))
            await waitFor(() => expect(result.current.loading).toBe(false))
            expect(result.current.tokens[0].rawBalance).toBe('56000000')
            act(() => confirmOptimisticWalletTransaction(hash))
            expect(result.current.tokens[0].rawBalance).toBe('56000000')
            act(() => finishOptimisticWalletTransaction(hash))
            expect(result.current.tokens[0].rawBalance).toBe('56000000')
        } finally {
            unmount()
            finishOptimisticWalletTransaction(hash)
        }
    })

    it('keeps verified RPC balances when later discovery returns an older balance', async () => {
        writeWalletTokenCache({
            chainId: 'all',
            address: WALLET,
            tokens: [token('40')],
            metadata: fullResult([token('40')]),
        })
        let resolveDiscovery
        fetchWalletTokens.mockReturnValue(new Promise((resolve) => {
            resolveDiscovery = resolve
        }))
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            address: WALLET,
            balances: [{
                chainId: 56,
                address: XAUT,
                rawBalance: '56',
            }],
            successfulChainIds: [56],
            failedChainIds: [],
            chainErrors: {},
            partial: false,
        }), { status: 200 })))

        const { result } = renderHook(() => useWalletTokens({
            chainId: 'all',
            walletAddress: WALLET,
            enabled: true,
        }))

        expect(result.current.tokens).toEqual([token('40')])
        expect(result.current.loading).toBe(true)
        expect(result.current.stale).toBe(true)
        expect(result.current.hydrationSource).toBe('cache')

        await waitFor(() => {
            expect(result.current.tokens[0]?.rawBalance).toBe('56')
        })
        expect(result.current.hydrationSource).toBe('verified-cache')
        expect(fetchWalletTokens).toHaveBeenCalledTimes(1)

        await act(async () => {
            resolveDiscovery(fullResult([token('70')]))
        })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens[0].rawBalance).toBe('56')
        expect(result.current.hydrationSource).toBe('discovery')
        expect(readWalletTokenCache({
            chainId: 'all',
            address: WALLET,
        }).tokens[0].rawBalance).toBe('56')
    })

    it('retains a cached Base native balance when only Base fails a multi-chain refresh', async () => {
        const baseEth = {
            ...token('1000'),
            chainId: 8453,
            address: NATIVE,
            isNative: true,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            rawBalance: '1000',
            balance: '0.000000000000001',
            formattedBalance: '0.000000000000001',
            recognitionStatus: 'established',
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: null,
            securityStatus: 'trusted',
            visibility: 'primary',
            classificationTier: 'core',
            classificationReasons: ['native-token'],
            priceConfidence: 'trusted',
        }
        const freshBnb = {
            ...baseEth,
            chainId: 56,
            symbol: 'BNB',
            name: 'BNB',
            rawBalance: '2000',
            balance: '0.000000000000002',
            formattedBalance: '0.000000000000002',
        }
        writeWalletTokenCache({
            chainId: 'all',
            address: WALLET,
            tokens: [baseEth],
        })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            address: WALLET,
            balances: [{ chainId: 8453, address: NATIVE, rawBalance: '1000' }],
            successfulChainIds: [8453],
            failedChainIds: [],
            chainErrors: {},
            partial: false,
        }), { status: 200 })))
        fetchWalletTokens.mockResolvedValue({
            tokens: [freshBnb],
            chainErrors: { 8453: 'Balance refresh failed.' },
            queriedChainIds: [56, 8453],
            successfulChainIds: [56],
            failedChainIds: [8453],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            partial: true,
            stale: false,
        })

        const { result } = renderHook(() => useWalletTokens({
            chainId: 'all',
            walletAddress: WALLET,
            enabled: true,
        }))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens.map(({ chainId, symbol }) => [chainId, symbol]))
            .toEqual(expect.arrayContaining([[56, 'BNB'], [8453, 'ETH']]))
        expect(result.current.hydrationSource).toBe('discovery')
    })

    it('verifies newly discovered received tokens even when the cache has no tokens', async () => {
        fetchWalletTokens.mockResolvedValue(fullResult([token('0')]))
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            address: WALLET, balances: [{ chainId: 56, address: XAUT, rawBalance: '20000000' }],
        }))))
        const { result } = renderHook(() => useWalletTokens({ chainId: 'all', walletAddress: WALLET }))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.tokens[0]).toMatchObject({ rawBalance: '20000000', balance: '20' })
    })

    it('removes an explicitly verified zero balance without dropping unknown results', () => {
        const other = {
            ...token('9'),
            address: '0x0000000000000000000000000000000000000001',
            symbol: 'OTHER',
        }
        expect(mergeKnownWalletTokenBalances(
            [token('40'), other],
            {
                balances: [{
                    chainId: 56,
                    address: XAUT,
                    rawBalance: '0',
                }],
            },
        )).toEqual([other])
    })

    it('rejects expired cache records instead of presenting ancient balances', () => {
        writeWalletTokenCache({
            chainId: 'all',
            address: WALLET,
            tokens: [token()],
            now: 1,
        })
        expect(readWalletTokenCache({
            chainId: 'all',
            address: WALLET,
            now: 40 * 24 * 60 * 60 * 1_000,
        })).toBeNull()
    })

    it('repairs stale hidden native token cache records', () => {
        const key = walletTokenCacheKey({ chainId: 'all', address: WALLET })
        localStorage.setItem(key, JSON.stringify({
            classificationVersion: 4,
            address: WALLET,
            scope: 'all',
            savedAt: Date.now(),
            tokens: [{
                ...token('1000000000000000000'),
                address: NATIVE,
                isNative: true,
                symbol: 'BNB',
                name: 'BNB',
                decimals: 18,
                recognitionStatus: 'unverified',
                spamStatus: 'possible-spam',
                possibleSpam: true,
                verifiedContract: false,
                securityStatus: 'high',
                visibility: 'hidden',
                classificationTier: 'hidden',
                classificationReasons: ['legacy-hidden-native'],
                priceConfidence: 'unknown',
            }],
        }))

        const cached = readWalletTokenCache({
            chainId: 'all',
            address: WALLET,
        })

        expect(cached.tokens[0]).toMatchObject({
            address: NATIVE,
            isNative: true,
            classificationTier: 'core',
            recognitionStatus: 'established',
            spamStatus: 'clean',
            possibleSpam: false,
            securityStatus: 'trusted',
            visibility: 'primary',
            includeInPortfolioValue: true,
        })
    })
})
