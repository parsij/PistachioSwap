import { describe, expect, it } from 'vitest'

import { rawSigningInternals } from './particleTransactionSigning.js'

const DELEGATE = '0x13E00E089F81aD9F36B655C9E9A07C6BF1489A5A'
const USER_OP_HASH = `0x${'22'.repeat(32)}`

describe('Particle EIP-7702 authorization scope', () => {
    it('narrows a chain-agnostic Particle authorization to BNB Chain before signing', () => {
        const result = rawSigningInternals.normalizeParticleAuthorization({
            address: DELEGATE,
            chainId: 0,
            nonce: 7,
        })

        expect(result).toEqual({
            sourceChainId: 0,
            authorization: {
                address: DELEGATE,
                chainId: 56,
                nonce: 7,
            },
        })
    })

    it('keeps a BNB-scoped Particle authorization scoped to BNB Chain', () => {
        const result = rawSigningInternals.normalizeParticleAuthorization({
            address: DELEGATE,
            chainId: 56,
            nonce: 8,
        })

        expect(result.sourceChainId).toBe(56)
        expect(result.authorization).toEqual({
            address: DELEGATE,
            chainId: 56,
            nonce: 8,
        })
    })

    it('rejects an authorization scoped to a different chain', () => {
        let error
        try {
            rawSigningInternals.normalizeParticleAuthorization({
                address: DELEGATE,
                chainId: 1,
                nonce: 9,
            })
        } catch (caught) {
            error = caught
        }

        expect(error).toMatchObject({
            code: 'PARTICLE_AUTHORIZATION_INVALID',
            details: {
                stage: 'particle.authorization',
                reason: 'invalid-chain-or-nonce',
                sourceChainId: 1,
            },
        })
    })

    it('passes the same narrowed tuple forward with the Particle transaction', () => {
        const transaction = {
            rootHash: USER_OP_HASH,
            userOps: [{
                userOpHash: USER_OP_HASH,
                eip7702Auth: {
                    address: DELEGATE,
                    chainId: 0,
                    nonce: 10,
                },
                eip7702Delegated: false,
            }],
        }

        const normalized = rawSigningInternals.normalizeParticleTransactionAuthorizations(transaction)

        expect(normalized).not.toBe(transaction)
        expect(transaction.userOps[0].eip7702Auth.chainId).toBe(0)
        expect(normalized.userOps[0].eip7702Auth).toEqual({
            address: DELEGATE,
            chainId: 56,
            nonce: 10,
        })
        expect(normalized.userOps[0].userOpHash).toBe(USER_OP_HASH)
        expect(normalized.rootHash).toBe(USER_OP_HASH)
    })
})
