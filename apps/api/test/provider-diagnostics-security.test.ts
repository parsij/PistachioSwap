import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

function files(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(root + '/' + entry.name) : [root + '/' + entry.name])
}

it('keeps provider credentials out of frontend source and Vite environment exports', () => {
    const root = fileURLToPath(new URL('../../../src', import.meta.url))
    for (const file of files(root).filter(name => /\.(?:js|jsx|ts|tsx)$/.test(name) && !/\.(?:test|spec)\./.test(name))) {
        const source = readFileSync(file, 'utf8')
        expect(source).not.toMatch(/(?:ZEROX_API_KEY|RELAY_API_KEY|ACROSS_API_KEY|UNISWAP_API_KEY|DEBRIDGE_ACCESS_TOKEN)/)
    }
    const vite = readFileSync(new URL('../../../vite.config.js', import.meta.url), 'utf8')
    expect(vite).not.toMatch(/envPrefix\s*:\s*['"]['"]|define\s*:\s*\{\s*['"]process\.env['"]/)
})

it('the provider matrix uses fixed reasons and never serializes raw upstream exceptions', () => {
    const source = readFileSync(new URL('../scripts/diagnose-provider-matrix.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/error\.message|error\.stack|console\.error\(error|baseUrl|brokerApiUrl|treasuryAddress/)
    const legacy = readFileSync(new URL('../scripts/diagnose-cross-chain.ts', import.meta.url), 'utf8')
    expect(legacy).not.toContain("error instanceof Error ? error.message")
})
