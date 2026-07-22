import { useCallback, useRef } from 'react'
import { isAddress } from 'viem'

const allowanceAbi = [{
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
}]

function sameAddress(left, right) {
    return String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()
}

function directApprovalDetails({ quoteResponse, walletAddress, sellToken }) {
    const selected = quoteResponse?.selectedQuote
    const approval = selected?.approval
    const mode = String(approval?.mode ?? '').trim().toLowerCase()
    const token = String(approval?.token ?? '')
    const spender = String(approval?.spender ?? '')
    const requiredAmount = String(approval?.requiredAmount ?? '')
    if (
        mode !== 'erc20' ||
        !isAddress(String(walletAddress ?? '')) ||
        !isAddress(token) ||
        !isAddress(spender) ||
        !/^\d+$/.test(requiredAmount) ||
        BigInt(requiredAmount) <= 0n ||
        !sameAddress(token, sellToken?.address) ||
        !sameAddress(token, selected?.sellToken) ||
        !sameAddress(spender, selected?.allowanceTarget) ||
        !sameAddress(approval?.contract, selected?.allowanceTarget)
    ) return null

    return {
        token,
        spender,
        required: BigInt(requiredAmount),
    }
}

/**
 * Converts a confirmed direct ERC-20 approval into a ready execution state by
 * re-reading the exact allowance. It never submits a second approval.
 */
export function useApprovalExecutionBridge({
    prepareSwapApproval,
    getLastPreparationResult,
    quote,
    publicClient,
    walletAddress,
    sellToken,
    diagnostic,
}) {
    const lastResultRef = useRef({
        approvalReady: false,
        approvalTransactionSubmitted: false,
    })

    const prepareExecutionApproval = useCallback(async (quoteOverride = null) => {
        const quoteResponse = quoteOverride ?? quote
        let approvalReady = await prepareSwapApproval(quoteOverride)
        const initial = getLastPreparationResult?.() ?? {
            approvalReady,
            approvalTransactionSubmitted: false,
        }
        let approvalTransactionSubmitted =
            initial.approvalTransactionSubmitted === true

        if (!approvalReady && approvalTransactionSubmitted) {
            const details = directApprovalDetails({
                quoteResponse,
                walletAddress,
                sellToken,
            })
            if (!details || !publicClient) {
                throw new Error(
                    'The confirmed token approval could not be verified safely.',
                )
            }

            diagnostic?.('approval.erc20.post-confirmation-read.start', {
                token: details.token,
                spender: details.spender,
                requiredAmount: details.required.toString(),
            })
            const allowance = await publicClient.readContract({
                address: details.token,
                abi: allowanceAbi,
                functionName: 'allowance',
                args: [walletAddress, details.spender],
            })
            approvalReady = allowance >= details.required
            diagnostic?.('approval.erc20.post-confirmation-read.result', {
                allowance: allowance.toString(),
                requiredAmount: details.required.toString(),
                sufficient: approvalReady,
            }, approvalReady ? 'debug' : 'error')
        }

        lastResultRef.current = {
            approvalReady,
            approvalTransactionSubmitted,
        }
        return approvalReady
    }, [
        diagnostic,
        getLastPreparationResult,
        prepareSwapApproval,
        publicClient,
        quote,
        sellToken,
        walletAddress,
    ])

    const getExecutionApprovalResult = useCallback(
        () => lastResultRef.current,
        [],
    )

    return {
        prepareExecutionApproval,
        getExecutionApprovalResult,
    }
}

export const approvalExecutionBridgeInternals = {
    allowanceAbi,
    directApprovalDetails,
    sameAddress,
}
