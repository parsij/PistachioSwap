import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
    createCrossChainAuthService,
    crossChainAuthInternals,
} from '../src/cross-chain/auth.js'

const account = privateKeyToAccount(
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
)

describe('cross-chain wallet authentication', () => {
    it('verifies a chain-bound EIP-191 challenge and authenticates a hashed bearer token', async () => {
        const auth = createCrossChainAuthService()
        const challenge = await auth.createChallenge({
            walletAddress: account.address,
            chainId: 8453,
            domain: 'swap.example',
        })

        expect(challenge.message).toContain('Source Chain ID: 8453')
        expect(challenge.message).toContain('Domain: swap.example')
        const signature = await account.signMessage({ message: challenge.message })
        const verified = await auth.verifyChallenge({
            challengeId: challenge.challengeId,
            signature,
            domain: 'swap.example',
        })
        const session = await auth.authenticate(`Bearer ${verified.sessionToken}`)

        expect(session).toMatchObject({
            walletAddress: account.address.toLowerCase(),
            chainId: 8453,
        })
        expect(crossChainAuthInternals.secretHash(verified.sessionToken))
            .not.toBe(verified.sessionToken)
        await expect(auth.verifyChallenge({
            challengeId: challenge.challengeId,
            signature,
            domain: 'swap.example',
        })).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_EXPIRED' })
    })

    it('binds verification to the request domain and supports revocation', async () => {
        const auth = createCrossChainAuthService()
        const challenge = await auth.createChallenge({
            walletAddress: account.address,
            chainId: 1,
            domain: 'swap.example',
        })
        const signature = await account.signMessage({ message: challenge.message })

        await expect(auth.verifyChallenge({
            challengeId: challenge.challengeId,
            signature,
            domain: 'attacker.example',
        })).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_NOT_FOUND' })

        const verified = await auth.verifyChallenge({
            challengeId: challenge.challengeId,
            signature,
            domain: 'swap.example',
        })
        const authorization = `Bearer ${verified.sessionToken}`
        await auth.revoke(authorization)
        await expect(auth.authenticate(authorization))
            .rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' })
    })
})
