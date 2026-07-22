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
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
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

function preparedPackage(overrides = {}) {
    return {
        orderId: 'order-1',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        transactions,
        ...overrides,
    }
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
            transport: 'pistachio-local',
            capability,
            walletClient: { request },
            preparedPackage: preparedPackage(),
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage,
        })
        expect(request).toHaveBeenCalledTimes(3)
        expect(submitSignedPackage).toHaveBeenCalledTimes(1)
        expect(result.map((value) => value.action)).toEqual([
            'fee-payment-transfer',
            'token-approval',
            'normal-swap',
        ])
    })

    it('never submits a partial package', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce('0xaaaa')
            .mockRejectedValueOnce(new Error('rejected'))
        const submitSignedPackage = vi.fn()
        await expect(signPreparedSponsoredPackage({
            transport: 'pistachio-local',
            capability,
            walletClient: { request },
            preparedPackage: preparedPackage(),
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage,
        })).rejects.toThrow('rejected')
        expect(submitSignedPackage).not.toHaveBeenCalled()
    })

    it('rejects duplicate intent IDs before prompting the wallet', async () => {
        const request = vi.fn()
        const duplicate = transactions.map((item, index) => ({
            ...item,
            intentId: index === 2 ? transactions[1].intentId : item.intentId,
        }))

        await expect(signPreparedSponsoredPackage({
            transport: 'pistachio-local',
            capability,
            walletClient: { request },
            preparedPackage: preparedPackage({ transactions: duplicate }),
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage: vi.fn(),
        })).rejects.toMatchObject({ code: 'SPONSORSHIP_PACKAGE_INVALID' })
        expect(request).not.toHaveBeenCalled()
    })

    it('rejects non-consecutive nonces before prompting the wallet', async () => {
        const request = vi.fn()
        const invalidNonces = transactions.map((item, index) => ({
            ...item,
            transaction: {
                ...item.transaction,
                nonce: index === 2 ? '0x5' : item.transaction.nonce,
            },
        }))

        await expect(signPreparedSponsoredPackage({
            transport: 'pistachio-local',
            capability,
            walletClient: { request },
            preparedPackage: preparedPackage({ transactions: invalidNonces }),
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage: vi.fn(),
        })).rejects.toMatchObject({ code: 'SPONSORSHIP_PACKAGE_NONCE_MISMATCH' })
        expect(request).not.toHaveBeenCalled()
    })
})
