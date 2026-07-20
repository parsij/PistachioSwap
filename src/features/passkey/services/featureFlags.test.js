import { afterEach, describe, expect, it, vi } from 'vitest'

import { getPistachioWalletFlags } from './featureFlags.js'

describe('Pistachio Wallet feature flags', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('defaults every wallet capability to disabled', () => {
        vi.stubEnv('VITE_PISTACHIO_LOCAL_WALLET_ENABLED', '')
        vi.stubEnv('VITE_PISTACHIO_PASSKEY_WALLET_ENABLED', '')
        expect(getPistachioWalletFlags()).toMatchObject({
            localWalletEnabled: false,
            passkeyWalletEnabled: false,
            walletImportEnabled: false,
            keystoreImportEnabled: false,
        })
    })

    it('requires both local and passkey flags and gates imports independently', () => {
        vi.stubEnv('VITE_PISTACHIO_LOCAL_WALLET_ENABLED', 'true')
        vi.stubEnv('VITE_PISTACHIO_PASSKEY_WALLET_ENABLED', 'true')
        vi.stubEnv('VITE_PISTACHIO_WALLET_IMPORT_ENABLED', 'true')
        vi.stubEnv('VITE_PISTACHIO_WALLET_KEYSTORE_IMPORT_ENABLED', 'false')
        vi.stubEnv('VITE_PISTACHIO_WALLET_AUTO_LOCK_MINUTES', '')
        expect(getPistachioWalletFlags()).toMatchObject({
            passkeyWalletEnabled: true,
            walletImportEnabled: true,
            keystoreImportEnabled: false,
            autoLockMinutes: 15,
        })
    })
})
