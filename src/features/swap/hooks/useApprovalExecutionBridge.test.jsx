// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useApprovalExecutionBridge } from './useApprovalExecutionBridge.js'

const WALLET = '0xe448af520b5a16293321cf0251c97fd4a1486ce0'
const TOKEN = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const SPENDER = '0x0000000000001ff3684f28c67538d4d072c22734'

function quote(overrides = {}) {
    return {
        selectedQuote: {
            sellToken: TOKEN,
            allowanceTarget: SPENDER,
            approval: {
                mode: 'erc20',
                contract: SPENDER,
                spender: SPENDER,
                token: TOKEN,
                requiredAmount: '56',
            },
            ...overrides,
        },
    }
}

describe('useApprovalExecutionBridge', () => {
    it('rechecks a confirmed allowance and continues without sending a second approval', async () => {
        const prepareSwapApproval = vi.fn().mockResolvedValue(false)
        const getLastPreparationResult = vi.fn(() => ({
            approvalReady: false,
            approvalTransactionSubmitted: true,
        }))
        const publicClient = {
            readContract: vi.fn().mockResolvedValue(56n),
        }
        const diagnostic = vi.fn()
        const { result } = renderHook(() => useApprovalExecutionBridge({
            prepareSwapApproval,
            getLastPreparationResult,
            quote: quote(),
            publicClient,
            walletAddress: WALLET,
            sellToken: { address: TOKEN },
            diagnostic,
        }))

        let ready
        await act(async () => {
            ready = await result.current.prepareExecutionApproval()
        })

        expect(ready).toBe(true)
        expect(prepareSwapApproval).toHaveBeenCalledTimes(1)
        expect(publicClient.readContract).toHaveBeenCalledWith(expect.objectContaining({
            address: TOKEN,
            functionName: 'allowance',
            args: [WALLET, SPENDER],
        }))
        expect(result.current.getExecutionApprovalResult()).toEqual({
            approvalReady: true,
            approvalTransactionSubmitted: true,
        })
        expect(diagnostic).toHaveBeenCalledWith(
            'approval.erc20.post-confirmation-read.result',
            expect.objectContaining({ sufficient: true }),
            'debug',
        )
    })

    it('does not perform an extra allowance read when approval was already ready', async () => {
        const publicClient = { readContract: vi.fn() }
        const { result } = renderHook(() => useApprovalExecutionBridge({
            prepareSwapApproval: vi.fn().mockResolvedValue(true),
            getLastPreparationResult: () => ({
                approvalReady: true,
                approvalTransactionSubmitted: false,
            }),
            quote: quote(),
            publicClient,
            walletAddress: WALLET,
            sellToken: { address: TOKEN },
        }))

        await expect(result.current.prepareExecutionApproval()).resolves.toBe(true)
        expect(publicClient.readContract).not.toHaveBeenCalled()
    })

    it('fails closed when confirmed approval metadata no longer matches the reviewed quote', async () => {
        const publicClient = { readContract: vi.fn() }
        const { result } = renderHook(() => useApprovalExecutionBridge({
            prepareSwapApproval: vi.fn().mockResolvedValue(false),
            getLastPreparationResult: () => ({
                approvalReady: false,
                approvalTransactionSubmitted: true,
            }),
            quote: quote({ allowanceTarget: WALLET }),
            publicClient,
            walletAddress: WALLET,
            sellToken: { address: TOKEN },
        }))

        await expect(result.current.prepareExecutionApproval()).rejects.toThrow(
            'could not be verified safely',
        )
        expect(publicClient.readContract).not.toHaveBeenCalled()
    })
})
