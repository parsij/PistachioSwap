import { readFile } from 'node:fs/promises'

import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const particleMocks = vi.hoisted(() => ({
    createUniversalTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
}))

vi.mock('@particle-network/universal-account-sdk', () => ({
    UA_TRANSACTION_STATUS: { FINISHED: 7 },
    UniversalAccount: class {
        createUniversalTransaction(...args) {
            return particleMocks.createUniversalTransaction(...args)
        }
        sendTransaction(...args) {
            return particleMocks.sendTransaction(...args)
        }
        getTransaction(...args) {
            return particleMocks.getTransaction(...args)
        }
    },
}))

import {
    detectRawTransactionSigning,
    signPreparedAtomicSponsoredTransaction,
    signPreparedSponsoredTransaction,
    signRawSponsoredTransaction,
} from './rawTransactionSigning.js'
import { prepaidSponsorshipInternals } from './prepaidSponsorship.js'

const localWallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const SIGNATURE = `0x${'11'.repeat(65)}`
const USER_OP_HASH = `0x${'22'.repeat(32)}`
const PARTICLE_DELEGATE = '0x1111111111111111111111111111111111111111'
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

function directPrepared() {
    return {
        provider: 'particle',
        execution: 'particle-universal-7702-direct',
        stage: 'direct',
        paymentMode: 'sponsored',
        orderId: 'order-1',
        chainId: 56,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        transactions: Array.from({ length: 5 }, (_, index) => ({
            to: `0x${String(index + 10).padStart(40, '0')}`,
            data: index === 3 ? '0x12345678' : '0x',
            value: '0x0',
        })),
    }
}

function configureParticleBrowser() {
    vi.stubEnv('VITE_PARTICLE_PROJECT_ID', 'project-id-public')
    vi.stubEnv('VITE_PARTICLE_CLIENT_KEY', 'client-key-public')
    vi.stubEnv('VITE_PARTICLE_APP_ID', 'app-uuid-public')
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    particleMocks.createUniversalTransaction.mockReset()
    particleMocks.sendTransaction.mockReset()
    particleMocks.getTransaction.mockReset()
    prepaidSponsorshipInternals.clearDirectResults()
})

describe('Gas Assist wallet compatibility', () => {
    it('supports only Pistachio local wallet and exposes the Particle authorization method', async () => {
        const request = vi.fn().mockResolvedValue('0x1234')
        const walletClient = { request }
        const capability = detectRawTransactionSigning({
            connector: { id: 'pistachio-local' },
            walletClient,
        })
        expect(capability).toMatchObject({
            rawTransactionSigningSupported: true,
            method: 'eth_signTransaction',
            atomicMethod: 'pistachio_signParticleAuthorization',
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

    it('does not substitute raw signing for unsupported wallets', async () => {
        const request = vi.fn()
        await expect(signRawSponsoredTransaction({
            capability: { rawTransactionSigningSupported: false, method: null },
            walletClient: { request },
            transaction: {},
        })).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_REQUIRED' })
        expect(request).not.toHaveBeenCalled()
    })

    it('passes a locally verified legacy raw transaction only to its explicit generic callback', async () => {
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

    it('runs backend paymaster approval before any Particle owner or EIP-7702 signature', async () => {
        configureParticleBrowser()
        const request = vi.fn().mockResolvedValue(SIGNATURE)
        const signMessage = vi.fn().mockResolvedValue(SIGNATURE)
        const approvalGate = vi.fn().mockResolvedValue({
            atomicExecution: { paymasterApproval: 'approved' },
        })
        const walletClient = { request, signMessage }
        const capability = detectRawTransactionSigning({ connector: { id: 'pistachio-local' }, walletClient })
        const uaTransaction = {
            rootHash: USER_OP_HASH,
            userOps: [{
                userOpHash: USER_OP_HASH,
                eip7702Auth: { address: PARTICLE_DELEGATE, chainId: 56, nonce: 3 },
                eip7702Delegated: false,
            }],
        }
        particleMocks.createUniversalTransaction.mockResolvedValue(uaTransaction)
        particleMocks.sendTransaction.mockResolvedValue({ transactionId: 'particle-tx-1' })
        particleMocks.getTransaction.mockResolvedValue({ status: 7 })

        const result = await signPreparedAtomicSponsoredTransaction({
            transport: 'pistachio-local',
            capability,
            walletClient,
            prepared: directPrepared(),
            authenticatedWalletAddress: localWallet.address,
            waitForPaymasterApproval: approvalGate,
        })

        expect(result).toMatchObject({
            orderId: 'order-1',
            provider: 'particle',
            transactionId: 'particle-tx-1',
            particleStatus: 'success',
        })
        expect(approvalGate).toHaveBeenCalledExactlyOnceWith(null)
        expect(approvalGate.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0])
        expect(approvalGate.mock.invocationCallOrder[0]).toBeLessThan(signMessage.mock.invocationCallOrder[0])
        expect(request).toHaveBeenCalledWith({
            method: 'pistachio_signParticleAuthorization',
            params: [expect.objectContaining({
                type: 'eip7702Auth',
                data: { address: PARTICLE_DELEGATE, chainId: 56, nonce: 3 },
            })],
        })
        expect(signMessage).toHaveBeenCalledWith({
            account: localWallet.address,
            message: { raw: USER_OP_HASH },
        })
        expect(particleMocks.sendTransaction).toHaveBeenCalledWith(
            uaTransaction,
            SIGNATURE,
            [{ userOpHash: USER_OP_HASH, signature: SIGNATURE }],
        )
    })

    it('stops before signing or Particle submission if the paymaster webhook was not approved', async () => {
        configureParticleBrowser()
        const request = vi.fn()
        const signMessage = vi.fn()
        const approvalError = Object.assign(new Error('No paymaster approval'), {
            code: 'PARTICLE_PAYMASTER_WEBHOOK_NOT_OBSERVED',
        })
        particleMocks.createUniversalTransaction.mockResolvedValue({
            rootHash: USER_OP_HASH,
            userOps: [{
                userOpHash: USER_OP_HASH,
                eip7702Auth: { address: PARTICLE_DELEGATE, chainId: 56, nonce: 1 },
                eip7702Delegated: false,
            }],
        })
        const capability = detectRawTransactionSigning({
            connector: { id: 'pistachio-local' },
            walletClient: { request, signMessage },
        })

        await expect(signPreparedAtomicSponsoredTransaction({
            transport: 'pistachio-local',
            capability,
            walletClient: { request, signMessage },
            prepared: directPrepared(),
            authenticatedWalletAddress: localWallet.address,
            waitForPaymasterApproval: vi.fn().mockRejectedValue(approvalError),
        })).rejects.toMatchObject({ code: 'PARTICLE_PAYMASTER_WEBHOOK_NOT_OBSERVED' })

        expect(request).not.toHaveBeenCalled()
        expect(signMessage).not.toHaveBeenCalled()
        expect(particleMocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('never passes a signed payload through the backend compatibility callback', async () => {
        configureParticleBrowser()
        particleMocks.createUniversalTransaction.mockResolvedValue({
            rootHash: USER_OP_HASH,
            userOps: [],
        })
        particleMocks.sendTransaction.mockResolvedValue({ transactionId: 'particle-tx-2' })
        particleMocks.getTransaction.mockResolvedValue({ status: 7 })
        const submitSignedTransaction = vi.fn().mockResolvedValue({
            atomicExecution: { paymasterApproval: 'approved' },
        })
        const walletClient = {
            request: vi.fn(),
            signMessage: vi.fn().mockResolvedValue(SIGNATURE),
        }
        const capability = detectRawTransactionSigning({ connector: { id: 'pistachio-local' }, walletClient })

        await signPreparedAtomicSponsoredTransaction({
            transport: 'pistachio-local',
            capability,
            walletClient,
            prepared: directPrepared(),
            authenticatedWalletAddress: localWallet.address,
            submitSignedTransaction,
        })

        expect(submitSignedTransaction).toHaveBeenCalledExactlyOnceWith(null)
        expect(JSON.stringify(submitSignedTransaction.mock.calls)).not.toContain(SIGNATURE)
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

    it('keeps server credentials, relay endpoints, and signed payload persistence out of browser Gas Assist source', async () => {
        const sources = await Promise.all([
            readFile(new URL('../hooks/usePrepaidSponsorship.js', import.meta.url), 'utf8'),
            readFile(new URL('./particleSponsorship.js', import.meta.url), 'utf8'),
            readFile(new URL('./particleTransactionSigning.js', import.meta.url), 'utf8'),
        ])
        const joined = sources.join('\n')
        expect(joined).not.toMatch(/localStorage|sessionStorage/)
        expect(joined).not.toMatch(/PARTICLE_PROJECT_KEY|PARTICLE_PROJECT_UUID|PARTICLE_DELEGATION_RELAYER_PRIVATE_KEY/)
        expect(joined).not.toMatch(/\/atomic\/(?:submit|delegate)/u)
        expect(joined).not.toMatch(/VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY(?:_\d+)?/)
        expect(joined).not.toMatch(/MEGAFUEL_API_KEY|MEGAFUEL_PRIVATE_POLICY_UUID|x-megafuel-policy-uuid/)
        expect(joined).not.toMatch(/console\.(?:log|debug|info|warn|error).*signedRawTransaction/)
    })
})
