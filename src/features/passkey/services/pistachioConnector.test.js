import { describe, expect, it, vi } from 'vitest'

import { pistachioConnectorInternals } from './pistachioConnector.js'

function harness(requestConnection = vi.fn(), appKitModal = {}) {
    const emitter = { emit: vi.fn() }
    const closeAppKit = appKitModal.closeAppKit ?? vi.fn(async () => undefined)
    const clearAppKitLoading = appKitModal.clearAppKitLoading ?? vi.fn()
    const manager = {
        disconnect: vi.fn(async () => undefined),
        initialize: vi.fn(async () => undefined),
        lock: vi.fn(async () => undefined),
        providerRequest: vi.fn(),
        requestConnection,
        snapshot: vi.fn(() => ({ phase: 'locked', address: null, sessionActive: false, vault: null })),
        subscribe: vi.fn(() => () => undefined),
        switchChain: vi.fn(async () => undefined),
    }
    return {
        clearAppKitLoading,
        closeAppKit,
        connector: pistachioConnectorInternals.createConnectorConfig(
            { chains: [{ id: 56 }], emitter },
            manager,
            { clearAppKitLoading, closeAppKit },
        ),
        emitter,
        manager,
    }
}

describe('Pistachio Wallet connector entry', () => {
    it('keeps the connector session during a wallet lock and disconnects only after explicit disconnect', () => {
        let publish
        const manager = {
            providerRequest: vi.fn(),
            subscribe: vi.fn((listener) => {
                publish = listener
                listener({ address: null, phase: 'locked', sessionActive: false, vault: null })
                return () => undefined
            }),
        }
        const provider = pistachioConnectorInternals.createProvider(manager)
        const accountsChanged = vi.fn()
        const chainChanged = vi.fn()
        const disconnected = vi.fn()
        provider.on('accountsChanged', accountsChanged)
        provider.on('chainChanged', chainChanged)
        provider.on('disconnect', disconnected)

        publish({ address: '0x0000000000000000000000000000000000000001', phase: 'unlocked', sessionActive: true, vault: { address: '0x0000000000000000000000000000000000000001' } })
        publish({ address: null, phase: 'locked', sessionActive: true, vault: { address: '0x0000000000000000000000000000000000000001' } })
        expect(accountsChanged).toHaveBeenLastCalledWith(['0x0000000000000000000000000000000000000001'])
        expect(disconnected).not.toHaveBeenCalled()

        publish({ address: '0x0000000000000000000000000000000000000001', phase: 'unlocked', sessionActive: true, vault: { address: '0x0000000000000000000000000000000000000001' } })
        publish({ address: null, phase: 'locked', sessionActive: false, vault: { address: '0x0000000000000000000000000000000000000001' } })
        expect(accountsChanged).toHaveBeenLastCalledWith([])
        expect(disconnected).toHaveBeenCalledOnce()

        publish({ address: null, chainId: 8453, phase: 'locked', sessionActive: false, vault: null })
        expect(chainChanged).toHaveBeenCalledWith('0x2105')
    })

    it('restores the active saved address on Wagmi reconnect without opening onboarding', async () => {
        const { closeAppKit, connector, manager } = harness()
        manager.snapshot.mockReturnValue({
            address: null,
            phase: 'locked',
            sessionActive: true,
            vault: { address: '0x0000000000000000000000000000000000000001' },
        })

        await expect(connector.isAuthorized()).resolves.toBe(true)
        await expect(connector.connect({ isReconnecting: true })).resolves.toEqual({
            accounts: ['0x0000000000000000000000000000000000000001'],
            chainId: 56,
        })
        await expect(connector.getAccounts()).resolves.toEqual(['0x0000000000000000000000000000000000000001'])
        expect(manager.requestConnection).not.toHaveBeenCalled()
        expect(closeAppKit).not.toHaveBeenCalled()
        expect(manager.providerRequest).not.toHaveBeenCalled()
    })

    it('does not authorize reconnect after explicit disconnect clears the session', async () => {
        const { connector, manager } = harness()
        manager.snapshot.mockReturnValue({
            address: null,
            phase: 'locked',
            sessionActive: false,
            vault: { address: '0x0000000000000000000000000000000000000001' },
        })

        await expect(connector.isAuthorized()).resolves.toBe(false)
        await expect(connector.connect({ isReconnecting: true })).rejects.toMatchObject({ code: 'PISTACHIO_RECONNECT_UNAVAILABLE' })
        expect(manager.requestConnection).not.toHaveBeenCalled()
    })

    it('uses the onboarding label and does not sign before the bridge resolves', async () => {
        let resolveConnection
        const pending = new Promise((resolve) => { resolveConnection = resolve })
        const { connector, manager } = harness(vi.fn(() => pending))

        expect(connector.name).toBe('Create or Import Pistachio Wallet')
        expect(connector.icon).toBe('/PistachioLogoConnectorV2.svg')
        const connecting = connector.connect({ chainId: 56 })
        await vi.waitFor(() => expect(manager.requestConnection).toHaveBeenCalledOnce())
        expect(manager.providerRequest).not.toHaveBeenCalled()

        resolveConnection('0x0000000000000000000000000000000000000001')
        await expect(connecting).resolves.toEqual({
            accounts: ['0x0000000000000000000000000000000000000001'],
            chainId: 56,
        })
        expect(manager.providerRequest).not.toHaveBeenCalled()
    })

    it('closes AppKit before opening Pistachio onboarding and leaves no second modal', async () => {
        const order = []
        let appKitModalVisible = true
        let resolveConnection
        const pending = new Promise((resolve) => { resolveConnection = resolve })
        const closeAppKit = vi.fn(async () => {
            order.push('close-appkit')
            appKitModalVisible = false
        })
        const requestConnection = vi.fn(() => {
            order.push('open-pistachio')
            expect(appKitModalVisible).toBe(false)
            return pending
        })
        const { connector } = harness(requestConnection, { closeAppKit })

        const connecting = connector.connect()
        await vi.waitFor(() => expect(requestConnection).toHaveBeenCalledOnce())
        expect(order).toEqual(['close-appkit', 'open-pistachio'])
        expect(appKitModalVisible).toBe(false)
        resolveConnection('0x0000000000000000000000000000000000000001')
        await connecting
    })

    it('clears AppKit loading and connector accounts when onboarding closes', async () => {
        const cancelled = Object.assign(new Error('Cancelled.'), { code: 'PISTACHIO_CONNECTION_CANCELLED' })
        let appKitLoading = true
        const clearAppKitLoading = vi.fn(() => { appKitLoading = false })
        const { connector, emitter } = harness(
            vi.fn(async () => { throw cancelled }),
            { clearAppKitLoading },
        )

        await expect(connector.connect()).rejects.toBe(cancelled)
        expect(clearAppKitLoading).toHaveBeenCalledOnce()
        expect(appKitLoading).toBe(false)
        expect(emitter.emit).toHaveBeenCalledWith('change', { accounts: [] })
    })

    it('shares one controller request across duplicate connector clicks', async () => {
        let resolveConnection
        const pending = new Promise((resolve) => { resolveConnection = resolve })
        const { closeAppKit, connector, manager } = harness(vi.fn(() => pending))

        const first = connector.connect()
        const second = connector.connect()
        await vi.waitFor(() => expect(manager.requestConnection).toHaveBeenCalledOnce())
        expect(closeAppKit).toHaveBeenCalledOnce()

        resolveConnection('0x0000000000000000000000000000000000000001')
        await expect(Promise.all([first, second])).resolves.toEqual([
            { accounts: ['0x0000000000000000000000000000000000000001'], chainId: 56 },
            { accounts: ['0x0000000000000000000000000000000000000001'], chainId: 56 },
        ])
    })

    it('disconnects through the lock-only manager lifecycle', async () => {
        const { connector, manager } = harness(vi.fn())
        await connector.disconnect()
        expect(manager.disconnect).toHaveBeenCalledOnce()
        expect(manager.lock).not.toHaveBeenCalled()
    })

    it('does not reconnect silently without an active saved session', async () => {
        const { connector, manager } = harness(vi.fn())
        await expect(connector.connect({ isReconnecting: true })).rejects.toMatchObject({ code: 'PISTACHIO_RECONNECT_UNAVAILABLE' })
        expect(manager.requestConnection).not.toHaveBeenCalled()
    })

    it('switches among allowlisted chains and rejects unsupported chains', async () => {
        const { connector, manager } = harness()
        await expect(connector.switchChain({ chainId: 8453 })).resolves.toMatchObject({ id: 8453 })
        expect(manager.switchChain).toHaveBeenCalledWith(8453)
        await expect(connector.switchChain({ chainId: 999999 })).rejects.toThrow('not enabled')
    })
})
