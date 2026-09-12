import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const envExample = readFileSync(
    new URL('../../../.env.example', import.meta.url),
    'utf8',
)

const walletParticleSigning = readFileSync(
    new URL('../../../src/features/passkey/services/walletManagerParticleSigning.js', import.meta.url),
    'utf8',
)

const particleTransactionSigning = readFileSync(
    new URL('../../../src/features/gas-assist/services/particleTransactionSigning.js', import.meta.url),
    'utf8',
)

describe('Particle browser environment boundary', () => {
    it('exposes only Particle public application identifiers and the trusted delegate allowlist to Vite', () => {
        for (const publicSetting of [
            'VITE_PARTICLE_PROJECT_ID=',
            'VITE_PARTICLE_CLIENT_KEY=',
            'VITE_PARTICLE_APP_ID=',
            'VITE_PARTICLE_ALLOWED_EIP7702_DELEGATES=',
        ]) {
            expect(envExample).toContain(publicSetting)
        }
        expect(walletParticleSigning).toContain('VITE_PARTICLE_ALLOWED_EIP7702_DELEGATES')
        expect(particleTransactionSigning).toContain('VITE_PARTICLE_PROJECT_ID')
        expect(particleTransactionSigning).toContain('VITE_PARTICLE_CLIENT_KEY')
        expect(particleTransactionSigning).toContain('VITE_PARTICLE_APP_ID')

        const browserSources = `${walletParticleSigning}\n${particleTransactionSigning}`
        for (const forbidden of [
            'VITE_PARTICLE_PROJECT_KEY',
            'VITE_PARTICLE_PROJECT_UUID',
            'VITE_PARTICLE_WEBHOOK_PUBLIC_KEY',
            'VITE_PARTICLE_WEBHOOK_PRIVATE_KEY',
            'VITE_PARTICLE_DELEGATION_RELAYER_PRIVATE_KEY',
            'VITE_PARTICLE_SERVER_KEY',
            'VITE_PARTICLE_SECRET',
            'PARTICLE_DELEGATION_RELAYER_PRIVATE_KEY',
            'PARTICLE_PROJECT_KEY',
        ]) {
            expect(envExample).not.toContain(forbidden)
            expect(browserSources).not.toContain(forbidden)
        }
    })

    it('keeps the unrelated public Alchemy wallet-history key', () => {
        expect(envExample).toContain('VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY=')
        expect(envExample).toContain('# VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_56=')
    })
})
