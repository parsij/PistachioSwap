import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import {
    detectRawTransactionSigning,
    signRawSponsoredTransaction,
} from './rawTransactionSigning.js'

describe('private sponsored wallet compatibility', () => {
    it('supports only an explicit Pistachio embedded/local connector using eth_signTransaction', async () => {
        const request = vi.fn().mockResolvedValue('0x1234')
        const walletClient = { request }
        const capability = detectRawTransactionSigning({
            connector: { id: 'pistachio-embedded' },
            walletClient,
        })
        expect(capability).toEqual({
            rawTransactionSigningSupported: true,
            method: 'eth_signTransaction',
        })
        await expect(signRawSponsoredTransaction({ capability, walletClient, transaction: { to: '0x1' } }))
            .resolves.toBe('0x1234')
        expect(request).toHaveBeenCalledWith({
            method: 'eth_signTransaction',
            params: [{ to: '0x1' }],
        })
    })

    it.each(['injected', 'walletConnect', 'coinbaseWallet', 'eip6963'])('fails closed for external connector %s', (id) => {
        expect(detectRawTransactionSigning({ connector: { id }, walletClient: { request() {} } })).toEqual({
            rawTransactionSigningSupported: false,
            method: null,
        })
    })

    it('does not substitute personal_sign, eth_sign, or typed-data signing', async () => {
        const request = vi.fn()
        await expect(signRawSponsoredTransaction({
            capability: { rawTransactionSigningSupported: false, method: null },
            walletClient: { request },
            transaction: {},
        })).rejects.toMatchObject({ code: 'WALLET_RAW_TRANSACTION_SIGNING_UNSUPPORTED' })
        expect(request).not.toHaveBeenCalled()
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
