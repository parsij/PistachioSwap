import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import {
    clearUniswapVolumeCachesForTest,
    getUniswapVolumeCatalog,
    refreshUniswapVolumeCatalog,
} from '../src/modules/uniswap-volume-tokens.js'

const catalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'uniswap-volume-token-catalog',
    configuredChainIds: [56],
    successfulChainIds: [56],
    failedChainIds: [],
    stale: false,
    partial: false,
    tokens: [{
        chainId: 56,
        address: '0x0000000000000000000000000000000000000001',
        name: 'Wrapped BNB',
        symbol: 'WBNB',
        decimals: 18,
        logoURI: 'https://tokens.uniswap.org/wbnb.png',
        priceUSD: '600',
        volume24hUsd: 1000,
        liquidityUsd: 5000,
        source: 'uniswap-v3',
        protocols: ['v3'],
    }],
    diagnostics: {
        tokenListUrl: 'https://tokens.uniswap.org',
        registryVersion: 'test',
        sources: [],
        missingApiKey: false,
        persisted: true,
    },
} as const

describe('Uniswap volume token persisted catalog', () => {
    const previousEnv = { ...process.env }
    let cwd: string
    let originalCwd: string

    beforeEach(async () => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
        clearUniswapVolumeCachesForTest()
        originalCwd = process.cwd()
        cwd = await mkdtemp(path.join(tmpdir(), 'pistachio-uniswap-catalog-'))
        process.chdir(cwd)
        await mkdir(path.join(cwd, 'apps/api/data'), { recursive: true })
        await writeFile(
            path.join(cwd, 'apps/api/data/uniswap-volume-token-catalog.v1.json'),
            `${JSON.stringify(catalog)}\n`,
        )
        process.env = {
            ...previousEnv,
            NODE_ENV: 'test',
            THE_GRAPH_API_KEY: '',
            UNISWAP_VOLUME_CATALOG_PATH:
                path.join(cwd, 'apps/api/data/uniswap-volume-token-catalog.v1.json'),
            UNISWAP_SUBGRAPH_URLS_JSON: '{}',
        }
    })

    afterEach(async () => {
        process.chdir(originalCwd)
        await rm(cwd, { recursive: true, force: true })
        clearUniswapVolumeCachesForTest()
        vi.unstubAllGlobals()
        process.env = { ...previousEnv }
    })

    it('loads the persisted catalog without a network call', async () => {
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)

        const app = createApp()
        await app.ready()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/uniswap-volume-tokens?chainId=all&limit=2400',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(fetch).not.toHaveBeenCalled()
        expect(response.json()).toMatchObject({
            schemaVersion: 7,
            configuredChainIds: [56],
            successfulChainIds: [56],
            failedChainIds: [],
            tokens: [expect.objectContaining({
                chainId: 56,
                address: catalog.tokens[0].address,
                volume24hUsd: 1000,
            })],
        })
    })

    it('failed refresh preserves the previous catalog', async () => {
        process.env.THE_GRAPH_API_KEY = 'test-key'
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('provider unavailable')
        }))

        const result = await refreshUniswapVolumeCatalog({ persist: true })

        expect(result.tokens).toHaveLength(1)
        expect(result.stale).toBe(true)
        expect(result.partial).toBe(true)
    })

    it('deduplicates duplicate chain/address records in persisted payloads', async () => {
        await writeFile(
            path.join(cwd, 'apps/api/data/uniswap-volume-token-catalog.v1.json'),
            `${JSON.stringify({
                ...catalog,
                tokens: [catalog.tokens[0], { ...catalog.tokens[0], volume24hUsd: 50 }],
            })}\n`,
        )
        clearUniswapVolumeCachesForTest()

        const result = await getUniswapVolumeCatalog({ refreshIfStale: false })

        expect(result.tokens.filter((token) =>
            token.chainId === 56 && token.address === catalog.tokens[0].address))
            .toHaveLength(1)
    })
})
