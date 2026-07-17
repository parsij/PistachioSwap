import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    CURATED_EVM_CHAINS as BACKEND_CHAINS,
    CURATED_EVM_CHAIN_IDS as BACKEND_CHAIN_IDS,
} from '../src/chains.js'
import {
    CROSS_CHAIN_PROVIDERS,
} from '../src/cross-chain/types.js'
import {
    CURATED_EVM_CHAINS as FRONTEND_CHAINS,
    CURATED_EVM_CHAIN_IDS as FRONTEND_CHAIN_IDS,
    getChainCapabilities,
} from '../../../src/web3/curatedEvmChains.js'

const ROOT = resolve(import.meta.dirname, '../../..')
const forbiddenProvider = new RegExp(
    String.raw`\b${['li', String.raw`[\s._-]*`, 'fi'].join('')}\b`,
    'i',
)
const forbiddenPackage = new RegExp(`@${['li', 'fi'].join('')}(?:/|\\b)`, 'i')
const forbiddenHost = ['li', 'fi'].join('.')

const EXPECTED_BACKEND_METADATA = [
    [1, 'Ethereum', 'ETH'],
    [56, 'BNB Smart Chain', 'BNB'],
    [137, 'Polygon PoS', 'POL'],
    [42161, 'Arbitrum One', 'ETH'],
    [10, 'OP Mainnet', 'ETH'],
    [8453, 'Base', 'ETH'],
    [43114, 'Avalanche C-Chain', 'AVAX'],
    [42220, 'Celo', 'CELO'],
    [100, 'Gnosis Chain', 'xDAI'],
    [59144, 'Linea', 'ETH'],
    [534352, 'Scroll', 'ETH'],
    [324, 'ZKsync Era', 'ETH'],
    [5000, 'Mantle', 'MNT'],
    [146, 'Sonic', 'S'],
    [80094, 'Berachain', 'BERA'],
    [130, 'Unichain', 'ETH'],
    [480, 'World Chain', 'ETH'],
    [81457, 'Blast', 'ETH'],
    [34443, 'Mode', 'ETH'],
    [1088, 'Metis Andromeda', 'METIS'],
    [25, 'Cronos', 'CRO'],
    [1284, 'Moonbeam', 'GLMR'],
    [167000, 'Taiko', 'ETH'],
    [204, 'opBNB', 'BNB'],
    [1101, 'Polygon zkEVM', 'ETH'],
] as const

const EXPECTED_FRONTEND_METADATA = [
    [1, 'Ethereum', 'ETH'],
    [56, 'BNB Smart Chain', 'BNB'],
    [137, 'Polygon', 'POL'],
    [42161, 'Arbitrum One', 'ETH'],
    [10, 'OP Mainnet', 'ETH'],
    [8453, 'Base', 'ETH'],
    [43114, 'Avalanche', 'AVAX'],
    [42220, 'Celo', 'CELO'],
    [100, 'Gnosis', 'XDAI'],
    [59144, 'Linea Mainnet', 'ETH'],
    [534352, 'Scroll', 'ETH'],
    [324, 'ZKsync Era', 'ETH'],
    [5000, 'Mantle', 'MNT'],
    [146, 'Sonic', 'S'],
    [80094, 'Berachain', 'BERA'],
    [130, 'Unichain', 'ETH'],
    [480, 'World Chain', 'ETH'],
    [81457, 'Blast', 'ETH'],
    [34443, 'Mode Mainnet', 'ETH'],
    [1088, 'Metis', 'METIS'],
    [25, 'Cronos Mainnet', 'CRO'],
    [1284, 'Moonbeam', 'GLMR'],
    [167000, 'Taiko Mainnet', 'ETH'],
    [204, 'opBNB', 'BNB'],
    [1101, 'Polygon zkEVM', 'ETH'],
] as const

describe('curated 25-chain verification', () => {
    it('locks exhaustive backend IDs, display names, native symbols, and capabilities', () => {
        expect(BACKEND_CHAINS).toHaveLength(25)
        expect(BACKEND_CHAINS.map(({ id, name, nativeCurrency }) =>
            [id, name, nativeCurrency.symbol],
        )).toEqual(EXPECTED_BACKEND_METADATA)
        expect(BACKEND_CHAIN_IDS).toEqual(EXPECTED_BACKEND_METADATA.map(([id]) => id))

        for (const chain of BACKEND_CHAINS) {
            expect(chain.capabilities).toEqual({
                send: true,
                sameChainSwap: true,
                crossChainSource: true,
                crossChainDestination: true,
                gasless: chain.id === 56,
                megaFuel: chain.id === 56,
            })
        }
    })

    it('locks exhaustive frontend metadata and keeps every chain capability explicit', () => {
        expect(FRONTEND_CHAINS).toHaveLength(25)
        expect(FRONTEND_CHAINS.map(({ id, name, nativeCurrency }) =>
            [id, name, nativeCurrency.symbol],
        )).toEqual(EXPECTED_FRONTEND_METADATA)
        expect(FRONTEND_CHAIN_IDS).toEqual(EXPECTED_BACKEND_METADATA.map(([id]) => id))

        for (const [id] of EXPECTED_FRONTEND_METADATA) {
            expect(getChainCapabilities(id)).toEqual({
                send: true,
                sameChainSwap: true,
                crossChainSource: true,
                crossChainDestination: true,
                gasless: id === 56,
                megaFuel: id === 56,
            })
        }
    })
})

describe('excluded-provider and frontend-secret guards', () => {
    it('keeps the excluded provider out of runtime source and UI labels', () => {
        const runtimeFiles = [
            ...filesUnder(resolve(ROOT, 'apps/api/src')),
            ...filesUnder(resolve(ROOT, 'src')),
        ].filter(isRuntimeSource)
        const uiFiles = filesUnder(resolve(ROOT, 'src/components')).filter(isRuntimeSource)

        expectFilesClean(runtimeFiles)
        expectFilesClean(uiFiles)
    })

    it('keeps the excluded provider out of manifests, lockfile, and environment files', () => {
        const manifests = [
            resolve(ROOT, 'package.json'),
            resolve(ROOT, 'apps/api/package.json'),
            resolve(ROOT, 'pnpm-lock.yaml'),
        ]
        const environmentFiles = [
            ...environmentFilesAt(ROOT),
            ...environmentFilesAt(resolve(ROOT, 'apps/api')),
        ]
        expectFilesClean([...manifests, ...environmentFiles])
    })

    it('locks the provider registry and excludes forbidden fetch hosts', () => {
        expect(CROSS_CHAIN_PROVIDERS).toEqual([
            'across',
            'debridge-dln',
            'relay',
            'chainflip',
        ])

        const runtimeFiles = [
            ...filesUnder(resolve(ROOT, 'apps/api/src')),
            ...filesUnder(resolve(ROOT, 'src')),
        ].filter(isRuntimeSource)
        const hosts = runtimeFiles.flatMap((file) =>
            [...readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s"'`)]+/g)].flatMap(
                ([value]) => {
                    try {
                        return [new URL(value).hostname.toLowerCase()]
                    } catch {
                        return []
                    }
                },
            ),
        )
        expect(hosts.some((host) =>
            host === forbiddenHost || host.endsWith(`.${forbiddenHost}`),
        )).toBe(false)
    })

    it('keeps all cross-chain provider credentials and authenticated URLs backend-only', () => {
        const frontendFiles = filesUnder(resolve(ROOT, 'src')).filter(isRuntimeSource)
        const frontendEnvironment = environmentFilesAt(ROOT)
        const content = [...frontendFiles, ...frontendEnvironment]
            .map((file) => readFileSync(file, 'utf8'))
            .join('\n')
        const backendOnlyNames = [
            'ACROSS_API_KEY',
            'ACROSS_INTEGRATOR_ID',
            'DEBRIDGE_ACCESS_TOKEN',
            'DEBRIDGE_REFERRAL_CODE',
            'RELAY_API_KEY',
            'CHAINFLIP_BROKER_API_URL',
            'CHAINFLIP_BROKER_COMMISSION_BPS',
        ]
        for (const name of backendOnlyNames) expect(content).not.toContain(name)
        expect(content).not.toMatch(/VITE_(?:ACROSS|DEBRIDGE|RELAY|CHAINFLIP)_/i)
    })

    it('keeps the diagnostic finite and non-executing by construction', () => {
        const source = readFileSync(
            resolve(ROOT, 'apps/api/scripts/debug-cross-chain-providers.ts'),
            'utf8',
        )
        expect(source).toContain('DIAGNOSTIC_TIMEOUT_MS')
        expect(source).toContain('CURATED_EVM_CHAINS.length')
        expect(source).not.toMatch(/requestDepositAddressV2/)
        expect(source).not.toMatch(/\.prepare\s*\(/)
        expect(source).not.toMatch(/src\/server|createServer|listen\s*\(/)
    })
})

function filesUnder(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = resolve(directory, name)
        return statSync(path).isDirectory() ? filesUnder(path) : [path]
    })
}

function isRuntimeSource(path: string) {
    return /\.(?:js|jsx|ts|tsx)$/.test(path) && !/\.(?:test|spec)\.[^.]+$/.test(path)
}

function environmentFilesAt(directory: string) {
    return readdirSync(directory)
        .filter((name) => /^\.env(?:\.|$)/.test(name))
        .map((name) => resolve(directory, name))
}

function expectFilesClean(files: string[]) {
    const failures = files.filter((file) => {
        const content = readFileSync(file, 'utf8')
        return forbiddenProvider.test(content) || forbiddenPackage.test(content)
    }).map((file) => file.replace(`${ROOT}/`, ''))
    expect(failures).toEqual([])
}
