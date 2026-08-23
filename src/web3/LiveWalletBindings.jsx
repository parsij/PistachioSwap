import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
    useAppKit,
    useAppKitAccount,
    useAppKitNetwork,
} from '@reown/appkit/react'
import { getPublicClient } from 'wagmi/actions'
import {
    useAccount,
    useBalance,
    useChainId,
    useConfig,
    useConnection,
    useDisconnect,
    useSendTransaction,
    useWaitForTransactionReceipt,
    useWalletClient,
    useWriteContract,
} from 'wagmi'

import {
    getWalletQueries,
    patchWalletRuntime,
    publishBalanceResult,
    publishReceiptResult,
    subscribeWalletQueries,
} from './walletRuntime.js'
import { forgetWalletSession, rememberWalletSession } from './walletSession.js'

function BalanceBridge({ queryKey, address, chainId, enabled }) {
    const {
        data,
        error,
        isError,
        isLoading,
        isPending,
        isSuccess,
        refetch,
        status,
    } = useBalance({
        address: enabled ? address : undefined,
        chainId,
        query: { enabled: Boolean(enabled && address) },
    })

    useEffect(() => {
        publishBalanceResult(queryKey, {
            data,
            error,
            isError,
            isLoading,
            isPending,
            isSuccess,
            refetch,
            status,
        })
    }, [
        queryKey,
        data,
        error,
        isError,
        isLoading,
        isPending,
        isSuccess,
        refetch,
        status,
    ])

    return null
}

function ReceiptBridge({ queryKey, hash, chainId, enabled }) {
    const {
        data,
        error,
        isError,
        isLoading,
        isPending,
        isSuccess,
    } = useWaitForTransactionReceipt({
        hash,
        chainId,
        query: { enabled: Boolean(enabled && hash) },
    })

    useEffect(() => {
        publishReceiptResult(queryKey, {
            data,
            error,
            isError,
            isLoading,
            isPending,
            isSuccess,
        })
    }, [queryKey, data, error, isError, isLoading, isPending, isSuccess])

    return null
}

/**
 * Runs inside AppKit/Wagmi after Connect, and publishes live wallet APIs into
 * `walletRuntime` without remounting the swap tree.
 */
export default function LiveWalletBindings() {
    const { open } = useAppKit()
    const account = useAppKitAccount({ namespace: 'eip155' })
    const network = useAppKitNetwork()
    const wagmiAccount = useAccount()
    const wagmiChainId = useChainId()
    const config = useConfig()
    const connection = useConnection()
    const { data: walletClient } = useWalletClient()
    const { mutateAsync: disconnectWallet } = useDisconnect()
    const disconnect = useCallback(async (...args) => {
        forgetWalletSession()
        return disconnectWallet(...args)
    }, [disconnectWallet])
    const { mutateAsync: sendTransaction } = useSendTransaction()
    const { mutateAsync: writeContract } = useWriteContract()
    const queries = useSyncExternalStore(
        subscribeWalletQueries,
        getWalletQueries,
        getWalletQueries,
    )
    const chainId = wagmiAccount.chainId ?? wagmiChainId ?? network.chainId ?? 56
    const getClient = useCallback((requestedChainId) => {
        if (!config) return undefined
        try {
            return getPublicClient(
                config,
                requestedChainId != null
                    ? { chainId: Number(requestedChainId) }
                    : undefined,
            )
        } catch {
            return undefined
        }
    }, [config])

    useEffect(() => {
        if (account?.isConnected || wagmiAccount?.isConnected) {
            rememberWalletSession()
        }
    }, [account?.isConnected, wagmiAccount?.isConnected])

    useEffect(() => {
        patchWalletRuntime({
            ready: true,
            open,
            switchNetwork: network.switchNetwork,
            account,
            wagmiAccount,
            chainId,
            config,
            connection,
            walletClient: walletClient ?? null,
            publicClient: getClient(chainId),
            getPublicClient: getClient,
            sendTransaction,
            writeContract,
            disconnect,
        })
    }, [
        account,
        chainId,
        config,
        connection,
        disconnect,
        getClient,
        network.switchNetwork,
        open,
        sendTransaction,
        wagmiAccount,
        walletClient,
        writeContract,
    ])

    return (
        <>
            {[...queries.balances.entries()].map(([key, params]) => (
                <BalanceBridge
                    key={key}
                    queryKey={key}
                    address={params.address}
                    chainId={params.chainId}
                    enabled={params.enabled}
                />
            ))}
            {[...queries.receipts.entries()].map(([key, params]) => (
                <ReceiptBridge
                    key={key}
                    queryKey={key}
                    hash={params.hash}
                    chainId={params.chainId}
                    enabled={params.enabled}
                />
            ))}
        </>
    )
}
