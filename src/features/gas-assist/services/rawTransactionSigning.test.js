import { readFile } from 'node:fs/promises'

import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import {
    detectRawTransactionSigning,
    signPreparedSponsoredTransaction,
    signRawSponsoredTransaction,
} from './rawTransactionSigning.js'

const localWallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const preparedTransaction = {
    type: '0x0',
    chainId: '0x38',
    from: localWallet.address,
    to: '0x2222222222222222222222222222222222222222',
    nonce: '0x1',
    gas: '0x5208',
    gasPrice: '0x0',
    value: '0x0',
    data: '0x',
}

describe('private sponsored wallet compatibility', () => {
    it('supports only Pistachio local wallet using eth_signTransaction', async () => {
        const request = vi.fn().mockResolvedValue('0x1234')
        const walletClient = { request }
        const capability = detectRawTransactionSigning({
            connector: { id: 'pistachio-local' },
            walletClient,
        })
        expect(capability).toMatchObject({
            rawTransactionSigningSupported: true,
            method: 'eth_signTransaction',
            transport: 'pistachio-local',
            status: 'verified',
        })
        await expect(signRawSponsoredTransaction({ capability, walletClient, transaction: { to: '0x1' } }))
            .resolves.toBe('0x1234')
        expect(request).toHaveBeenCalledWith({
            method: 'eth_signTransaction',
            params: [{ to: '0x1' }],
        })
    })

    it.each(['pistachio-embedded', 'injected', 'walletConnect', 'io.metamask', 'coinbaseWallet', 'eip6963'])(
        'fails closed for external connector %s',
        (id) => {
            expect(detectRawTransactionSigning({ connector: { id }, walletClient: { request() {} } })).toMatchObject({
                rawTransactionSigningSupported: false,
                method: null,
                transport: null,
                status: 'unsupported',
                reasonCode: 'PISTACHIO_WALLET_REQUIRED',
            })
        },
    )

    it('does not substitute personal_sign, eth_sign, or typed-data signing', async () => {
        const request = vi.fn()
        await expect(signRawSponsoredTransaction({
            capability: { rawTransactionSigningSupported: false, method: null },
            walletClient: { request },
            transaction: {},
        })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_REQUIRED' })
        expect(request).not.toHaveBeenCalled()
    })

    it('passes a locally verified raw transaction directly to the existing submission callback', async () => {
        const raw = await localWallet.signTransaction({
            chainId: 56,
            type: 'legacy',
            nonce: 1,
            gas: 21_000n,
            gasPrice: 0n,
            to: preparedTransaction.to,
            value: 0n,
            data: '0x',
        })
        const walletClient = { request: vi.fn().mockResolvedValue(raw) }
        const capability = detectRawTransactionSigning({ connector: { id: 'pistachio-local' }, walletClient })
        const submitSignedTransaction = vi.fn().mockResolvedValue({ status: 'submitted' })
        await expect(signPreparedSponsoredTransaction({
            transport: 'pistachio-local',
            capability,
            walletClient,
            preparedTransaction,
            authenticatedWalletAddress: localWallet.address,
            submitSignedTransaction,
        })).resolves.toEqual({ status: 'submitted' })
        expect(submitSignedTransaction).toHaveBeenCalledWith(raw)
    })

    it('never submits when local raw-transaction validation fails', async () => {
        const walletClient = { request: vi.fn().mockResolvedValue('0x1234') }
        const capability = detectRawTransactionSigning({ connector: { id: 'pistachio-local' }, walletClient })
        const submitSignedTransaction = vi.fn()
        await expect(signPreparedSponsoredTransaction({
            transport: 'pistachio-local',
            capability,
            walletClient,
            preparedTransaction,
            authenticatedWalletAddress: localWallet.address,
            submitSignedTransaction,
        })).rejects.toMatchObject({ code: 'WALLET_RAW_TRANSACTION_MALFORMED' })
        expect(submitSignedTransaction).not.toHaveBeenCalled()
    })

    it('rejects every non-Pistachio transport before wallet invocation', async () => {
        const request = vi.fn()
        const submitSignedTransaction = vi.fn()
        await expect(signPreparedSponsoredTransaction({
            transport: 'metamask-connect-multichain',
            capability: { rawTransactionSigningSupported: true, method: 'eth_signTransaction' },
            walletClient: { request },
            preparedTransaction,
            authenticatedWalletAddress: localWallet.address,
            submitSignedTransaction,
        })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_REQUIRED' })
        expect(request).not.toHaveBeenCalled()
        expect(submitSignedTransaction).not.toHaveBeenCalled()
    })

    it('does not persist raw transactions and contains no frontend MegaFuel credentials', async () => {
        const sources = await Promise.all([
            readFile(new URL('../hooks/usePrepaidSponsorship.js', import.meta.url), 'utf8'),
            readFile(new URL('./prepaidSponsorship.js', import.meta.url), 'utf8'),
            readFile(new URL('./rawTransactionSigning.js', import.meta.url), 'utf8'),
        ])
        const joined = sources.join('\n')
        expect(joined).not.toMatch(/localStorage|sessionStorage/)
        expect(joined).not.toMatch(/MEGAFUEL_API_KEY|MEGAFUEL_PRIVATE_POLICY_UUID|x-megafuel-policy-uuid/)
        expect(joined).not.toMatch(/console\.(?:log|debug|info|warn|error).*signedRawTransaction/)
    })
})
