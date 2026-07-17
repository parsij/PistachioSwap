import {
    useAppKitAccount,
    useAppKitNetwork,
} from '@reown/appkit/react'
import { isAddress } from 'viem'
import { useAccount, useChainId } from 'wagmi'

export const BSC_CHAIN_ID = 56

export function normalizeWalletState({
    address,
    isConnected,
    chainId,
    expectedChainId = BSC_CHAIN_ID,
}) {
    const normalizedAddress =
        isConnected && isAddress(address ?? '')
            ? address
            : null

    const normalizedChainId =
        chainId === undefined || chainId === null
            ? null
            : Number(chainId)

    return {
        address: normalizedAddress,
        isConnected: Boolean(
            isConnected && normalizedAddress,
        ),
        chainId: Number.isInteger(normalizedChainId)
            ? normalizedChainId
            : null,
        isCorrectNetwork:
            Number.isInteger(normalizedChainId) &&
            normalizedChainId === Number(expectedChainId),
    }
}

export function useWalletState(expectedChainId = BSC_CHAIN_ID) {
    const account = useAppKitAccount({
        namespace: 'eip155',
    })
    const network = useAppKitNetwork()
    const wagmiAccount = useAccount()
    const wagmiChainId = useChainId()
    const wagmiAddress = wagmiAccount.address ?? wagmiAccount.addresses?.[0]
    const wagmiConnected = Boolean(wagmiAccount.isConnected && wagmiAddress)
    const appKitConnected = Boolean(account.isConnected && account.address)
    const address = wagmiConnected && wagmiAddress
        ? wagmiAddress
        : account.address
    const chainId = wagmiConnected
        ? wagmiAccount.chainId ?? wagmiChainId
        : network.chainId

    return normalizeWalletState({
        address,
        isConnected: wagmiConnected || appKitConnected,
        chainId,
        expectedChainId,
    })
}
