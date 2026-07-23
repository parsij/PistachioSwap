import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    buildFallbackTokenCatalog,
} from '../src/token-discovery/fallback-token-build.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

let temporaryDirectories: string[] = []

async function tempDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'fallback-build-'))
    temporaryDirectories.push(directory)
    return directory
}

async function writeAddressFiles(directory: string, values: Record<number, string>) {
    for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
        await writeFile(
            join(directory, `${chain.chainId}.txt`),
            values[chain.chainId] ?? '# empty\n',
        )
    }
}

const ADDRESS = '0x21caef8a43163eea865baee23b9c2e327696a3bf'

function metadata(symbol = 'XAUt') {
    return new Map([[ADDRESS, {
        chainId: 56,
        address: ADDRESS,
        name: 'Tether Gold',
        symbol,
        decimals: 6,
        logoURI: null,
    }]])
}

describe('fallback token catalog build', () => {
    afterEach(async () => {
        await Promise.all(temporaryDirectories.map((directory) =>
            rm(directory, { recursive: true, force: true })))
        temporaryDirectories = []
        vi.restoreAllMocks()
    })

    it('dry-run validates configuration without provider requests or writes', async () => {
        const directory = await tempDirectory()
        await writeAddressFiles(directory, { 56: `${ADDRESS}\n` })
        const fetchMetadata = vi.fn()
        const fetchDecimals = vi.fn()
        const writeFileAtomic = vi.fn()
        const result = await buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath: join(directory, 'catalog.json'),
            dryRun: true,
            chains: [56, 56],
            fetchMetadata,
            fetchDecimals,
            writeFileAtomic,
        })
        expect(result.chains).toEqual([
            expect.objectContaining({ chainId: 56, count: 1 }),
        ])
        expect(fetchMetadata).not.toHaveBeenCalled()
        expect(fetchDecimals).not.toHaveBeenCalled()
        expect(writeFileAtomic).not.toHaveBeenCalled()
    })

    it('resolves name, symbol, decimals, and fallback icon with mocked providers', async () => {
        const directory = await tempDirectory()
        await writeAddressFiles(directory, { 56: `${ADDRESS}\n` })
        const result = await buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath: join(directory, 'catalog.json'),
            iconDirectory: join(directory, 'icons'),
            chains: [56],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => metadata(),
            fetchDecimals: async () => new Map([[ADDRESS, 6]]),
            fetchImpl: vi.fn(),
            now: () => new Date('2026-07-22T00:00:00.000Z'),
        })
        expect(result.records).toEqual([
            expect.objectContaining({
                name: 'Tether Gold',
                symbol: 'XAUt',
                decimals: 6,
                logoURI: '/icons/tether-gold.png',
                catalogSource: 'static-fallback',
                directoryStatus: 'listed',
            }),
        ])
    })

    it('fails closed on metadata conflicts', async () => {
        const directory = await tempDirectory()
        await writeAddressFiles(directory, { 56: `${ADDRESS}\n` })
        await expect(buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath: join(directory, 'catalog.json'),
            chains: [56],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => metadata('GOLD'),
            fetchDecimals: async () => new Map([[ADDRESS, 6]]),
        })).rejects.toThrow(/conflict/)
    })

    it('stores approved icons locally and rejects oversized or HTML responses', async () => {
        const directory = await tempDirectory()
        const address = '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
        await writeAddressFiles(directory, { 10: `${address}\n` })
        const fetchImpl = vi.fn(async () => new Response(
            new Uint8Array([1, 2, 3]),
            { headers: { 'content-type': 'image/png' } },
        ))
        const result = await buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath: join(directory, 'catalog.json'),
            iconDirectory: join(directory, 'icons'),
            chains: [10],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => new Map([[address, {
                chainId: 10, address, name: 'USD Coin', symbol: 'USDC',
                decimals: 6, logoURI: null,
            }]]),
            fetchDecimals: async () => new Map([[address, 6]]),
            fetchImpl,
        })
        expect(result.records[0].logoURI)
            .toBe(`/token-icons/fallback/10/${address}.png`)
        await expect(stat(join(directory, 'icons', '10', `${address}.png`)))
            .resolves.toBeTruthy()

        const tooLarge = vi.fn(async () => new Response(
            new Uint8Array(513 * 1024),
            { headers: { 'content-type': 'image/png' } },
        ))
        await expect(buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath: join(directory, 'catalog-2.json'),
            iconDirectory: join(directory, 'icons-2'),
            chains: [10],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => new Map([[address, {
                chainId: 10, address, name: 'USD Coin', symbol: 'USDC',
                decimals: 6, logoURI: null,
            }]]),
            fetchDecimals: async () => new Map([[address, 6]]),
            fetchImpl: tooLarge,
            forceIcons: true,
        })).rejects.toThrow(/exceeds 512 KB/)

        const html = vi.fn(async () => new Response(
            '<html></html>',
            { headers: { 'content-type': 'image/png' } },
        ))
        await expect(buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath: join(directory, 'catalog-3.json'),
            iconDirectory: join(directory, 'icons-3'),
            chains: [10],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => new Map([[address, {
                chainId: 10, address, name: 'USD Coin', symbol: 'USDC',
                decimals: 6, logoURI: null,
            }]]),
            fetchDecimals: async () => new Map([[address, 6]]),
            fetchImpl: html,
            forceIcons: true,
        })).rejects.toThrow(/not a raster image/)
    })

    it('writes generated JSON atomically and preserves previous JSON on interruption', async () => {
        const directory = await tempDirectory()
        await writeAddressFiles(directory, { 56: `${ADDRESS}\n` })
        const catalogPath = join(directory, 'catalog.json')
        await buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath,
            iconDirectory: join(directory, 'icons'),
            chains: [56],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => metadata(),
            fetchDecimals: async () => new Map([[ADDRESS, 6]]),
        })
        const previous = await readFile(catalogPath, 'utf8')
        await expect(buildFallbackTokenCatalog({
            addressDirectory: directory,
            catalogPath,
            iconDirectory: join(directory, 'icons'),
            chains: [56],
            getBytecode: async () => '0x01',
            fetchMetadata: async () => metadata(),
            fetchDecimals: async () => new Map([[ADDRESS, 6]]),
            writeFileAtomic: async () => { throw new Error('interrupted') },
        })).rejects.toThrow(/interrupted/)
        await expect(readFile(catalogPath, 'utf8')).resolves.toBe(previous)
    })
})
