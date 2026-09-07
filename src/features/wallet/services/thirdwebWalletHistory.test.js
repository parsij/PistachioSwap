// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    fetchThirdwebChainActivities,
    thirdwebWalletHistoryInternals,
} from './thirdwebWalletHistory.js'

const wallet = '0x0000000000000000000000000000000000000001'

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('thirdweb browser wallet history fallback', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('uses Insight plus client-side RPC without touching Pistachio API', async () => {
        vi.stubEnv('VITE_WALLET_HISTORY_THIRDWEB_CLIENT_ID', 'frontend-client-id')
        const urls = []
        const fetchMock = vi.fn(async (input, options = {}) => {
            const url = String(input)
            urls.push(url)
            expect(url).not.toContain('pistachioswap.com/api')

            if (url.startsWith('https://5000.insight.thirdweb.com/')) {
                expect(options.headers['x-client-id']).toBe('frontend-client-id')
                return jsonResponse({
                    data: [],
                    meta: { page: 0, limit: 100, total_items: 0, total_pages: 0 },
                })
            }

            expect(url).toBe('https://5000.rpc.thirdweb.com/frontend-client-id')
            const request = JSON.parse(options.body)
            expect(request.method).toBe('eth_blockNumber')
            return jsonResponse({
                jsonrpc: '2.0',
                id: request.id,
                result: '0x64',
            })
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await fetchThirdwebChainActivities({
            chainId: 5000,
            walletAddress: wallet,
        })

        expect(result).toMatchObject({
            activities: [],
            latestBlock: 100,
            truncated: false,
            source: 'thirdweb-browser',
        })
        expect(urls).toContain(
            `https://5000.insight.thirdweb.com/v1/wallets/${wallet}/transactions?page=0&limit=100&sort_by=block_number&sort_order=desc`,
        )
        expect(urls.some(url => url.startsWith(
            'https://5000.insight.thirdweb.com/v1/tokens/transfers?',
        ))).toBe(true)
    })

    it('constructs chain-scoped Insight and RPC origins', () => {
        vi.stubEnv('VITE_WALLET_HISTORY_THIRDWEB_CLIENT_ID', 'browser-id')
        expect(thirdwebWalletHistoryInternals.insightOrigin(167000))
            .toBe('https://167000.insight.thirdweb.com')
        expect(thirdwebWalletHistoryInternals.rpcUrl(25))
            .toBe('https://25.rpc.thirdweb.com/browser-id')
    })
})
