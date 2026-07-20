import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
    connectMetaMaskMultichain,
    disconnectMetaMaskMultichain,
    getMetaMaskMultichainSession,
    identifyMetaMaskAppKitConnector,
    inspectMetaMaskMultichainCapability,
    isMetaMaskConnectorMetadata,
    isMetaMaskMultichainEnabled,
    restoreMetaMaskMultichainSession,
    sanitizeMetaMaskMultichainError,
    signMetaMaskMultichainTransaction,
    subscribeMetaMaskMultichainSession,
} from '../services/metamaskMultichain.js'

/**
 * Coordinates the optional MetaMask multichain session used to sign prepared
 * sponsored transactions without mixing that behavior into normal swaps.
 *
 * @param {object} config Wallet and connector state supplied by the controller.
 * @param {string | undefined} config.appKitAddress Address reported by AppKit.
 * @param {string | undefined} [config.authenticatedWalletAddress] Address bound to the sponsored request.
 * @param {object | undefined} config.connector Active AppKit connector metadata.
 * @param {boolean} [config.appKitConnected] Whether AppKit currently has an authenticated connection.
 * @returns {object} Capability/session state plus initialize, connect, reconnect,
 * disconnect, and prepared-transaction signing operations.
 * @throws Sanitized MetaMask capability, connection, session, or signing errors.
 * @sideEffects Subscribes to the MetaMask multichain session and may prompt the
 * wallet only when a returned connection or signing operation is invoked.
 * @security The authenticated address and prepared transaction are revalidated
 * by the service before signing; callers must not substitute review intent.
 */
export function useMetaMaskMultichainSigner({
    appKitAddress,
    authenticatedWalletAddress = appKitAddress,
    connector,
    appKitConnected = Boolean(appKitAddress && connector),
}) {
    const enabled = isMetaMaskMultichainEnabled()
    const [isMetaMask, setIsMetaMask] = useState(() => isMetaMaskConnectorMetadata(connector))
    const [session, setSession] = useState(() => getMetaMaskMultichainSession())
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const generationRef = useRef(0)

    useEffect(() => {
        generationRef.current += 1
        const generation = generationRef.current
        setIsMetaMask(isMetaMaskConnectorMetadata(connector))
        if (!enabled || !appKitConnected || !connector) return undefined
        identifyMetaMaskAppKitConnector(connector).then((identified) => {
            if (generationRef.current === generation) setIsMetaMask(identified)
        })
        return () => {
            generationRef.current += 1
        }
    }, [appKitAddress, appKitConnected, connector, enabled])

    useEffect(() => subscribeMetaMaskMultichainSession(setSession), [])

    useEffect(() => {
        if (!enabled || !appKitConnected || !isMetaMask) return undefined
        const generation = generationRef.current
        restoreMetaMaskMultichainSession()
            .then((restored) => {
                if (generationRef.current === generation) setSession(restored)
            })
            .catch((caught) => {
                if (generationRef.current === generation) setError(sanitizeMetaMaskMultichainError(caught))
            })
        return undefined
    }, [appKitConnected, enabled, isMetaMask])

    const capability = useMemo(() => inspectMetaMaskMultichainCapability({
        featureEnabled: enabled,
        appKitConnected,
        appKitAddress,
        authenticatedWalletAddress,
        isMetaMask,
        currentSession: session,
    }), [appKitAddress, appKitConnected, authenticatedWalletAddress, enabled, isMetaMask, session])

    const run = useCallback(async (operation) => {
        const generation = generationRef.current
        setLoading(true)
        setError(null)
        try {
            const result = await operation()
            if (generationRef.current !== generation) return null
            return result
        } catch (caught) {
            const sanitized = sanitizeMetaMaskMultichainError(caught)
            if (generationRef.current === generation) setError(sanitized)
            throw sanitized
        } finally {
            if (generationRef.current === generation) setLoading(false)
        }
    }, [])

    const initialize = useCallback(() => run(async () => {
        const restored = await restoreMetaMaskMultichainSession()
        setSession(restored)
        return restored
    }), [run])
    const connect = useCallback(() => run(() => connectMetaMaskMultichain()), [run])
    const reconnect = useCallback(() => run(() => connectMetaMaskMultichain({ forceRequest: true })), [run])
    const disconnect = useCallback(() => run(async () => {
        await disconnectMetaMaskMultichain()
        setSession(null)
    }), [run])
    const signPreparedTransaction = useCallback((preparedTransaction) => run(() => signMetaMaskMultichainTransaction({
        preparedTransaction,
        authenticatedWalletAddress,
        appKitAddress,
        isMetaMask,
    })), [appKitAddress, authenticatedWalletAddress, isMetaMask, run])
    return {
        capability,
        session,
        account: capability.account,
        initialize,
        connect,
        reconnect,
        disconnect,
        signPreparedTransaction,
        loading,
        error,
        isMetaMask,
    }
}
