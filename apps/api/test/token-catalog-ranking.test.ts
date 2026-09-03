import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'
import {
    getFeaturedTokenCountsByChain,
    isPoolVaultOrReceiptToken,
} from '../src/token-discovery/token-catalog-overrides.js'
import {
    parseFallbackTokenSearchEntries,
} from '../src/token-discovery/fallback-token-addresses.js'

const bnbUsdt = '0x55d398326f99059ff775485246999027b3197955'
const bnbWbnb = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const baseWeth = '0x4200000000000000000000000000000000000006'

describe('token catalog ranking', () => {
    it('returns launch-featured BNB defaults with native, WBNB, and common tokens', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=featured&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.diagnostics.source).toBe('shapeshift-local')
        expect(body.tokens[0]).toMatchObject({ chainId: 56, symbol: 'BNB', isNative: true })
        expect(body.tokens.map((token: { symbol: string }) => token.symbol))
            .toEqual(expect.arrayContaining(['WBNB', 'USDT', 'USDC', 'DAI', 'BTCB', 'WETH']))
        expect(body.tokens.find((token: { address: string }) => token.address === bnbWbnb))
            .toMatchObject({ symbol: 'WBNB' })
        expect(body.tokens.filter((token: { isNative: boolean }) => !token.isNative))
            .toHaveLength(10)
    })

    it('returns a balanced all-chain featured list instead of exhausting early chains', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=all&mode=featured&limit=48',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        const body = response.json()
        const representedChains = new Set(body.tokens.map((token: { chainId: number }) => token.chainId))
        const symbols = new Set(body.tokens.map((token: { symbol: string }) => token.symbol.toUpperCase()))
        expect(representedChains.size).toBe(ACTIVE_TOKEN_DISCOVERY_CHAINS.length)
        expect(body.diagnostics.representedChainCount).toBe(ACTIVE_TOKEN_DISCOVERY_CHAINS.length)
        expect(symbols.size).toBeGreaterThan(10)
        expect(body.tokens.length).toBeLessThanOrEqual(48)
    })

    it('keeps searchable metadata from fallback address directories', () => {
        expect(parseFallbackTokenSearchEntries({
            chainId: 42220,
            text: [
                '# XAUT0 | Tether Gold Tokens | CoinGecko-listed',
                '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',
            ].join('\n'),
        })).toEqual([{
            chainId: 42220,
            address: '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',
            symbol: 'XAUT0',
            name: 'Tether Gold Tokens',
        }])
    })

    it('searches the complete all-chain ShapeShift catalog including Celo XAUT', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=all&mode=all&search=XAUT&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.tokens.length).toBeLessThanOrEqual(20)
        const summary = body.tokens.map((token: { chainId: number; symbol: string; address: string }) => ({
            chainId: token.chainId,
            symbol: token.symbol,
            address: token.address,
        }))
        expect(
            body.tokens.some((token: { chainId: number }) => token.chainId === 42220),
            `Expected a Celo XAUT result. Received: ${JSON.stringify(summary)}`,
        ).toBe(true)
    })

    it('keeps Polygon POL discoverable from the active-chain registry', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=137&mode=all&search=POL&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            chainId: 137,
            address: '0x0000000000000000000000000000000000000000',
            symbol: 'POL',
            isNative: true,
        })
    })

    it('gives wrapped native tokens shared and chain-logo icon fallbacks', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/token-catalog?chainId=8453&mode=all&search=${baseWeth}&limit=20`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        const token = response.json().tokens[0]
        expect(token).toMatchObject({ chainId: 8453, address: baseWeth, symbol: 'WETH' })
        expect(token.logoCandidates.length).toBeGreaterThan(1)
        expect(token.logoCandidates).toContain('/networkIcons/base.webp')
    })

    it('ranks canonical BNB USDT before pool and vault matches and caps search at 20', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&search=USDT&limit=250',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.tokens).toHaveLength(14)
        expect(body.tokens.length).toBeLessThanOrEqual(20)
        expect(body.tokens[0]).toMatchObject({
            address: bnbUsdt,
            symbol: 'USDT',
            sourceSymbol: 'BSC-USD',
        })
        const poolIndex = body.tokens.findIndex((token: { name: string; symbol: string }) =>
            isPoolVaultOrReceiptToken(token))
        expect(poolIndex).toBeGreaterThan(0)
    })

    it('finds canonical tokens through Fuse when the ticker contains a typo', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&search=USDTT&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            address: bnbUsdt,
            symbol: 'USDT',
        })
    })

    it('keeps exact-address search ahead of canonical symbol ranking', async () => {
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&search=0xa9251ca9de909cb71783723713b21e4233fbf1b1&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            address: '0xa9251ca9de909cb71783723713b21e4233fbf1b1',
        })
    })

    it('serves stable 30-token pages without price-provider calls', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const app = createApp()
        const first = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&pageSize=30',
        })
        const firstBody = first.json()
        const second = await app.inject({
            method: 'GET',
            url: `/v1/token-catalog?chainId=56&mode=all&pageSize=30&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
        })
        await app.close()

        expect(first.statusCode).toBe(200)
        expect(firstBody.tokens).toHaveLength(30)
        expect(firstBody.hasMore).toBe(true)
        expect(typeof firstBody.nextCursor).toBe('string')
        expect(firstBody.diagnostics.totalForChain).toBeGreaterThan(3_000)
        expect(second.statusCode).toBe(200)
        expect(second.json().tokens).toHaveLength(30)
        const firstIds = new Set(firstBody.tokens.map((token: { canonicalId: string }) => token.canonicalId))
        expect(second.json().tokens.every((token: { canonicalId: string }) => !firstIds.has(token.canonicalId)))
            .toBe(true)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a cursor from a different chain', async () => {
        const app = createApp()
        const first = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&pageSize=30',
        })
        const cursor = first.json().nextCursor
        const response = await app.inject({
            method: 'GET',
            url: `/v1/token-catalog?chainId=8453&mode=all&pageSize=30&cursor=${encodeURIComponent(cursor)}`,
        })
        await app.close()

        expect(response.statusCode).toBe(400)
        expect(response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } })
    })

    it('reports deterministic featured-token counts per active chain', () => {
        expect(getFeaturedTokenCountsByChain()).toMatchObject({
            1: 1,
            56: 10,
            137: 1,
            42161: 1,
        })
    })
})
