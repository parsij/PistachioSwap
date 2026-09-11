import { Signature } from 'ethers'
import { getAddress, parseTransaction, toHex } from 'viem'
import { hashAuthorization, recoverAuthorizationAddress } from 'viem/utils'

const PARTICLE_SIMPLE_7702_IMPLEMENTATION = '0xe6cae83bde06e4c305530e199d7217f42808555b'
const HASH = /^0x[0-9a-f]{64}$/iu

function particleSigningError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function authorizationRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'eip7702Auth') {
        throw particleSigningError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned an invalid EIP-7702 authorization request.')
    }
    const data = value.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw particleSigningError('PARTICLE_AUTHORIZATION_INVALID', 'Particle omitted the EIP-7702 authorization data.')
    }
    let address
    try {
        address = getAddress(String(data.address ?? ''))
    } catch {
        throw particleSigningError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned an invalid delegation address.')
    }
    if (address.toLowerCase() !== PARTICLE_SIMPLE_7702_IMPLEMENTATION) {
        throw particleSigningError('PARTICLE_DELEGATE_NOT_ALLOWED', 'Particle requested an untrusted EIP-7702 delegate.')
    }
    const chainId = Number(data.chainId)
    const nonce = Number(data.nonce)
    if (chainId !== 56 || !Number.isSafeInteger(nonce) || nonce < 0) {
        throw particleSigningError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned invalid BNB Chain authorization parameters.')
    }
    const rawPayload = String(value.rawPayload ?? '').toLowerCase()
    if (!HASH.test(rawPayload)) {
        throw particleSigningError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned an invalid authorization payload.')
    }
    const expected = hashAuthorization({
        contractAddress: address,
        chainId,
        nonce,
    }).toLowerCase()
    if (rawPayload !== expected) {
        throw particleSigningError('PARTICLE_AUTHORIZATION_HASH_MISMATCH', 'Particle authorization data does not match the payload to sign.')
    }
    return { address, chainId, nonce, rawPayload }
}

export const methods = {
    async signParticleAuthorization(request) {
        const authorization = authorizationRequest(request)
        await this.ensureUnlockedForSigning()
        const context = this.captureSigningContext(56)
        await this.reviewQueue.request({
            walletAddress: context.address,
            chainId: 56,
            action: 'Enable Particle Gas Assist',
            payload: {
                purpose: 'Authorize the reviewed Simple7702 smart-account implementation for BNB Chain Gas Assist. This does not reveal your private key or transfer tokens by itself.',
                delegate: authorization.address,
                authorizationNonce: authorization.nonce,
            },
        })
        this.assertSigningContext(context)

        // The worker owns the EOA key. This throwaway Type-4 envelope exists only
        // to obtain the exact authorization signature. It is never broadcast.
        let signedEnvelope = null
        try {
            signedEnvelope = (
                await this.client.request('signTransaction', {
                    mode: 'megafuel',
                    transaction: {
                        chainId: 56,
                        type: 4,
                        from: context.address,
                        to: context.address,
                        nonce: 0,
                        gasLimit: 21_000n,
                        maxFeePerGas: 0n,
                        maxPriorityFeePerGas: 0n,
                        value: 0n,
                        data: '0x',
                        authorizationList: [{
                            chainId: 56,
                            address: authorization.address,
                            nonce: authorization.nonce,
                        }],
                    },
                })
            ).signedTransaction
            this.assertSigningContext(context)

            const parsed = parseTransaction(signedEnvelope)
            const signed = parsed.authorizationList?.[0]
            if (!signed ||
                getAddress(signed.address) !== authorization.address ||
                Number(signed.chainId) !== 56 ||
                Number(signed.nonce) !== authorization.nonce ||
                BigInt(signed.r ?? 0) === 0n ||
                BigInt(signed.s ?? 0) === 0n) {
                throw particleSigningError('PARTICLE_AUTHORIZATION_SIGNING_FAILED', 'Pistachio Wallet produced an invalid EIP-7702 authorization.')
            }
            const recovered = await recoverAuthorizationAddress({ authorization: signed })
            if (getAddress(recovered) !== getAddress(context.address)) {
                throw particleSigningError('WALLET_SIGNER_MISMATCH', 'The EIP-7702 authorization signer changed.')
            }
            const yParity = Number(signed.yParity ?? (signed.v == null ? -1 : BigInt(signed.v) - 27n))
            if (yParity !== 0 && yParity !== 1) {
                throw particleSigningError('PARTICLE_AUTHORIZATION_SIGNING_FAILED', 'Pistachio Wallet returned invalid authorization parity.')
            }
            await this.recordActivity()
            return Signature.from({
                r: toHex(BigInt(signed.r), { size: 32 }),
                s: toHex(BigInt(signed.s), { size: 32 }),
                yParity,
            }).serialized
        } finally {
            signedEnvelope = null
        }
    },
}

export const particleSigningInternals = {
    PARTICLE_SIMPLE_7702_IMPLEMENTATION,
    authorizationRequest,
}
