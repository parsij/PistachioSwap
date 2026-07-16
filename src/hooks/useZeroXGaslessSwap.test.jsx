// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    signTypedData: vi.fn(),
    fetchConfig: vi.fn(),
    createQuote: vi.fn(),
    submit: vi.fn(),
    status: vi.fn(),
}))

vi.mock('wagmi', () => ({ useWalletClient: () => ({ data: { signTypedData: mocks.signTypedData } }) }))
vi.mock('../services/gasAssist.js', async () => {
    const actual = await vi.importActual('../services/gasAssist.js')
    return {
        ...actual,
        fetchGasAssistConfig: mocks.fetchConfig,
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

function setup() {
    return renderHook(() => useZeroXGaslessSwap({
        quoteEndpoint: 'http://localhost:3001/v1/quote',
        walletAddress: '0x0000000000000000000000000000000000000001',
        sellToken: { address: '0x0000000000000000000000000000000000000002', isNative: false },
        sellAmount: '1000000',
        slippageBps: 50,
        enabled: true,
        onConfirmed: vi.fn(),
    }))
}

describe('useZeroXGaslessSwap', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.fetchConfig.mockResolvedValue({ enabled: true, statusPollIntervalMs: 3000 })
        mocks.createQuote.mockResolvedValue(baseQuote)
        mocks.submit.mockResolvedValue({ tradeHash: `0x${'aa'.repeat(32)}` })
    })

    it('uses one signature when allowance already exists', async () => {
        mocks.signTypedData.mockResolvedValue(`0x${'11'.repeat(65)}`)
        const { result } = setup()
        await waitFor(() => expect(result.current.available).toBe(true))
        await act(() => result.current.open())
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
        await act(() => result.current.open())
        await act(() => result.current.confirm())
        expect(mocks.signTypedData).toHaveBeenCalledTimes(2)
        expect(mocks.submit).not.toHaveBeenCalled()
        expect(result.current.dialog.state).toBe('cancelled')
    })
})
