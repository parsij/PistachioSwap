import { describe, expect, it } from 'vitest'

import {
    forgetWalletSession,
    hasPersistedWalletSession,
    rememberWalletSession,
    WALLET_SESSION_FLAG,
} from './walletSession.js'

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial))
    return {
        get length() {
            return data.size
        },
        key(index) {
            return [...data.keys()][index] ?? null
        },
        getItem(key) {
            return data.has(key) ? data.get(key) : null
        },
        setItem(key, value) {
            data.set(key, String(value))
        },
        removeItem(key) {
            data.delete(key)
        },
    }
}

describe('persisted wallet session', () => {
    it('restores from the Pistachio session flag', () => {
        const storage = memoryStorage()
        expect(hasPersistedWalletSession(storage)).toBe(false)
        rememberWalletSession(storage)
        expect(storage.getItem(WALLET_SESSION_FLAG)).toBe('1')
        expect(hasPersistedWalletSession(storage)).toBe(true)
        forgetWalletSession(storage)
        expect(hasPersistedWalletSession(storage)).toBe(false)
    })

    it('restores from a Wagmi store with an active connection', () => {
        const storage = memoryStorage({
            'wagmi.store': JSON.stringify({
                state: {
                    current: 'connector-1',
                    connections: { __type: 'Map', value: [['connector-1', {}]] },
                },
            }),
        })
        expect(hasPersistedWalletSession(storage)).toBe(true)
    })

    it('ignores an empty Wagmi store', () => {
        const storage = memoryStorage({
            'wagmi.store': JSON.stringify({ state: { connections: { value: [] } } }),
        })
        expect(hasPersistedWalletSession(storage)).toBe(false)
    })

    it('restores from AppKit connection keys', () => {
        const storage = memoryStorage({
            '@appkit/connected_connector_id': 'walletConnect',
        })
        expect(hasPersistedWalletSession(storage)).toBe(true)
    })
})
