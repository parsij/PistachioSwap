import { describe, expect, it } from 'vitest'

import { WalletConnectionBridge, connectionError } from './walletConnectionBridge.js'

describe('Pistachio Wallet connection bridge', () => {
    it('shares one pending promise and resolves it once', async () => {
        const bridge = new WalletConnectionBridge()
        const first = bridge.wait()
        expect(bridge.wait()).toBe(first)
        expect(bridge.resolve('0x0000000000000000000000000000000000000001')).toBe(true)
        await expect(first).resolves.toBe('0x0000000000000000000000000000000000000001')
        expect(bridge.resolve('ignored')).toBe(false)
    })

    it('rejects modal cancellation cleanly and permits a later reconnect', async () => {
        const bridge = new WalletConnectionBridge()
        const cancelled = bridge.wait()
        bridge.reject(connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Cancelled.'))
        await expect(cancelled).rejects.toMatchObject({ code: 'PISTACHIO_CONNECTION_CANCELLED' })

        const reconnect = bridge.wait()
        bridge.resolve('same-address')
        await expect(reconnect).resolves.toBe('same-address')
    })
})
