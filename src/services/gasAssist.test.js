import { describe, expect, it, vi } from 'vitest'

import {
    exactGaslessRequest,
    normalizeZeroXTypedData,
    signZeroXTypedData,
    submitGaslessQuote,
} from './gasAssist.js'

const typedData = {
    types: {
        EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
        Permit: [{ name: 'owner', type: 'address' }],
    },
    domain: { chainId: 56 },
    primaryType: 'Permit',
    message: { owner: '0x0000000000000000000000000000000000000001' },
}

describe('0x Gasless frontend boundaries', () => {
    it('allows only backend-supported quote fields', () => {
        const request = exactGaslessRequest({
            chainId: 56,
            walletAddress: '0x1',
            sellToken: '0x2',
            buyToken: '0x3',
            sellAmount: '100',
            slippageBps: 50,
        }, true)
        expect(Object.isFrozen(request)).toBe(true)
        expect(request.buyToken).toBe('0x3')
        expect(() => exactGaslessRequest({ ...request, swapFeeBps: 500 }, true)).toThrow(/unsupported/i)
    })

    it('removes only EIP712Domain for Viem without mutating provider data', () => {
        const normalized = normalizeZeroXTypedData(typedData)
        expect(normalized.types.EIP712Domain).toBeUndefined()
        expect(typedData.types.EIP712Domain).toHaveLength(1)
    })

    it('signs the exact normalized typed data', async () => {
        const walletClient = { signTypedData: vi.fn().mockResolvedValue('0xsig') }
        await expect(signZeroXTypedData(walletClient, typedData.message.owner, typedData)).resolves.toBe('0xsig')
        expect(walletClient.signTypedData).toHaveBeenCalledWith({
            account: typedData.message.owner,
            ...normalizeZeroXTypedData(typedData),
        })
    })

    it('submits only quote ID and signatures', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ tradeHash: '0xhash' }),
        })
        await submitGaslessQuote('http://localhost:3001/v1/quote', {
            quoteId: 'id', approvalSignature: null, tradeSignature: '0xsig',
        })
        const body = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(body).toEqual({ quoteId: 'id', approvalSignature: null, tradeSignature: '0xsig' })
        expect(() => submitGaslessQuote('http://localhost:3001/v1/quote', {
            quoteId: 'id', tradeSignature: '0xsig', trade: typedData,
        })).toThrow(/unsupported/i)
        fetchMock.mockRestore()
    })
})
