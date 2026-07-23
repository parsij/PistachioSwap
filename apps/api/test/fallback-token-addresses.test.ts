import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import {
    FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN,
    parseFallbackTokenAddressText,
    readFallbackTokenAddressDirectory,
} from '../src/token-discovery/fallback-token-addresses.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

let temporaryDirectories: string[] = []

async function tempDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'fallback-addresses-'))
    temporaryDirectories.push(directory)
    return directory
}

describe('fallback token address files', () => {
    afterEach(async () => {
        await Promise.all(temporaryDirectories.map((directory) =>
            rm(directory, { recursive: true, force: true })))
        temporaryDirectories = []
    })

    it('has one text file for every active token discovery chain', async () => {
        const result = await readFallbackTokenAddressDirectory()
        expect(result.errors).toEqual([])
        expect([...result.parsed.keys()].sort((left, right) => left - right))
            .toEqual(ACTIVE_TOKEN_DISCOVERY_CHAINS.map((chain) => chain.chainId)
                .sort((left, right) => left - right))
    })

    it('ignores comments and blank lines and normalizes addresses', () => {
        const result = parseFallbackTokenAddressText({
            chainId: 56,
            text: '# comment\n\n0x21cAef8A43163Eea865baeE23b9C2E327696A3bf\n',
        })
        expect(result.errors).toEqual([])
        expect(result.addresses).toEqual([
            '0x21caef8a43163eea865baee23b9c2e327696a3bf',
        ])
    })

    it('rejects duplicate addresses on the same chain', () => {
        const result = parseFallbackTokenAddressText({
            chainId: 56,
            text: '0x21caef8a43163eea865baee23b9c2e327696a3bf\n0x21cAef8A43163Eea865baeE23b9C2E327696A3bf\n',
        })
        expect(result.errors.join('\n')).toContain('duplicate address')
    })

    it('rejects more than 100 addresses', () => {
        const text = Array.from({ length: FALLBACK_TOKEN_MAX_ADDRESSES_PER_CHAIN + 1 }, (_, index) =>
            `0x${(index + 1).toString(16).padStart(40, '0')}`).join('\n')
        const result = parseFallbackTokenAddressText({ chainId: 56, text })
        expect(result.errors.join('\n')).toContain('maximum is 100')
    })

    it('rejects native zero address and invalid addresses before provider calls', () => {
        const result = parseFallbackTokenAddressText({
            chainId: 56,
            text: `${NATIVE_TOKEN_ADDRESS}\nnot-an-address\n`,
        })
        expect(result.errors.join('\n')).toContain('native zero address is not allowed')
        expect(result.errors.join('\n')).toContain('invalid address')
    })

    it('rejects unsupported chain files', async () => {
        const directory = await tempDirectory()
        for (const chain of ACTIVE_TOKEN_DISCOVERY_CHAINS) {
            await writeFile(join(directory, `${chain.chainId}.txt`), '# empty\n')
        }
        await writeFile(join(directory, '999999.txt'), '# unsupported\n')
        const result = await readFallbackTokenAddressDirectory(directory)
        expect(result.errors.join('\n')).toContain('Unsupported fallback token chain file')
    })
})
