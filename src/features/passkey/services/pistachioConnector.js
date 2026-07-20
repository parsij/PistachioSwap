import { createConnector } from 'wagmi'

import { getCuratedEvmChain, isCuratedEvmChainId } from '../../../web3/curatedEvmChains.js'
import { PISTACHIO_CHAIN_ID, PISTACHIO_CONNECTOR_ID } from './constants.js'
import { getPistachioWalletManager } from './walletManager.js'

function snapshotAccount(snapshot) {
    if (snapshot.phase === 'unlocked' && snapshot.address) return snapshot.address
    if (snapshot.sessionActive && snapshot.vault?.address) return snapshot.vault.address
    return null
}

function createProvider(manager) {
    const listeners = new Map()
    const emit = (event, value) => {
        for (const listener of listeners.get(event) ?? []) listener(value)
    }
    let previousAddress = null
    let previousChainId = null
    manager.subscribe((snapshot) => {
        const address = snapshotAccount(snapshot)
        const chainId = snapshot.chainId ?? PISTACHIO_CHAIN_ID
        if (address !== previousAddress) {
            emit('accountsChanged', address ? [address] : [])
            if (!address && previousAddress && !snapshot.sessionActive) {
                emit('disconnect', { code: 4900, message: 'Pistachio Wallet disconnected.' })
            }
            previousAddress = address
        }
        if (previousChainId !== null && chainId !== previousChainId) emit('chainChanged', `0x${chainId.toString(16)}`)
        previousChainId = chainId
    })
    return Object.freeze({
        request: (request) => manager.providerRequest(request),
        on(event, listener) {
            const eventListeners = listeners.get(event) ?? new Set()
            eventListeners.add(listener)
            listeners.set(event, eventListeners)
            return this
        },
        removeListener(event, listener) {
            listeners.get(event)?.delete(listener)
            return this
        },
    })
}

function createConnectorConfig(config, manager, {
    clearAppKitLoading = () => {},
    closeAppKit = async () => {},
} = {}) {
    const provider = createProvider(manager)
    let unsubscribe = null
    let activeConnection = null
    return {
            id: PISTACHIO_CONNECTOR_ID,
            name: 'Create or Import Pistachio Wallet',
            type: 'pistachio-local',
            icon: '/PistachioLogoConnectorV2.svg',
            async setup() {
                await manager.initialize()
                unsubscribe ??= manager.subscribe((snapshot) => {
                    const address = snapshotAccount(snapshot)
                    const chainId = snapshot.chainId ?? PISTACHIO_CHAIN_ID
                    if (address) {
                        config.emitter.emit('change', { accounts: [address], chainId })
                    } else {
                        config.emitter.emit('change', { accounts: [], chainId })
                    }
                })
            },
            async connect(parameters = {}) {
                if (parameters.chainId !== undefined) await manager.switchChain(parameters.chainId)
                if (parameters.isReconnecting) {
                    await manager.initialize()
                    const address = snapshotAccount(manager.snapshot())
                    if (address) return { accounts: [address], chainId: manager.snapshot().chainId ?? PISTACHIO_CHAIN_ID }
                    const error = new Error('Pistachio Wallet has no active saved session to reconnect.')
                    error.code = 'PISTACHIO_RECONNECT_UNAVAILABLE'
                    throw error
                }
                if (activeConnection) return activeConnection
                activeConnection = (async () => {
                    let loadingCleared = false
                    const clearLoading = () => {
                        if (loadingCleared) return
                        loadingCleared = true
                        clearAppKitLoading()
                    }
                    try {
                        await closeAppKit()
                        clearLoading()
                        const address = await manager.requestConnection()
                        return { accounts: [address], chainId: manager.snapshot().chainId ?? PISTACHIO_CHAIN_ID }
                    } catch (error) {
                        clearLoading()
                        config.emitter.emit('change', { accounts: [] })
                        throw error
                    } finally {
                        activeConnection = null
                    }
                })()
                return activeConnection
            },
            async disconnect() {
                await manager.disconnect()
            },
            async getAccounts() {
                const snapshot = manager.snapshot()
                const address = snapshotAccount(snapshot)
                return address ? [address] : []
            },
            async getChainId() {
                return manager.snapshot().chainId ?? PISTACHIO_CHAIN_ID
            },
            async getProvider() {
                return provider
            },
            async isAuthorized() {
                await manager.initialize()
                return Boolean(snapshotAccount(manager.snapshot()))
            },
            async switchChain({ chainId }) {
                if (!isCuratedEvmChainId(chainId)) throw new Error('This network is not enabled in PistachioSwap.')
                await manager.switchChain(chainId)
                return config.chains.find((chain) => chain.id === Number(chainId)) ?? getCuratedEvmChain(chainId)
            },
            onAccountsChanged(accounts) {
                const expected = snapshotAccount(manager.snapshot())
                if (
                    accounts.length !== 1 ||
                    !expected ||
                    String(accounts[0]).toLowerCase() !== expected.toLowerCase()
                ) {
                    void manager.lock('account-mismatch')
                }
            },
            onChainChanged(chainId) {
                void manager.switchChain(Number(chainId)).catch(() => manager.lock('chain-invariant'))
            },
            onDisconnect() {
                manager.lock('provider-disconnect')
            },
    }
}

/**
 * Creates the AppKit/Wagmi connector for the local passkey wallet manager.
 * @param {object} [appKitModal] Modal bridge used to synchronize connection UI.
 * @returns {import('wagmi').CreateConnectorFn} Connector factory with account, chain, signing, and lifecycle methods.
 * @sideEffects Connector methods may unlock the vault, sign, broadcast, or emit Wagmi events after user action.
 */
export function pistachioWalletConnector(appKitModal = {}) {
    return createConnector((config) => createConnectorConfig(config, getPistachioWalletManager(), appKitModal))
}

export const pistachioConnectorInternals = { createConnectorConfig, createProvider, snapshotAccount }
