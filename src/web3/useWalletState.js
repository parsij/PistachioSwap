import {
    useAppKitAccount,
    useAppKitNetwork,
} from '@reown/appkit/react'
import { isAddress } from 'viem'

export const BSC_CHAIN_ID = 56

export function normalizeWalletState({
    address,
    isConnected,
    chainId,
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
            normalizedChainId === BSC_CHAIN_ID,
    }
}

export function useWalletState() {
    const account = useAppKitAccount({
        namespace: 'eip155',
    })
    const network = useAppKitNetwork()

    return normalizeWalletState({
        address: account.address,
        isConnected: account.isConnected,
        chainId: network.chainId,
    })
}
