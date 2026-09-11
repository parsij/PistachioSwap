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

describe('Particle browser environment boundary', () => {
    it('exposes only the public EIP-7702 implementation address to Vite', () => {
        expect(envExample).toContain('VITE_PARTICLE_EIP7702_IMPLEMENTATION_ADDRESS=')
        expect(walletParticleSigning).toContain('VITE_PARTICLE_EIP7702_IMPLEMENTATION_ADDRESS')

        for (const forbidden of [
            'VITE_PARTICLE_PROJECT_KEY',
            'VITE_PARTICLE_PROJECT_UUID',
            'VITE_PARTICLE_WEBHOOK_PUBLIC_KEY',
            'VITE_PARTICLE_DELEGATION_RELAYER_PRIVATE_KEY',
            'VITE_PARTICLE_SERVER_KEY',
            'VITE_PARTICLE_SECRET',
        ]) {
            expect(envExample).not.toContain(forbidden)
            expect(walletParticleSigning).not.toContain(forbidden)
        }
    })

    it('keeps the unrelated public Alchemy wallet-history key', () => {
        expect(envExample).toContain('VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY=')
        expect(envExample).toContain('# VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_56=')
    })
})
