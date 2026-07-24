import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import {
    DEFAULT_SHAPESHIFT_ASSET_REF,
    normalizeShapeShiftAssetData,
    resetShapeShiftAssetCatalogCacheForTest,
    syncShapeShiftAssetCatalog,
} from '../src/token-discovery/shapeshift-asset-catalog.js'

const upstream = {
    ids: [
        'eip155:56/slip44:60',
        'eip155:56/erc20:0x1111111111111111111111111111111111111111',
        'eip155:56/erc20:0x1111111111111111111111111111111111111111',
        'eip155:1101/erc20:0x2222222222222222222222222222222222222222',
        'bip122:000000000019d6689c085ae165831e93/slip44:0',
        'eip155:56/erc721:0x3333333333333333333333333333333333333333',
        'eip155:56/erc20:0x4444444444444444444444444444444444444444',
    ],
    byId: {
        'eip155:56/slip44:60': {
            name: 'BNB',
            symbol: 'BNB',
            precision: 18,
            icon: '/native-bnb.png',
        },
        'eip155:56/erc20:0x1111111111111111111111111111111111111111': {
            name: 'Known Token',
            symbol: 'KNOWN',
            precision: 18,
            icon: 'https://assets.example/token.png',
        },
        'eip155:1101/erc20:0x2222222222222222222222222222222222222222': {
            name: 'Inactive Token',
            symbol: 'OLD',
            precision: 18,
            icon: 'https://assets.example/old.png',
        },
        'bip122:000000000019d6689c085ae165831e93/slip44:0': {
            name: 'Bitcoin',
            symbol: 'BTC',
            precision: 8,
            icon: 'https://assets.example/btc.png',
        },
        'eip155:56/erc721:0x3333333333333333333333333333333333333333': {
            name: 'NFT',
            symbol: 'NFT',
            precision: 0,
            icon: 'https://assets.example/nft.png',
        },
        'eip155:56/erc20:0x4444444444444444444444444444444444444444': {
            name: 'No Icon',
            symbol: 'NOPE',
            precision: 18,
            icon: '',
        },
    },
}

describe('ShapeShift asset catalog', () => {
    const previousEnv = { ...process.env }
    let cwd: string

    beforeEach(async () => {
        vi.clearAllMocks()
        vi.unstubAllGlobals()
        resetShapeShiftAssetCatalogCacheForTest()
        cwd = await mkdtemp(path.join(tmpdir(), 'pistachio-shapeshift-assets-'))
        await mkdir(path.join(cwd, 'apps/api/data'), { recursive: true })
        process.env = {
            ...previousEnv,
            NODE_ENV: 'test',
            SHAPESHIFT_ASSET_CATALOG_PATH:
                path.join(cwd, 'apps/api/data/shapeshift-asset-catalog.v1.json'),
        }
    })

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true })
        resetShapeShiftAssetCatalogCacheForTest()
        vi.unstubAllGlobals()
        process.env = { ...previousEnv }
    })

    it('filters inactive chains and unsupported asset types', () => {
        const { catalog, diagnostics } = normalizeShapeShiftAssetData(upstream, {
            ref: DEFAULT_SHAPESHIFT_ASSET_REF,
            url: 'https://example.test/generatedAssetData.json',
            publicBaseUrl: `https://raw.githubusercontent.com/shapeshift/web/${DEFAULT_SHAPESHIFT_ASSET_REF}/public`,
            generatedAt: '2026-07-23T00:00:00.000Z',
        })

        expect(catalog.ids).toEqual([
            'eip155:56/slip44:60',
            'eip155:56/erc20:0x1111111111111111111111111111111111111111',
        ])
        expect(catalog.byId['eip155:56/slip44:60']).toMatchObject({
            chainId: 56,
            address: '0x0000000000000000000000000000000000000000',
            isNative: true,
        })
        expect(diagnostics.excluded).toMatchObject({
            'duplicate-identity': 1,
            'inactive-or-unsupported-chain': 1,
            'unsupported-asset-type': 2,
            'invalid-metadata': 1,
        })
    })

    it('converts relative icons to pinned HTTPS URLs', () => {
        const { catalog } = normalizeShapeShiftAssetData(upstream, {
            ref: DEFAULT_SHAPESHIFT_ASSET_REF,
            url: 'https://example.test/generatedAssetData.json',
            publicBaseUrl: `https://raw.githubusercontent.com/shapeshift/web/${DEFAULT_SHAPESHIFT_ASSET_REF}/public`,
            generatedAt: '2026-07-23T00:00:00.000Z',
        })

        expect(catalog.byId['eip155:56/slip44:60'].icon)
            .toBe(`https://raw.githubusercontent.com/shapeshift/web/${DEFAULT_SHAPESHIFT_ASSET_REF}/public/native-bnb.png`)
    })

    it('serves token-catalog from the local file without remote requests or prices', async () => {
        const { catalog } = normalizeShapeShiftAssetData(upstream, {
            ref: DEFAULT_SHAPESHIFT_ASSET_REF,
            url: 'https://example.test/generatedAssetData.json',
            publicBaseUrl: `https://raw.githubusercontent.com/shapeshift/web/${DEFAULT_SHAPESHIFT_ASSET_REF}/public`,
            generatedAt: '2026-07-23T00:00:00.000Z',
        })
        await writeFile(process.env.SHAPESHIFT_ASSET_CATALOG_PATH!, `${JSON.stringify(catalog)}\n`)
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const app = createApp()
        await app.ready()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&mode=all&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(fetchMock).not.toHaveBeenCalled()
        const body = response.json()
        expect(body.diagnostics.source).toBe('shapeshift-local')
        expect(body.tokens).toHaveLength(2)
        expect(body.tokens[0]).not.toHaveProperty('priceUSD')
    })

    it('ranks exact contract search first', async () => {
        const { catalog } = normalizeShapeShiftAssetData(upstream, {
            ref: DEFAULT_SHAPESHIFT_ASSET_REF,
            url: 'https://example.test/generatedAssetData.json',
            publicBaseUrl: `https://raw.githubusercontent.com/shapeshift/web/${DEFAULT_SHAPESHIFT_ASSET_REF}/public`,
            generatedAt: '2026-07-23T00:00:00.000Z',
        })
        await writeFile(process.env.SHAPESHIFT_ASSET_CATALOG_PATH!, `${JSON.stringify(catalog)}\n`)

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: '/v1/token-catalog?chainId=56&search=0x1111111111111111111111111111111111111111&limit=20',
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            address: '0x1111111111111111111111111111111111111111',
            symbol: 'KNOWN',
        })
    })

    it('failed sync keeps the previous valid snapshot', async () => {
        const fetchOk = vi.fn(async () => ({
            ok: true,
            json: async () => upstream,
        }))
        await syncShapeShiftAssetCatalog({ fetchImpl: fetchOk as never })
        const before = await readFile(process.env.SHAPESHIFT_ASSET_CATALOG_PATH!, 'utf8')

        const fetchFail = vi.fn(async () => ({
            ok: false,
            status: 503,
        }))
        await expect(syncShapeShiftAssetCatalog({ fetchImpl: fetchFail as never }))
            .rejects.toThrow('HTTP 503')

        await expect(readFile(process.env.SHAPESHIFT_ASSET_CATALOG_PATH!, 'utf8'))
            .resolves.toBe(before)
    })
})
