import { useCallback } from 'react'
import { encodeFunctionData, isAddress } from 'viem'
import { usePublicClient, useWalletClient } from 'wagmi'

const approveAbi = [{
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
}]
const readAbi = [{
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
}]

// Retained for the normal user-paid approval path. Active Gas Assist uses
// useZeroXGaslessSwap and never calls this hook's transaction flow.
export function useGasAssistApproval({ quote, walletAddress, sellToken, amountIn, onApprovalConfirmed }) {
    const publicClient = usePublicClient({ chainId: 56 })
    const { data: walletClient } = useWalletClient({ chainId: 56 })
    const prepareApproval = useCallback(async () => {
        const selected = quote?.selectedQuote
        if (!selected || sellToken?.isNative || !amountIn || !walletAddress ||
            !isAddress(selected.allowanceTarget ?? '') || !publicClient || !walletClient) return true
        const allowance = await publicClient.readContract({
            address: sellToken.address,
            abi: readAbi,
            functionName: 'allowance',
            args: [walletAddress, selected.allowanceTarget],
        })
        if (allowance >= BigInt(amountIn)) return true
        const data = encodeFunctionData({
            abi: approveAbi,
            functionName: 'approve',
            args: [selected.allowanceTarget, BigInt(amountIn)],
        })
        const hash = await walletClient.sendTransaction({
            account: walletAddress,
            chain: walletClient.chain,
            to: sellToken.address,
            data,
            value: 0n,
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('The approval transaction failed.')
        await onApprovalConfirmed?.()
        return false
    }, [amountIn, onApprovalConfirmed, publicClient, quote, sellToken, walletAddress, walletClient])
    return { prepareApproval }
}
