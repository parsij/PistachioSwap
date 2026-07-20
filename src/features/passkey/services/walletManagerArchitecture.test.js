import { describe, expect, it } from 'vitest'

import { PistachioWalletManager } from './walletManager.js'
import { methods as lifecycleMethods } from './walletManagerLifecycle.js'
import { methods as setupMethods } from './walletManagerSetup.js'
import { methods as sessionMethods } from './walletManagerSession.js'
import { methods as signingMethods } from './walletManagerSigning.js'
import { walletUIOperations } from './walletUIOperations.js'

const clusters = [lifecycleMethods, setupMethods, sessionMethods, signingMethods]
const publicMethods = [
    'initialize', 'open', 'close', 'requestConnection', 'prepareNewWallet', 'selectVault',
    'beginPasskeySetup', 'createMnemonicWallet', 'importMnemonic', 'importPrivateKey', 'importKeystore',
    'restoreEncryptedBackup', 'persistPendingWallet', 'finishOnboarding', 'unlock', 'lock', 'disconnect',
    'renameSavedVault', 'deleteLocalVault', 'reauthenticate', 'addBackupPasskey', 'renamePasskey',
    'removePasskey', 'exportEncryptedBackup', 'exportKeystore', 'revealRecoveryPhrase', 'revealPrivateKey',
    'review', 'signMessage', 'signTypedData', 'signMegaFuelTransaction', 'sendTransaction', 'providerRequest',
]

describe('wallet-manager method cluster architecture', () => {
    it('installs every public method exactly once', () => {
        const names = clusters.flatMap((cluster) => Object.keys(cluster))
        expect(new Set(names).size).toBe(names.length)
        for (const name of publicMethods) expect(typeof PistachioWalletManager.prototype[name]).toBe('function')
    })

    it('uses deterministic cluster order without coordinator collisions', () => {
        expect(clusters.map((cluster) => Object.keys(cluster)[0])).toEqual([
            'installLifecycle', 'beginPasskeySetup', 'unlock', 'reauthenticate',
        ])
        for (const cluster of clusters) expect(Object.hasOwn(PistachioWalletManager.prototype, Object.keys(cluster)[0])).toBe(true)
    })

    it('keeps methods dependent on the manager receiver', () => {
        const manager = Object.create(PistachioWalletManager.prototype)
        manager.view = null
        manager.subscribers = new Set()
        let notified = false
        manager.notify = () => { notified = true }
        manager.open('wallet')
        expect(manager.view).toBe('wallet')
        expect(notified).toBe(true)
    })

    it('keeps the UI boundary on the public facade', () => {
        expect(typeof walletUIOperations.open).toBe('function')
        expect(typeof walletUIOperations.unlock).toBe('function')
    })
})
