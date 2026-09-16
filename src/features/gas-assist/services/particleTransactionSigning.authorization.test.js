import { describe, expect, it, vi } from 'vitest'
import { hashAuthorization } from 'viem/utils'

import { rawSigningInternals } from './particleTransactionSigning.js'

const DELEGATE = '0x13E00E089F81aD9F36B655C9E9A07C6BF1489A5A'
const USER_OP_HASH = `0x${'22'.repeat(32)}`
const SIGNATURE = `0x${'11'.repeat(65)}`

describe('Particle EIP-7702 authorization scope', () => {
    it('preserves a chain-agnostic Particle authorization exactly', () => {
        const result = rawSigningInternals.normalizeParticleAuthorization({
            address: DELEGATE,
            chainId: 0,
            nonce: 7,
        })

        expect(result).toEqual({
            sourceChainId: 0,
            authorization: {
                address: DELEGATE,
                chainId: 0,
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

    it('rejects an authorization scoped to a different explicit chain', () => {
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

    it('does not mutate Particle userOps after rootHash and userOpHash exist', () => {
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

        const validated = rawSigningInternals.normalizeParticleTransactionAuthorizations(transaction)

        expect(validated).toBe(transaction)
        expect(validated.userOps[0].eip7702Auth).toEqual({
            address: DELEGATE,
            chainId: 0,
            nonce: 10,
        })
        expect(validated.userOps[0].userOpHash).toBe(USER_OP_HASH)
        expect(validated.rootHash).toBe(USER_OP_HASH)
    })

    it('asks Pistachio Wallet to sign the exact Particle chain-0 digest', async () => {
        const request = vi.fn().mockResolvedValue(SIGNATURE)

        await expect(rawSigningInternals.signParticleAuthorization({
            walletClient: { request },
            authorization: {
                address: DELEGATE,
                chainId: 0,
                nonce: 11,
            },
        })).resolves.toBe(SIGNATURE)

        expect(request).toHaveBeenCalledExactlyOnceWith({
            method: 'pistachio_signParticleAuthorization',
            params: [{
                type: 'eip7702Auth',
                rawPayload: hashAuthorization({
                    contractAddress: DELEGATE,
                    chainId: 0,
                    nonce: 11,
                }),
                data: {
                    address: DELEGATE,
                    chainId: 0,
                    nonce: 11,
                },
            }],
        })
    })
})
