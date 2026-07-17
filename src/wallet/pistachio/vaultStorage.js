import {
    PISTACHIO_PREFERENCES_STORE,
    PISTACHIO_VAULT_DB_NAME,
    PISTACHIO_VAULT_DB_VERSION,
    PISTACHIO_VAULT_STORE,
} from './constants.js'
import { pistachioError } from './passkeyErrors.js'
import { validatePistachioVault } from './vaultSchema.js'

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

export async function saveAndReadBackVault(vault, indexedDb = globalThis.indexedDB) {
    const validated = validatePistachioVault(vault)
    const database = await openPistachioWalletDatabase(indexedDb)
    try {
        const transaction = database.transaction(
            [PISTACHIO_VAULT_STORE, PISTACHIO_PREFERENCES_STORE],
            'readwrite',
        )
        transaction.objectStore(PISTACHIO_VAULT_STORE).put(validated)
        transaction.objectStore(PISTACHIO_PREFERENCES_STORE).put({ key: 'activeVaultId', value: validated.vaultId })
        await transactionDone(transaction)
        const readTransaction = database.transaction(PISTACHIO_VAULT_STORE, 'readonly')
        const stored = await requestResult(readTransaction.objectStore(PISTACHIO_VAULT_STORE).get(validated.vaultId))
        await transactionDone(readTransaction)
        return validatePistachioVault(stored)
    } catch (error) {
        throw pistachioError('PISTACHIO_WALLET_STORAGE_FAILED', undefined, error)
    } finally {
        database.close()
    }
}

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

export async function selectActiveVault(vaultId, indexedDb = globalThis.indexedDB) {
    const vault = await readVault(vaultId, indexedDb)
    if (!vault) throw pistachioError('PISTACHIO_VAULT_NOT_FOUND')
    await writePreference('activeVaultId', vault.vaultId, indexedDb)
    return vault
}

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

export const vaultStorageInternals = { requestResult, transactionDone }
