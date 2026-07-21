import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./metamaskMultichain.js', () => ({
    normalizePreparedSponsoredTransaction: (transaction) => transaction,
    validateSignedPreparedTransaction: vi.fn(async () => undefined),
}))

import { signPreparedSponsoredPackage } from './rawTransactionSigning.js'

const transactions = [
    'fee-payment-transfer',
    'token-approval',
    'normal-swap',
].map((action, index) => ({
    intentId: `intent-${index}`,
    action,
    transaction: {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        data: '0x1234',
        value: '0x0',
        chainId: '0x38',
        nonce: `0x${index.toString(16)}`,
        gas: '0x5208',
        gasPrice: '0x0',
        type: '0x0',
    },
}))
const capability = {
    rawTransactionSigningSupported: true,
    method: 'eth_signTransaction',
    transport: 'pistachio-local',
}

beforeEach(() => vi.restoreAllMocks())

describe('pre-signed Gas Assist package', () => {
    it('submits only after all three transactions are signed', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce('0xaaaa')
            .mockResolvedValueOnce('0xbbbb')
            .mockResolvedValueOnce('0xcccc')
        const submitSignedPackage = vi.fn(async (values) => values)
        const result = await signPreparedSponsoredPackage({
            transport: 'pistachio-local', capability,
            walletClient: { request }, preparedPackage: { transactions },
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage,
        })
        expect(request).toHaveBeenCalledTimes(3)
        expect(submitSignedPackage).toHaveBeenCalledTimes(1)
        expect(result.map((value) => value.action)).toEqual([
            'fee-payment-transfer','token-approval','normal-swap',
        ])
    })

    it('never submits a partial package', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce('0xaaaa')
            .mockRejectedValueOnce(new Error('rejected'))
        const submitSignedPackage = vi.fn()
        await expect(signPreparedSponsoredPackage({
            transport: 'pistachio-local', capability,
            walletClient: { request }, preparedPackage: { transactions },
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage,
        })).rejects.toThrow('rejected')
        expect(submitSignedPackage).not.toHaveBeenCalled()
    })
})
