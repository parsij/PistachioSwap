import {
    PISTACHIO_PREFERENCES_STORE,
    PISTACHIO_VAULT_DB_NAME,
    PISTACHIO_VAULT_DB_VERSION,
    PISTACHIO_VAULT_STORE,
} from './constants.js'
import { canonicalJson } from './passkeyEncoding.js'
import { vaultAccounts } from './derivedAccounts.js'
import { pistachioError } from './passkeyErrors.js'
import { validatePistachioVault } from './vaultSchema.js'

const WALLET_BOOTSTRAP_PREFERENCE_KEYS = Object.freeze([
    'activeVaultId',
    'vaultPreferences',
    'selectedAccountIndices',
    'lastUnlockByWrap',
    'recoveryBackupConfirmed',
    'activeSessionVaultId',
    'lastWalletActivityAt',
    'sessionResumeEligible',
])

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
    })
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true })
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
        transaction.addEventListener('error', () => reject(transaction.error), { once: true })
    })
}

/** Opens/upgrades the local IndexedDB vault database without accessing wallet providers. */
export async function openPistachioWalletDatabase(indexedDb = globalThis.indexedDB) {
    if (!indexedDb?.open) throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED')
    try {
        const request = indexedDb.open(PISTACHIO_VAULT_DB_NAME, PISTACHIO_VAULT_DB_VERSION)
        request.addEventListener('upgradeneeded', () => {
            const database = request.result
            if (!database.objectStoreNames.contains(PISTACHIO_VAULT_STORE)) {
                database.createObjectStore(PISTACHIO_VAULT_STORE, { keyPath: 'vaultId' })
            }
            if (!database.objectStoreNames.contains(PISTACHIO_PREFERENCES_STORE)) {
                database.createObjectStore(PISTACHIO_PREFERENCES_STORE, { keyPath: 'key' })
            }
        })
        return await requestResult(request)
    } catch (error) {
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    }
}

/** Atomically stores a validated encrypted vault and reads it back for persistence verification. */
export async function saveAndReadBackVault(vault, indexedDb = globalThis.indexedDB, { expectedVault = null } = {}) {
    const validated = validatePistachioVault(vault)
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(
            [PISTACHIO_VAULT_STORE, PISTACHIO_PREFERENCES_STORE],
            'readwrite',
        )
        const vaultStore = transaction.objectStore(PISTACHIO_VAULT_STORE)
        if (expectedVault) {
            const current = await requestResult(vaultStore.get(validated.vaultId))
            if (!current || canonicalJson(current) !== canonicalJson(expectedVault)) {
                throw Object.assign(new Error('This wallet changed in another tab. Refresh before creating another wallet.'), { code: 'PISTACHIO_VAULT_CHANGED' })
            }
        }
        vaultStore.put(validated)
        if (!expectedVault) transaction.objectStore(PISTACHIO_PREFERENCES_STORE).put({ key: 'activeVaultId', value: validated.vaultId })
        await transactionDone(transaction)
        const readTransaction = database.transaction(PISTACHIO_VAULT_STORE, 'readonly')
        const stored = await requestResult(readTransaction.objectStore(PISTACHIO_VAULT_STORE).get(validated.vaultId))
        await transactionDone(readTransaction)
        return validatePistachioVault(stored)
    } catch (error) {
        if (error.code === 'PISTACHIO_VAULT_CHANGED') throw error
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    } finally {
        database.close()
    }
}

/** Reads the wallet's encrypted vaults and initialization preferences in one readonly transaction. */
export async function readWalletBootstrapState(indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(
            [PISTACHIO_VAULT_STORE, PISTACHIO_PREFERENCES_STORE],
            'readonly',
        )
        const completion = transactionDone(transaction)
        const vaultStore = transaction.objectStore(PISTACHIO_VAULT_STORE)
        const preferenceStore = transaction.objectStore(PISTACHIO_PREFERENCES_STORE)
        const vaultsPromise = requestResult(vaultStore.getAll())
        const preferencePromises = WALLET_BOOTSTRAP_PREFERENCE_KEYS.map(async (key) => {
            const record = await requestResult(preferenceStore.get(key))
            return [key, record?.value ?? null]
        })
        const [storedVaults, preferenceEntries] = await Promise.all([
            vaultsPromise,
            Promise.all(preferencePromises),
        ])
        await completion

        const vaults = storedVaults.map(validatePistachioVault)
        const preferences = Object.fromEntries(preferenceEntries)
        const activeVaultId = typeof preferences.activeVaultId === 'string'
            ? preferences.activeVaultId
            : null
        const activeVault = activeVaultId
            ? vaults.find((vault) => vault.vaultId === activeVaultId) ?? null
            : null

        return { vaults, activeVault, preferences }
    } catch (error) {
        if (error instanceof TypeError) throw error
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    } finally {
        database.close()
    }
}

/** Reads the currently selected encrypted vault, returning null when none is active. */
export async function readActiveVault(indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(
            [PISTACHIO_VAULT_STORE, PISTACHIO_PREFERENCES_STORE],
            'readonly',
        )
        const active = await requestResult(transaction.objectStore(PISTACHIO_PREFERENCES_STORE).get('activeVaultId'))
        const vault = active?.value
            ? await requestResult(transaction.objectStore(PISTACHIO_VAULT_STORE).get(active.value))
            : null
        await transactionDone(transaction)
        return vault ? validatePistachioVault(vault) : null
    } finally {
        database.close()
    }
}

/** Lists validated encrypted vault records without decrypting private material. */
export async function listVaults(indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(PISTACHIO_VAULT_STORE, 'readonly')
        const stored = await requestResult(transaction.objectStore(PISTACHIO_VAULT_STORE).getAll())
        await transactionDone(transaction)
        return stored.map(validatePistachioVault)
    } catch (error) {
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    } finally {
        database.close()
    }
}

/** Reads and validates one encrypted vault by exact vault ID. */
export async function readVault(vaultId, indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(PISTACHIO_VAULT_STORE, 'readonly')
        const stored = await requestResult(transaction.objectStore(PISTACHIO_VAULT_STORE).get(String(vaultId)))
        await transactionDone(transaction)
        return stored ? validatePistachioVault(stored) : null
    } catch (error) {
        if (error instanceof TypeError) throw error
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    } finally {
        database.close()
    }
}

/** Persists the selected active vault ID after proving the vault exists. */
export async function selectActiveVault(vaultId, indexedDb = globalThis.indexedDB) {
    const vault = await readVault(vaultId, indexedDb)
    if (!vault) throw pistachioError('PISTACHIO_VAULT_NOT_FOUND')
    await writePreference('activeVaultId', vault.vaultId, indexedDb)
    return vault
}

/** Deletes one encrypted vault and clears active selection when it referenced that vault. */
export async function deleteVault(vaultId, indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(
            [PISTACHIO_VAULT_STORE, PISTACHIO_PREFERENCES_STORE],
            'readwrite',
        )
        const vaultStore = transaction.objectStore(PISTACHIO_VAULT_STORE)
        const preferenceStore = transaction.objectStore(PISTACHIO_PREFERENCES_STORE)
        const existingRequest = vaultStore.get(String(vaultId))
        const activeRequest = preferenceStore.get('activeVaultId')
        existingRequest.addEventListener('success', () => {
            if (existingRequest.result) vaultStore.delete(String(vaultId))
        }, { once: true })
        activeRequest.addEventListener('success', () => {
            if (activeRequest.result?.value === String(vaultId)) preferenceStore.delete('activeVaultId')
        }, { once: true })
        await transactionDone(transaction)
        return Boolean(existingRequest.result)
    } catch (error) {
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    } finally {
        database.close()
    }
}

/** Writes one passkey-wallet preference to IndexedDB. */
export async function writePreference(key, value, indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(PISTACHIO_PREFERENCES_STORE, 'readwrite')
        transaction.objectStore(PISTACHIO_PREFERENCES_STORE).put({ key, value })
        await transactionDone(transaction)
    } finally {
        database.close()
    }
}

/** Reads one passkey-wallet preference, returning null when absent. */
export async function readPreference(key, indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(PISTACHIO_PREFERENCES_STORE, 'readonly')
        const record = await requestResult(transaction.objectStore(PISTACHIO_PREFERENCES_STORE).get(key))
        await transactionDone(transaction)
        return record?.value ?? null
    } finally {
        database.close()
    }
}

/** Removes diagnostic-only vault state without deleting normal user vaults. */
export async function clearDiagnosticVault(indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(PISTACHIO_PREFERENCES_STORE, 'readwrite')
        transaction.objectStore(PISTACHIO_PREFERENCES_STORE).delete('diagnosticVault')
        await transactionDone(transaction)
    } finally {
        database.close()
    }
}

export const vaultStorageInternals = {
    requestResult,
    transactionDone,
    WALLET_BOOTSTRAP_PREFERENCE_KEYS,
}

/** Commits account selection and reconnect state together; no partial selection on storage failure. */
export async function selectWalletAccount({ vaultId, index, address }, indexedDb = globalThis.indexedDB) {
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction([PISTACHIO_VAULT_STORE, PISTACHIO_PREFERENCES_STORE], 'readwrite')
        const stored = await requestResult(transaction.objectStore(PISTACHIO_VAULT_STORE).get(vaultId))
        const vault = validatePistachioVault(stored)
        if (!Number.isSafeInteger(index) || vaultAccounts(vault)[index]?.address !== address) {
            throw new Error('Wallet changed. Refresh before selecting it.')
        }
        const store = transaction.objectStore(PISTACHIO_PREFERENCES_STORE)
        const previous = (await requestResult(store.get('selectedAccountIndices')))?.value ?? {}
        const indices = { ...previous, [vaultId]: index }
        store.put({ key: 'selectedAccountIndices', value: indices })
        store.put({ key: 'activeVaultId', value: vaultId })
        store.put({ key: 'activeSessionVaultId', value: vaultId })
        await transactionDone(transaction)
        return { vault, indices }
    } finally { database.close() }
}
