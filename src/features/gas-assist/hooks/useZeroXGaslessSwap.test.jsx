// @vitest-environment jsdom

import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { getAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    signTypedData: vi.fn(),
    createQuote: vi.fn(),
    submit: vi.fn(),
    status: vi.fn(),
}))

vi.mock('wagmi', () => ({ useWalletClient: () => ({ data: { signTypedData: mocks.signTypedData } }) }))
vi.mock('../services/gasAssist.js', async () => {
    const actual = await vi.importActual('../services/gasAssist.js')
    return {
        ...actual,
        createGaslessQuote: mocks.createQuote,
        submitGaslessQuote: mocks.submit,
        fetchGaslessStatus: mocks.status,
        signZeroXTypedData: (_client, _wallet, eip712) => mocks.signTypedData(eip712),
    }
})

import { useZeroXGaslessSwap } from './useZeroXGaslessSwap.js'

const baseQuote = {
    quoteId: '00000000-0000-4000-8000-000000000001',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    approval: null,
    trade: { eip712: { primaryType: 'Trade' } },
}

function setup({
    quoteEnabled = true,
    strict = false,
    sellToken = { address: '0x0000000000000000000000000000000000000002', decimals: 18, isNative: false },
    buyToken = { address: '0x0000000000000000000000000000000000000003', decimals: 6, isNative: false },
    onConfirmed = vi.fn(),
} = {}) {
    return renderHook(() => useZeroXGaslessSwap({
        quoteEndpoint: 'http://localhost:3001/v1/quote',
        walletAddress: '0x0000000000000000000000000000000000000001',
        sellToken,
        buyToken,
        sellAmount: '1000000',
        slippageBps: 50,
        config: { enabled: true, mode: 'zero-x-gasless', statusPollIntervalMs: 3000 },
        quoteEnabled,
        onConfirmed,
    }), strict ? { wrapper: StrictMode } : undefined)
}

describe('useZeroXGaslessSwap', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.createQuote.mockResolvedValue(baseQuote)
        mocks.submit.mockResolvedValue({ tradeHash: `0x${'aa'.repeat(32)}` })
    })
    afterEach(() => vi.clearAllTimers())

    it('does not request a firm quote until quote mode is enabled', async () => {
        const { result } = setup({ quoteEnabled: false })
        expect(result.current.quoteStatus).toBe('idle')
        await new Promise((resolve) => window.setTimeout(resolve, 300))
        expect(mocks.createQuote).not.toHaveBeenCalled()
    })

    it('deduplicates the firm quote under React Strict Mode', async () => {
        const { result } = setup({ strict: true })
        await waitFor(() => expect(result.current.quoteStatus).toBe('success'))
        expect(mocks.createQuote).toHaveBeenCalledOnce()
    })

    it('sends checksummed XAUT and the selected output to the backend unchanged', async () => {
        const xautAddress = getAddress('0x68749665ff8d2d112fa859aa293f07a622782f38')
        const selectedBuyAddress = '0x0000000000000000000000000000000000000015'
        const { result } = setup({
            sellToken: { address: xautAddress, symbol: 'XAUT', decimals: 18, isNative: false },
            buyToken: { address: selectedBuyAddress, symbol: 'USDC', decimals: 18, isNative: false },
        })
        await waitFor(() => expect(result.current.quoteStatus).toBe('success'))
        expect(mocks.createQuote).toHaveBeenCalledWith(
            'http://localhost:3001/v1/quote',
            expect.objectContaining({ sellToken: xautAddress, buyToken: selectedBuyAddress }),
            expect.any(AbortSignal),
        )
    })

    it('uses one signature when allowance already exists', async () => {
        mocks.signTypedData.mockResolvedValue(`0x${'11'.repeat(65)}`)
        const { result } = setup()
        await waitFor(() => expect(result.current.available).toBe(true))
        await waitFor(() => expect(result.current.quoteStatus).toBe('success'))
        expect(mocks.createQuote).toHaveBeenCalledWith(
            'http://localhost:3001/v1/quote',
            expect.objectContaining({
                sellToken: '0x0000000000000000000000000000000000000002',
                buyToken: '0x0000000000000000000000000000000000000003',
            }),
            expect.any(AbortSignal),
        )
        await act(async () => result.current.open())
        await waitFor(() => expect(result.current.dialog.state).toBe('ready'))
        expect(mocks.signTypedData).not.toHaveBeenCalled()
        await act(() => result.current.confirm())
        expect(mocks.signTypedData).toHaveBeenCalledTimes(1)
        expect(mocks.submit).toHaveBeenCalledOnce()
    })

    it('submits nothing when approval is signed and trade signature is rejected', async () => {
        mocks.createQuote.mockResolvedValue({
            ...baseQuote,
            approval: { eip712: { primaryType: 'Permit' } },
        })
        mocks.signTypedData
            .mockResolvedValueOnce(`0x${'11'.repeat(65)}`)
            .mockRejectedValueOnce(Object.assign(new Error('rejected'), { code: 4001 }))
        const { result } = setup()
        await waitFor(() => expect(result.current.available).toBe(true))
        await waitFor(() => expect(result.current.quoteStatus).toBe('success'))
        await act(async () => result.current.open())
        await waitFor(() => expect(result.current.dialog.state).toBe('ready'))
        await act(() => result.current.confirm())
        expect(mocks.signTypedData).toHaveBeenCalledTimes(2)
        expect(mocks.submit).not.toHaveBeenCalled()
        expect(result.current.dialog.state).toBe('cancelled')
    })

    it('continues polling through unchanged pending status and transient errors', async () => {
        vi.useFakeTimers()
        const onConfirmed = vi.fn()
        mocks.signTypedData.mockResolvedValue(`0x${'11'.repeat(65)}`)
        mocks.status
            .mockResolvedValueOnce({ status: 'pending', transactionHash: null })
            .mockRejectedValueOnce(new Error('temporary status failure'))
            .mockResolvedValueOnce({ status: 'confirmed', transactionHash: `0x${'bb'.repeat(32)}` })

        const { result } = setup({ onConfirmed })
        await act(() => vi.advanceTimersByTimeAsync(250))
        expect(result.current.quoteStatus).toBe('success')
        await act(() => result.current.open())
        await act(() => result.current.confirm())

        await act(() => vi.advanceTimersByTimeAsync(3_000))
        await act(() => vi.advanceTimersByTimeAsync(3_000))
        await act(() => vi.advanceTimersByTimeAsync(3_000))

        expect(mocks.status).toHaveBeenCalledTimes(3)
        expect(mocks.submit).toHaveBeenCalledTimes(1)
        expect(result.current.dialog.state).toBe('confirmed')
        expect(onConfirmed).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })
})
