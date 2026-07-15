import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getWalletTokens: vi.fn() }))

vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({
    getWalletTokens: mocks.getWalletTokens,
    WALLET_TOKEN_CLASSIFICATION_VERSION: 3,
}))

import { createApp } from '../src/app.js'

const wallet = '0x1000000000000000000000000000000000000042'
const token = '0x0000000000000000000000000000000000000011'

describe('wallet-token route', () => {
    afterEach(() => vi.clearAllMocks())

    it('returns normalized security fields without provider secrets', async () => {
        mocks.getWalletTokens.mockResolvedValue([{
            classificationVersion: 3,
            id: `56:${token}`,
            chainId: 56,
            address: token,
            rawBalance: '1',
            balance: '1',
            recognitionStatus: 'unverified',
            recognitionReasons: [],
            spamStatus: 'unknown',
            possibleSpam: null,
            verifiedContract: null,
            spamReasons: ['moralis-spam-unknown'],
            securityStatus: 'unknown',
            securityScore: null,
            securityReasons: ['security-provider-unavailable'],
            securityProviders: {
                honeypot: {
                    available: false, checkedAt: null, risk: null,
                    riskLevel: null, isHoneypot: null,
                },
                goPlus: { available: false, checkedAt: null, isHoneypot: null },
            },
            visibility: 'unverified',
            visibilityReasons: ['unverified-contract'],
        }])
        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-tokens?chainId=56&address=${wallet}`,
        })
        await app.close()
        expect(response.statusCode).toBe(200)
        expect(response.json().tokens[0]).toMatchObject({
            classificationVersion: 3,
            recognitionStatus: 'unverified',
            spamStatus: 'unknown',
            possibleSpam: null,
            verifiedContract: null,
            visibility: 'unverified',
            securityStatus: 'unknown',
        })
        expect(response.json().classificationVersion).toBe(3)
        expect(response.body).not.toMatch(/api.?key|authorization|access.?token/i)
    })
})
