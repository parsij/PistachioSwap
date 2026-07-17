import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWalletTokenAddressPolicy } from '../src/config.js'
import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import { createMarketTokenRoutes, type MarketToken } from '../src/modules/market-tokens.js'
import { createTokenDetailsRoutes } from '../src/modules/token-details.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    TOKEN_DISCOVERY_CHAINS,
    getTokenDiscoveryChain,
} from '../src/token-discovery/registry.js'

afterEach(() => {
    delete process.env.WALLET_TOKEN_ALLOWLIST_1
    delete process.env.WALLET_TOKEN_ALLOWLIST_56
})

function token(chainId: number, volume24hUsd: number): MarketToken {
    return {
        id: `${chainId}:0x${String(chainId).padStart(40, '0')}`,
        chainId,
        address: `0x${String(chainId).padStart(40, '0')}`,
        name: `Token ${chainId}`,
        symbol: `T${chainId}`,
        decimals: 18,
        logoURI: `https://example.com/${chainId}.png`,
        logoCandidates: [`https://example.com/${chainId}.png`],
        logoSource: 'coingecko',
        chainLogoURI: getTokenDiscoveryChain(chainId)!.chainLogoURI,
        coinGeckoId: `token-${chainId}`,
        priceUSD: '1',
        volume24hUsd,
        liquidityUsd: 1_000_000,
        pairCount: 1,
        oldestPairCreatedAt: '2020-01-01T00:00:00.000Z',
        marketUrl: null,
        rank: 1,
        verificationStatus: 'established',
        verificationReasons: ['fixture'],
    }
}

describe('token-discovery registry', () => {
    it('contains 25 immutable entries and retires only Polygon zkEVM', () => {
        expect(TOKEN_DISCOVERY_CHAINS).toHaveLength(25)
        expect(ACTIVE_TOKEN_DISCOVERY_CHAINS).toHaveLength(24)
        expect(TOKEN_DISCOVERY_CHAINS.filter((chain) => !chain.active)
            .map((chain) => chain.chainId)).toEqual([1101])
        expect(Object.isFrozen(TOKEN_DISCOVERY_CHAINS)).toBe(true)
        expect(Object.isFrozen(getTokenDiscoveryChain(56))).toBe(true)
    })

    it('locks distinct provider mappings and native metadata', () => {
        expect(getTokenDiscoveryChain(1)).toMatchObject({
            native: { address: NATIVE_TOKEN_ADDRESS, symbol: 'ETH' },
            providers: {
                geckoTerminalNetwork: 'eth',
                coinGeckoNetwork: 'eth',
                dexScreenerChain: 'ethereum',
            },
        })
        expect(getTokenDiscoveryChain(56)).toMatchObject({
            native: { symbol: 'BNB' },
            wrappedNative: {
                address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            },
            providers: { dexScreenerChain: 'bsc' },
        })
        expect(getTokenDiscoveryChain(137)?.providers.dexScreenerChain)
            .toBe('polygon')
        expect(getTokenDiscoveryChain(137)?.providers.coinGeckoNetwork)
            .toBe('polygon_pos')
    })

    it('exposes unsupported security coverage as unavailable capabilities', () => {
        expect(TOKEN_DISCOVERY_CHAINS
            .filter((chain) => chain.capabilities.honeypot)
            .map((chain) => chain.chainId)).toEqual([1, 56, 8453])
        expect(getTokenDiscoveryChain(146)?.capabilities.goPlus).toBe(false)
        expect(getTokenDiscoveryChain(1101)?.capabilities).toMatchObject({
            geckoTerminal: false,
            coinGeckoOnchain: false,
            dexScreener: false,
            honeypot: false,
            goPlus: false,
        })
    })

    it('isolates manual token policies by chain ID', () => {
        process.env.WALLET_TOKEN_ALLOWLIST_1 =
            '0x0000000000000000000000000000000000000001'
        process.env.WALLET_TOKEN_ALLOWLIST_56 =
            '0x0000000000000000000000000000000000000056'

        expect(getWalletTokenAddressPolicy(1).allowlist)
            .toEqual(new Set([
                '0x0000000000000000000000000000000000000001',
            ]))
        expect(getWalletTokenAddressPolicy(56).allowlist)
            .toEqual(new Set([
                '0x0000000000000000000000000000000000000056',
            ]))
    })
})

describe('all-chain market route', () => {
    it('returns the hourly combined catalog with a hard 200-token cap', async () => {
        const failedChain = ACTIVE_TOKEN_DISCOVERY_CHAINS[2].chainId
        const combinedTokens = Array.from({ length: 205 }, (_, index) => ({
            ...token(
                ACTIVE_TOKEN_DISCOVERY_CHAINS[
                    index % ACTIVE_TOKEN_DISCOVERY_CHAINS.length
                ].chainId,
                1_000 - index,
            ),
            id: `${index + 1}:0x${String(index + 1).padStart(40, '0')}`,
            address: `0x${String(index + 1).padStart(40, '0')}`,
        }))
        const service = {
            getCombinedCatalog: vi.fn(async () => ({
                generatedAt: Date.now(),
                tokens: combinedTokens,
                unavailableChainIds: [failedChain],
            })),
            getCatalog: vi.fn(),
            getSearch: vi.fn(),
            refreshCatalog: vi.fn(),
        }
        const app = Fastify()
        await app.register(createMarketTokenRoutes(service as never))

        const response = await app.inject({
            method: 'GET',
            url: '/v1/market-tokens?chainId=all',
        })
        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.partial).toBe(true)
        expect(body.metadata.unavailableChainIds).toEqual([failedChain])
        expect(body.tokens).toHaveLength(200)
        expect(body.metadata.combinedLimit).toBe(200)
        expect(body.metadata.perChainLimit).toBe(100)
        expect(service.getCombinedCatalog).toHaveBeenCalledOnce()
        await app.close()
    })

    it('strictly rejects retired chains and malformed limits', async () => {
        const app = Fastify()
        const service = {
            getCatalog: vi.fn(),
            getSearch: vi.fn(),
            refreshCatalog: vi.fn(),
        }
        await app.register(createMarketTokenRoutes(service as never))
        expect((await app.inject('/v1/market-tokens?chainId=1101')).statusCode).toBe(400)
        expect((await app.inject('/v1/market-tokens?chainId=56&limit=2.5')).statusCode).toBe(400)
        expect((await app.inject('/v1/market-tokens?chainId=56&rpcUrl=https://evil.example')).statusCode)
            .toBe(400)
        expect(service.getCatalog).not.toHaveBeenCalled()
        await app.close()
    })

    it('uses one global candidate search before per-chain enrichment', async () => {
        const service = {
            getCatalog: vi.fn(),
            getSearch: vi.fn(async (_query: string, chainId: number) => [
                token(chainId, 10),
            ]),
            refreshCatalog: vi.fn(),
        }
        const searchAcrossChains = vi.fn(async () => [
            { chainId: 1, market: {} },
            { chainId: 1, market: {} },
        ])
        const app = Fastify()
        await app.register(createMarketTokenRoutes(
            service as never,
            searchAcrossChains as never,
        ))

        const response = await app.inject(
            '/v1/market-tokens?chainId=all&q=usd&limit=20',
        )
        expect(response.statusCode).toBe(200)
        expect(searchAcrossChains).toHaveBeenCalledTimes(1)
        expect(service.getSearch).toHaveBeenCalledTimes(1)
        expect(service.getSearch).toHaveBeenCalledWith('usd', 1)
        expect(response.json().metadata.searchedChains).toBe(1)
        await app.close()
    })
})

describe('chain-aware token details', () => {
    it('uses the requested active chain and rejects client provider inputs', async () => {
        const address = '0x0000000000000000000000000000000000000001'
        const lookup = vi.fn(async () => ({
            address,
            coinGeckoId: 'example',
        }))
        const app = Fastify()
        await app.register(createTokenDetailsRoutes(lookup as never))

        const response = await app.inject(
            `/v1/token-details/coingecko?chainId=1&address=${address}`,
        )
        expect(response.statusCode).toBe(200)
        expect(lookup).toHaveBeenCalledWith(address, undefined, 1)
        expect((await app.inject(
            `/v1/token-details/coingecko?chainId=1&address=${address}&network=bsc`,
        )).statusCode).toBe(400)
        expect((await app.inject(
            `/v1/token-details/coingecko?chainId=1101&address=${address}`,
        )).statusCode).toBe(400)
        await app.close()
    })
})
