// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWalletTokens } from '../services/walletTokens.js'
import {
    mergeKnownWalletTokenBalances,
    readWalletTokenCache,
    writeWalletTokenCache,
} from '../services/walletTokenCache.js'
import { useWalletTokens } from './useWalletTokens.js'

vi.mock('../services/walletTokens.js', () => ({
    WALLET_TOKEN_CLASSIFICATION_VERSION: 4,
    WALLET_TOKEN_CACHE_NAMESPACE: 'pistachioswap:wallet-tokens:v4:',
    isCurrentWalletTokenRecord: (token) =>
        token?.classificationVersion === 4 &&
        /^0x[a-f0-9]{40}$/.test(String(token?.address ?? '')),
    fetchWalletTokens: vi.fn(),
}))

const WALLET = '0xe448af520b5a16293321cf0251c97fd4a1486ce0'
const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf'

function token(rawBalance = '40') {
    return {
        classificationVersion: 4,
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

    it('shows cached assets immediately, verifies them, then applies full discovery', async () => {
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
        expect(result.current.tokens[0].rawBalance).toBe('70')
        expect(result.current.hydrationSource).toBe('discovery')
        expect(readWalletTokenCache({
            chainId: 'all',
            address: WALLET,
        }).tokens[0].rawBalance).toBe('70')
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
})
