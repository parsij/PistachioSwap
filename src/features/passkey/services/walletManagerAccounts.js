import { vaultAccounts } from './derivedAccounts.js'

function busyError() {
    return Object.assign(new Error('Another wallet change is already in progress.'), { code: 'PISTACHIO_ACCOUNT_CHANGE_ACTIVE' })
}
export const methods = {
    selectedAccountIndex(vault = this.vault) {
        const index = this.selectedAccountIndices[vault?.vaultId]
        return Number.isSafeInteger(index) && vaultAccounts(vault)[index] ? index : 0
    },
    selectedAccountAddress() {
        return vaultAccounts(this.vault)[this.selectedAccountIndex()]?.address ?? null
    },
    async selectAccount(vaultId, index) {
        await this.initialize()
        if (this.accountChangePending) throw busyError()
        const selected = this.vaults.find((vault) => vault.vaultId === vaultId)
        const account = vaultAccounts(selected).find((item) => item.index === index)
        if (!account) throw new TypeError('The selected wallet does not exist.')
        if (vaultId === this.vault?.vaultId && index === this.selectedAccountIndex()) return account.address
        this.accountChangePending = true
        this.interactionGeneration += 1
        try {
            // Cancel old reviews/signatures before any async persistence step.
            await this.lock('wallet-switch')
            let preferences = { ...this.selectedAccountIndices, [vaultId]: index }
            let stored
            if (this.storage.selectWalletAccount) {
                const committed = await this.storage.selectWalletAccount({ vaultId, index, address: account.address })
                stored = committed.vault
                preferences = committed.indices
            } else {
                await this.storage.writePreference('selectedAccountIndices', preferences)
                stored = await this.storage.selectActiveVault(vaultId)
                await this.storage.writePreference('activeSessionVaultId', vaultId)
            }
            if (vaultAccounts(stored)[index]?.address !== account.address) throw new Error('Wallet changed. Reopen the wallet picker.')
            this.vault = stored
            this.selectedAccountIndices = preferences
            this.address = null
            this.phase = 'locked'
            this.error = null
            this.activeSessionVaultId = vaultId
            this.sessionActive = true
            this.notify()
            return account.address
        } finally {
            this.accountChangePending = false
        }
    },
    async createAccount() {
        if (this.accountChangePending) throw busyError()
        if (!this.vault?.sourceType.endsWith('mnemonic')) throw new TypeError('A recovery phrase is required to create another wallet.')
        this.accountChangePending = true
        try {
            await this.reauthenticate()
            const context = this.captureSigningContext()
            const client = this.client
            const candidate = await client.request('createDerivedAccount')
            this.assertSigningContext(context)
            const stored = await this.storage.saveAndReadBackVault(candidate.vault, undefined, { expectedVault: this.vault })
            this.assertSigningContext(context)
            const adopted = await client.request('adoptDerivedAccounts', { vault: stored, accountIndex: candidate.index })
            this.assertSigningContext(context)
            if (adopted.address !== candidate.address) throw new Error('New wallet verification failed.')
            // The seed vault is durable even if saving the selection fails.
            this.vault = stored
            this.vaults = this.vaults.map((vault) => vault.vaultId === stored.vaultId ? stored : vault)
            const preferences = { ...this.selectedAccountIndices, [stored.vaultId]: candidate.index }
            await this.storage.writePreference('selectedAccountIndices', preferences)
            this.selectedAccountIndices = preferences
            this.signingContextGeneration += 1
            this.interactionGeneration += 1
            this.reviewQueue.clear('PISTACHIO_SIGNING_CONTEXT_CHANGED')
            this.address = adopted.address
            this.notify()
            return adopted.address
        } catch (error) {
            // A staged signer must never survive a partial persistence failure.
            await this.lock('account-creation-failed')
            throw error
        } finally {
            this.accountChangePending = false
        }
    },
}
