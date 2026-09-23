import { Signature } from 'ethers'
import { getAddress, isAddress, parseTransaction, toHex } from 'viem'
import { hashAuthorization, recoverAuthorizationAddress } from 'viem/utils'

const CHAIN_ID = 56
const ADDRESS = /^0x[0-9a-f]{40}$/iu
const HASH = /^0x[0-9a-f]{64}$/iu

function deny(code, message) {
    const error = new Error(message)
    error.code = code
    throw error
}

function trustedDelegate() {
    if (import.meta.env?.VITE_SELF_HOSTED_PAYMASTER_ENABLED !== 'true') {
        deny('SELF_HOSTED_PAYMASTER_DISABLED', 'Self-hosted Gas Assist is disabled in this build.')
    }
    const candidate = String(import.meta.env?.VITE_SIMPLE_7702_ACCOUNT_ADDRESS ?? '')
    if (!isAddress(candidate) || !ADDRESS.test(candidate)) {
        deny('PAYMASTER_DELEGATE_NOT_CONFIGURED', 'The trusted self-hosted EIP-7702 delegate is not configured.')
    }
    return getAddress(candidate)
}

export const selfHostedAuthorizationMethods = {
    async signSelfHostedAuthorization(request) {
        const trusted = trustedDelegate()
        if (!request || request.type !== 'eip7702Auth' || !request.data || typeof request.data !== 'object') {
            deny('PAYMASTER_AUTHORIZATION_INVALID', 'A single self-hosted EIP-7702 authorization is required.')
        }
        const { data } = request
        let delegate
        try {
            delegate = getAddress(String(data.address ?? ''))
        } catch {
            deny('PAYMASTER_AUTHORIZATION_INVALID', 'The EIP-7702 delegate address is invalid.')
        }
        const nonce = Number(data.nonce)
        if (delegate !== trusted || Number(data.chainId) !== CHAIN_ID ||
            !Number.isSafeInteger(nonce) || nonce < 0) {
            deny('PAYMASTER_AUTHORIZATION_INVALID', 'The EIP-7702 authorization differs from the BNB Chain trusted delegation.')
        }
        const digest = hashAuthorization({ contractAddress: trusted, chainId: CHAIN_ID, nonce })
        if (!HASH.test(String(request.rawPayload ?? '')) ||
            request.rawPayload.toLowerCase() !== digest.toLowerCase()) {
            deny('PAYMASTER_AUTHORIZATION_HASH_MISMATCH', 'The authorization hash does not match its trusted delegate and nonce.')
        }

        await this.ensureUnlockedForSigning()
        const context = this.captureSigningContext(CHAIN_ID)
        await this.reviewQueue.request({
            walletAddress: context.address,
            chainId: CHAIN_ID,
            action: 'Enable self-hosted Gas Assist',
            payload: {
                purpose: 'Delegate this existing EOA to the trusted ERC-4337 Simple7702Account for BNB Chain. This does not transfer tokens.',
                delegate: trusted,
                authorizationScope: 'BNB Chain (56)',
                authorizationNonce: nonce,
            },
        })
        this.assertSigningContext(context)

        // Only the authorization tuple is used. This unsigned-cost throwaway
        // Type-4 envelope is never broadcast or sent to Pistachio's backend.
        let envelope = null
        try {
            envelope = (await this.client.request('signTransaction', {
                mode: 'megafuel',
                transaction: {
                    chainId: CHAIN_ID,
                    type: 4,
                    from: context.address,
                    to: context.address,
                    nonce: 0,
                    gasLimit: 21_000n,
                    maxFeePerGas: 0n,
                    maxPriorityFeePerGas: 0n,
                    value: 0n,
                    data: '0x',
                    authorizationList: [{ chainId: CHAIN_ID, address: trusted, nonce }],
                },
            })).signedTransaction
            this.assertSigningContext(context)
            const parsed = parseTransaction(envelope)
            const authorization = parsed.authorizationList?.[0]
            if (!authorization || parsed.authorizationList?.length !== 1 ||
                getAddress(authorization.address) !== trusted ||
                Number(authorization.chainId) !== CHAIN_ID ||
                Number(authorization.nonce) !== nonce ||
                BigInt(authorization.r ?? 0) === 0n ||
                BigInt(authorization.s ?? 0) === 0n) {
                deny('PAYMASTER_AUTHORIZATION_INVALID', 'The wallet returned an invalid EIP-7702 authorization.')
            }
            const recovered = await recoverAuthorizationAddress({ authorization })
            if (getAddress(recovered) !== getAddress(context.address)) {
                deny('PISTACHIO_ACCOUNT_MISMATCH', 'The EIP-7702 authorization signer does not match this wallet.')
            }
            const yParity = Number(authorization.yParity ?? (authorization.v == null ? -1 : BigInt(authorization.v) - 27n))
            if (![0, 1].includes(yParity)) {
                deny('PAYMASTER_AUTHORIZATION_INVALID', 'The wallet returned invalid EIP-7702 authorization parity.')
            }
            await this.recordActivity()
            return Signature.from({
                r: toHex(BigInt(authorization.r), { size: 32 }),
                s: toHex(BigInt(authorization.s), { size: 32 }),
                yParity,
            }).serialized
        } finally {
            envelope = null
        }
    },
}
