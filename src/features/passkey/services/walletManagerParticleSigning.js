import { Signature } from 'ethers'
import { getAddress, isAddress, parseTransaction, toHex } from 'viem'
import { hashAuthorization, recoverAuthorizationAddress } from 'viem/utils'

const HASH = /^0x[0-9a-f]{64}$/iu
const PARTICLE_CHAIN_ID = 56
const PARTICLE_EIP7702_DELEGATES = new Set(
    String(import.meta.env?.VITE_PARTICLE_ALLOWED_EIP7702_DELEGATES ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => isAddress(value) && !/^0x0{40}$/iu.test(value))
        .map((value) => getAddress(value)),
)

function particleSigningError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function authorizationRequest(value) {
    if (!PARTICLE_EIP7702_DELEGATES.size) {
        throw particleSigningError(
            'PARTICLE_DELEGATE_NOT_CONFIGURED',
            'Particle Gas Assist is not configured with a trusted EIP-7702 delegate allowlist.',
        )
    }
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
    if (!PARTICLE_EIP7702_DELEGATES.has(address)) {
        throw particleSigningError('PARTICLE_DELEGATE_NOT_ALLOWED', 'Particle requested an untrusted EIP-7702 delegate.')
    }
    const chainId = Number(data.chainId)
    const nonce = Number(data.nonce)
    if (![0, PARTICLE_CHAIN_ID].includes(chainId) || !Number.isSafeInteger(nonce) || nonce < 0) {
        throw particleSigningError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned invalid EIP-7702 authorization parameters.')
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
        const context = this.captureSigningContext(PARTICLE_CHAIN_ID)
        const chainAgnostic = authorization.chainId === 0
        await this.reviewQueue.request({
            walletAddress: context.address,
            chainId: PARTICLE_CHAIN_ID,
            action: 'Enable Particle Gas Assist',
            payload: {
                purpose: chainAgnostic
                    ? 'Authorize Particle’s allowlisted EIP-7702 account code using the exact chain-agnostic authorization returned by Particle. This does not transfer tokens by itself.'
                    : 'Authorize Particle’s allowlisted BNB Chain EIP-7702 account code for this wallet. This does not transfer tokens by itself.',
                delegate: authorization.address,
                authorizationScope: chainAgnostic ? 'Particle chain-agnostic authorization (chainId 0)' : 'BNB Chain (56)',
                authorizationNonce: authorization.nonce,
            },
        })
        this.assertSigningContext(context)

        // Particle's UserOperation hashes commit to the exact eip7702Auth tuple it
        // returned. The worker therefore signs that tuple byte-for-byte. The outer
        // throwaway Type-4 envelope stays on BNB Chain and is never broadcast.
        let signedEnvelope = null
        try {
            signedEnvelope = (
                await this.client.request('signTransaction', {
                    mode: 'megafuel',
                    transaction: {
                        chainId: PARTICLE_CHAIN_ID,
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
                            chainId: authorization.chainId,
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
                Number(signed.chainId) !== authorization.chainId ||
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
    PARTICLE_CHAIN_ID,
    PARTICLE_EIP7702_DELEGATES,
    authorizationRequest,
}
