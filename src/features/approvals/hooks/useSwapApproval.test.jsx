// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { decodeFunctionData } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    readContract: vi.fn(),
    waitForReceipt: vi.fn(),
    sendTransaction: vi.fn(),
}))

vi.mock('wagmi', () => ({
    usePublicClient: () => ({
        readContract: mocks.readContract,
        waitForTransactionReceipt: mocks.waitForReceipt,
    }),
    useWalletClient: () => ({
        data: {
            chain: { id: 56 },
            sendTransaction: mocks.sendTransaction,
        },
    }),
}))

import { useSwapApproval } from './useSwapApproval.js'
import { normalizeQuoteResponse } from '../../swap/services/quotes.js'

const wallet = '0x0000000000000000000000000000000000000001'
const token = '0x0000000000000000000000000000000000000002'
const spender = '0x0000000000000000000000000000000000000003'
const permit2 = '0x0000000000000000000000000000000000000004'
const router = '0x0000000000000000000000000000000000000005'

function setup(selectedQuote, options = {}) {
    return renderHook(() => useSwapApproval({
        quote: { selectedQuote },
        walletAddress: wallet,
        sellToken: { address: token, isNative: false },
        amountIn: '100',
        chainId: 56,
        onApprovalConfirmed: options.onApprovalConfirmed ?? vi.fn(),
        onDiagnostic: options.onDiagnostic,
    }))
}

function pancakeQuote(overrides = {}) {
    return {
        provider: 'pancakeswap',
        mode: 'EXACT_INPUT',
        chainId: 56,
        sellToken: token,
        maximumSellAmount: '100',
        allowanceTarget: permit2,
        transaction: { to: router },
        approval: {
            mode: 'permit2-allowance',
            token,
            spender: router,
            contract: permit2,
            requiredAmount: '100',
        },
        ...overrides,
    }
}

function permit2State(amount, expiration) {
    return [BigInt(amount), BigInt(expiration), 0n]
}

describe('normal token approval safety', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.readContract.mockResolvedValue(0n)
        mocks.sendTransaction.mockResolvedValue(`0x${'11'.repeat(32)}`)
        mocks.waitForReceipt.mockResolvedValue({ status: 'success' })
    })

    it('approves the exact maximum sell amount for exact-output quotes', async () => {
        const { result } = setup({
            mode: 'EXACT_OUTPUT',
            chainId: 56,
            sellToken: token,
            maximumSellAmount: '125',
            allowanceTarget: spender,
            approval: {
                mode: 'erc20',
                contract: spender,
                spender,
                token,
                requiredAmount: '125',
            },
        })

        await act(() => result.current.prepareSwapApproval())
        const transaction = mocks.sendTransaction.mock.calls[0][0]
        expect(decodeFunctionData({
            abi: [{
                type: 'function', name: 'approve', stateMutability: 'nonpayable',
                inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
                outputs: [{ type: 'bool' }],
            }],
            data: transaction.data,
        }).args).toEqual([spender, 125n])
        expect(transaction.to).toBe(token)
    })

    it.each([
        ['a mismatched chain', { chainId: 1, sellToken: token, allowanceTarget: spender, maximumSellAmount: '100' }],
        ['a mismatched sell token', { chainId: 56, sellToken: spender, allowanceTarget: spender, maximumSellAmount: '100' }],
        ['a zero allowance target', { chainId: 56, sellToken: token, allowanceTarget: '0x0000000000000000000000000000000000000000', maximumSellAmount: '100' }],
        ['a missing maximum amount', { mode: 'EXACT_OUTPUT', chainId: 56, sellToken: token, allowanceTarget: spender, maximumSellAmount: null }],
    ])('fails closed for %s', async (_label, selectedQuote) => {
        const { result } = setup(selectedQuote)
        await expect(result.current.prepareSwapApproval()).rejects.toThrow(
            'invalid token approval details',
        )
        expect(mocks.readContract).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it.each([
        ['expiration = 0', permit2State(100, 0)],
        ['expired Permit2 allowance', permit2State(100, 99)],
        ['insufficient Permit2 amount', permit2State(99, 200)],
    ])('rejects %s until a fresh Permit2 approval is confirmed', async (_label, state) => {
        mocks.readContract
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(state)
            .mockResolvedValueOnce(state)

        const { result } = setup(pancakeQuote())

        await act(async () => {
            await expect(result.current.prepareSwapApproval()).resolves.toBe(false)
        })
        expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
        expect(mocks.sendTransaction.mock.calls[0][0].to).toBe(permit2)
    })

    it('rejects a wrong Permit2 spender from the executable quote', async () => {
        const { result } = setup(pancakeQuote({
            approval: {
                ...pancakeQuote().approval,
                spender,
            },
        }))

        await expect(result.current.prepareSwapApproval()).rejects.toThrow(
            'invalid Permit2 approval details',
        )
        expect(mocks.readContract).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('fails closed when Pancake Permit2 metadata is missing', async () => {
        const { result } = setup(pancakeQuote({ approval: null }))

        await expect(result.current.prepareSwapApproval()).rejects.toThrow(
            'invalid Permit2 approval details',
        )
        expect(mocks.readContract).not.toHaveBeenCalled()
    })

    it.each([
        ['wrong chain', { chainId: 1 }],
        ['wrong token', { approval: { ...pancakeQuote().approval, token: spender } }],
    ])('rejects a Pancake quote with the %s', async (_label, override) => {
        const { result } = setup(pancakeQuote(override))

        await expect(result.current.prepareSwapApproval()).rejects.toThrow()
        expect(mocks.readContract).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('allows submission when ERC-20 plus Permit2 allowance are valid', async () => {
        const diagnostic = vi.fn()
        mocks.readContract
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(permit2State(100, 4_000_000_000))

        const { result } = setup(pancakeQuote({ provider: ' PancakeSwap ' }), {
            onDiagnostic: diagnostic,
        })

        await act(async () => {
            await expect(result.current.prepareSwapApproval()).resolves.toBe(true)
        })
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
        expect(result.current.getLastPreparationResult()).toEqual({
            approvalReady: true,
            approvalTransactionSubmitted: false,
        })
        expect(diagnostic).toHaveBeenCalledWith(
            'approval.strategy.selected',
            expect.objectContaining({
                normalizedProvider: 'pancakeswap',
                approvalMode: 'permit2-allowance',
                hasCanonicalPermit2Metadata: true,
                isPancakeRouterTransaction: true,
                selectedStrategy: 'permit2-allowance',
                reason: 'canonical-permit2-metadata',
            }),
            'debug',
        )
        const events = diagnostic.mock.calls.map(([event]) => event)
        expect(events.indexOf('approval.erc20.read.result')).toBeLessThan(
            events.indexOf('approval.permit2.read.start'),
        )
    })

    it('selects Permit2 from explicit metadata instead of the provider name', async () => {
        mocks.readContract
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(permit2State(100, 4_000_000_000))
        const { result } = setup(pancakeQuote({ provider: 'aggregated-route' }))

        await expect(result.current.prepareSwapApproval()).resolves.toBe(true)
        expect(mocks.readContract).toHaveBeenCalledTimes(2)
        expect(mocks.readContract.mock.calls[1][0]).toEqual(expect.objectContaining({
            address: permit2,
            functionName: 'allowance',
            args: [wallet, token, router],
        }))
    })

    it('selects Permit2 for the canonical browser-normalized Pancake quote', async () => {
        const diagnostic = vi.fn()
        const normalized = normalizeQuoteResponse({
            approvalSchemaVersion: 1,
            selectedQuote: pancakeQuote(),
        })
        mocks.readContract
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(permit2State(100, 4_000_000_000))
        const { result } = setup(normalized.selectedQuote, { onDiagnostic: diagnostic })

        await expect(result.current.prepareSwapApproval()).resolves.toBe(true)
        expect(diagnostic).toHaveBeenCalledWith(
            'approval.strategy.selected',
            expect.objectContaining({
                selectedStrategy: 'permit2-allowance',
                hasCanonicalPermit2Metadata: true,
                isPancakeRouterTransaction: true,
            }),
            'debug',
        )
        const events = diagnostic.mock.calls.map(([event]) => event)
        expect(events).toContain('approval.metadata.prepare-input')
        expect(events).toContain('approval.permit2.read.start')
        expect(events).toContain('approval.permit2.read.result')
    })

    it.each([
        ['missing approval mode', { approval: { ...pancakeQuote().approval, mode: undefined } }],
        ['missing Permit2 contract', { approval: { ...pancakeQuote().approval, contract: undefined } }],
    ])('fails closed for Pancake with %s', async (_label, override) => {
        const diagnostic = vi.fn()
        const { result } = setup(pancakeQuote(override), { onDiagnostic: diagnostic })

        await expect(result.current.prepareSwapApproval()).rejects.toThrow(
            'invalid Permit2 approval details',
        )
        expect(mocks.readContract).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('submits required Permit2 approval, confirms it, and re-reads readiness', async () => {
        const diagnostic = vi.fn()
        const confirmed = vi.fn()
        mocks.readContract
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(permit2State(0, 0))
            .mockResolvedValueOnce(permit2State(100, 4_000_000_000))

        const { result } = setup(pancakeQuote(), {
            onApprovalConfirmed: confirmed,
            onDiagnostic: diagnostic,
        })

        await act(async () => {
            await expect(result.current.prepareSwapApproval()).resolves.toBe(true)
        })
        expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
        expect(mocks.sendTransaction.mock.calls[0][0].to).toBe(permit2)
        expect(mocks.readContract).toHaveBeenCalledTimes(3)
        expect(confirmed).toHaveBeenCalledTimes(1)
        expect(result.current.getLastPreparationResult()).toEqual({
            approvalReady: true,
            approvalTransactionSubmitted: true,
        })
        expect(diagnostic.mock.calls.map(([event]) => event)).toEqual(
            expect.arrayContaining([
                'approval.erc20.read.result',
                'approval.permit2.read.start',
                'approval.permit2.read.result',
                'approval.permit2.renewal.required',
                'approval.permit2.send.start',
                'approval.permit2.wallet-prompt.requested',
                'approval.permit2.transaction.submitted',
                'approval.permit2.receipt.waiting',
                'approval.permit2.receipt.confirmed',
                'approval.permit2.reread.start',
                'approval.permit2.reread.result',
            ]),
        )
    })

    it('confirms and re-reads ERC-20 approval before renewing Permit2', async () => {
        const diagnostic = vi.fn()
        mocks.readContract
            .mockResolvedValueOnce(0n)
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(permit2State(0, 0))
            .mockResolvedValueOnce(permit2State(100, 4_000_000_000))
        mocks.sendTransaction
            .mockResolvedValueOnce(`0x${'11'.repeat(32)}`)
            .mockResolvedValueOnce(`0x${'22'.repeat(32)}`)

        const { result } = setup(pancakeQuote(), { onDiagnostic: diagnostic })

        await act(async () => {
            await expect(result.current.prepareSwapApproval()).resolves.toBe(true)
        })
        expect(mocks.sendTransaction).toHaveBeenCalledTimes(2)
        expect(mocks.sendTransaction.mock.calls.map(([transaction]) => transaction.to))
            .toEqual([token, permit2])
        expect(mocks.waitForReceipt).toHaveBeenCalledTimes(2)
        expect(mocks.readContract).toHaveBeenCalledTimes(4)
        const events = diagnostic.mock.calls.map(([event]) => event)
        expect(events.indexOf('approval.erc20.receipt.confirmed')).toBeLessThan(
            events.indexOf('approval.erc20.reread.result'),
        )
        expect(events.indexOf('approval.erc20.reread.result')).toBeLessThan(
            events.indexOf('approval.permit2.read.start'),
        )
        expect(events.indexOf('approval.permit2.receipt.confirmed')).toBeLessThan(
            events.indexOf('approval.permit2.reread.result'),
        )
        expect(result.current.getLastPreparationResult()).toEqual({
            approvalReady: true,
            approvalTransactionSubmitted: true,
        })
    })

    it('does not become ready after a failed Permit2 approval receipt', async () => {
        mocks.readContract
            .mockResolvedValueOnce(100n)
            .mockResolvedValueOnce(permit2State(0, 0))
        mocks.waitForReceipt.mockResolvedValueOnce({ status: 'reverted' })

        const { result } = setup(pancakeQuote())

        await expect(result.current.prepareSwapApproval()).rejects.toThrow(
            'Permit2 approval transaction failed',
        )
        expect(result.current.getLastPreparationResult()).toEqual({
            approvalReady: false,
            approvalTransactionSubmitted: false,
        })
    })

    it('cannot become broadcast-ready before both permission layers are valid', async () => {
        mocks.readContract
            .mockResolvedValueOnce(0n)
            .mockResolvedValueOnce(0n)

        const { result } = setup(pancakeQuote())

        await act(async () => {
            await expect(result.current.prepareSwapApproval()).resolves.toBe(false)
        })
        expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
        expect(mocks.sendTransaction.mock.calls[0][0].to).toBe(token)
    })

    it('deduplicates concurrent approval preparation', async () => {
        let resolveRead
        mocks.readContract.mockReturnValueOnce(new Promise((resolve) => {
            resolveRead = () => resolve(100n)
        })).mockResolvedValueOnce(permit2State(100, 4_000_000_000))

        const { result } = setup(pancakeQuote())
        const first = result.current.prepareSwapApproval()
        const second = result.current.prepareSwapApproval()
        resolveRead()

        await act(async () => {
            await expect(Promise.all([first, second])).resolves.toEqual([true, true])
        })
        expect(mocks.readContract).toHaveBeenCalledTimes(2)
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })
})
