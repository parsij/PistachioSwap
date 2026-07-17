import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const directory = new URL('.', import.meta.url)

async function sourceFiles() {
    const names = await readdir(directory)
    return Promise.all(names.filter((name) => name.endsWith('.js') && !name.endsWith('.test.js')).map(async (name) => ({ name, source: await readFile(new URL(name, directory), 'utf8') })))
}

describe('Pistachio Wallet static security invariants', () => {
    it('does not use weak randomness, secret logs, browser globals, or plaintext Web Storage', async () => {
        const files = await sourceFiles()
        const joined = files.map(({ source }) => source).join('\n')
        expect(joined).not.toMatch(/Math\.random/u)
        expect(joined).not.toMatch(/console\.(?:log|debug|info|warn|error)/u)
        expect(joined).not.toMatch(/localStorage|sessionStorage|document\.cookie/u)
        expect(joined).not.toMatch(/window\.ethereum\s*=/u)
    })

    it('never sends PRF results through fetch or XHR', async () => {
        const passkey = await readFile(new URL('passkeyService.js', directory), 'utf8')
        const worker = await readFile(new URL('walletWorker.js', directory), 'utf8')
        expect(`${passkey}\n${worker}`).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/u)
    })

    it('keeps IndexedDB records limited to vault ciphertext and public preferences', async () => {
        const storage = await readFile(new URL('vaultStorage.js', directory), 'utf8')
        expect(storage).not.toMatch(/mnemonic|privateKey|prfOutput|signedTransaction|rawTransaction/u)
        expect(storage).toContain('PISTACHIO_VAULT_STORE')
        expect(storage).toContain('PISTACHIO_PREFERENCES_STORE')
    })

    it('does not introduce frontend NodeReal credentials', async () => {
        const files = await sourceFiles()
        for (const { name, source } of files) {
            if (name === 'walletManager.js') continue
            expect(source).not.toMatch(/NODEREAL_API_KEY|VITE_.*NODEREAL/u)
        }
    })
})
