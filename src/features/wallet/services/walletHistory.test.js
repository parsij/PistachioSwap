// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteWalletHistoryCache } from './walletHistoryCache.js'
import {
    fetchWalletHistory,
    SUPPORTED_WALLET_HISTORY_CHAIN_IDS,
    walletHistoryInternals,
} from './walletHistory.js'

const wallet = '0x0000000000000000000000000000000000000001'

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('direct browser wallet history', () => {
    beforeEach(async () => {
        vi.stubEnv('VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY', 'browser-test-key')
        vi.unstubAllGlobals()
        await deleteWalletHistoryCache({ walletAddress: wallet, chainId: 56 })
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('queries Alchemy directly, keeps the key out of the URL, and caches the result', async () => {
        const fetchMock = vi.fn(async (url, options) => {
            expect(String(url)).toBe('https://bnb-mainnet.g.alchemy.com/v2')
            expect(String(url)).not.toContain('/api')
            expect(options.headers.authorization).toBe('Bearer browser-test-key')
            expect(String(url)).not.toContain('browser-test-key')

            const request = JSON.parse(options.body)
            if (Array.isArray(request)) {
                return jsonResponse(request.map(item => ({
                    jsonrpc: '2.0',
                    id: item.id,
                    result: null,
                })))
            }
            if (request.method === 'eth_blockNumber') {
                return jsonResponse({ jsonrpc: '2.0', id: request.id, result: '0x64' })
            }
            if (request.method === 'alchemy_getAssetTransfers') {
                return jsonResponse({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: { transfers: [] },
                })
            }
            throw new Error(`Unexpected method ${request.method}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const first = await fetchWalletHistory({
            walletAddress: wallet,
            chainIds: [56],
        })
        expect(first).toMatchObject({
            items: [],
            partial: false,
            source: 'browser-direct',
        })
        expect(fetchMock).toHaveBeenCalledTimes(5)

        const callsAfterBootstrap = fetchMock.mock.calls.length
        const second = await fetchWalletHistory({
            walletAddress: wallet,
            chainIds: [56],
        })
        expect(second.items).toEqual([])
        expect(fetchMock).toHaveBeenCalledTimes(callsAfterBootstrap)
    })

    it('refreshes only from the cached checkpoint minus the reorg buffer', async () => {
        let latestBlock = 1000
        const fromBlocks = []
        const fetchMock = vi.fn(async (_url, options) => {
            const request = JSON.parse(options.body)
            if (request.method === 'eth_blockNumber') {
                return jsonResponse({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: `0x${latestBlock.toString(16)}`,
                })
            }
            if (request.method === 'alchemy_getAssetTransfers') {
                fromBlocks.push(request.params[0].fromBlock)
                return jsonResponse({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: { transfers: [] },
                })
            }
            throw new Error(`Unexpected direct request ${request.method}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        await fetchWalletHistory({ walletAddress: wallet, chainIds: [56], force: true })
        expect(fromBlocks.slice(0, 4)).toEqual(['0x0', '0x0', '0x0', '0x0'])

        fromBlocks.length = 0
        latestBlock = 1100
        await fetchWalletHistory({ walletAddress: wallet, chainIds: [56], force: true })
        expect(fromBlocks).toEqual([
            '0x3a8',
            '0x3a8',
            '0x3a8',
            '0x3a8',
        ])
    })

    it('defines every live curated network as history-capable and excludes retired Polygon zkEVM', () => {
        expect(SUPPORTED_WALLET_HISTORY_CHAIN_IDS).toEqual([
            1, 56, 137, 42161, 10, 8453, 43114, 42220, 100, 59144,
            534352, 324, 5000, 146, 80094, 130, 480, 81457, 34443,
            1088, 25, 1284, 167000, 204,
        ])
        expect(SUPPORTED_WALLET_HISTORY_CHAIN_IDS).not.toContain(1101)
    })

    it('filters requested chains to the configured direct-history set', () => {
        // The test environment intentionally uses the production-safe default,
        // BNB only. Production can opt into all supported IDs via Vite env.
        expect(walletHistoryInternals.normalizeChainIds([56, 56, 999999, 1]))
            .toEqual([56])
    })
})
