import {
    UA_TRANSACTION_STATUS,
    UniversalAccount,
} from '@particle-network/universal-account-sdk'
import { getAddress } from 'viem'
import { hashAuthorization } from 'viem/utils'

import {
    normalizePreparedSponsoredTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'
import { recordParticleBrowserResult } from './particleSponsorship.js'
import { gasAssistTrace, gasAssistTraceError } from './gasAssistTrace.js'

const SUPPORTED_CONNECTOR_IDS = new Set(['pistachio-local'])
const PARTICLE_AUTH_SIGN_METHOD = 'pistachio_signParticleAuthorization'
const SIGNATURE = /^0x[0-9a-f]{130}$/iu
const HASH = /^0x[0-9a-f]{64}$/iu
const ADDRESS = /^0x[0-9a-f]{40}$/iu
const PARTICLE_WSS_URL = 'wss://universal-app-ws-proxy.particle.network'

function signingError(code, message, details = {}) {
    const error = new Error(message)
    error.code = code
    error.details = details
    return error
}

function transactionSummary(transaction) {
    return {
        to: transaction?.to,
        nonce: transaction?.nonce,
        gas: transaction?.gas,
        chainId: transaction?.chainId,
        dataBytes: typeof transaction?.data === 'string'
            ? Math.max(0, (transaction.data.length - 2) / 2)
            : null,
    }
}

function particleBrowserConfig() {
    const projectId = String(import.meta.env?.VITE_PARTICLE_PROJECT_ID ?? '').trim()
    const projectClientKey = String(import.meta.env?.VITE_PARTICLE_CLIENT_KEY ?? '').trim()
    const projectAppUuid = String(import.meta.env?.VITE_PARTICLE_APP_ID ?? '').trim()
    if (!projectId || !projectClientKey || !projectAppUuid) {
        throw signingError(
            'PARTICLE_BROWSER_CONFIG_MISSING',
            'Particle browser credentials are not configured for Gas Assist.',
            { stage: 'particle.configure' },
        )
    }
    return { projectId, projectClientKey, projectAppUuid }
}

function assertParticlePackage(prepared, authenticatedWalletAddress) {
    if (
        !prepared ||
        prepared.provider !== 'particle' ||
        prepared.execution !== 'particle-universal-7702-direct' ||
        Number(prepared.chainId) !== 56 ||
        prepared.stage !== 'direct' ||
        prepared.paymentMode !== 'sponsored' ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        typeof prepared.orderId !== 'string' ||
        !prepared.orderId ||
        !Array.isArray(prepared.transactions) ||
        prepared.transactions.length !== 5 ||
        !ADDRESS.test(String(authenticatedWalletAddress ?? ''))
    ) {
        throw signingError(
            'PARTICLE_DIRECT_INTENT_INVALID',
            'Gas Assist did not return a valid direct Particle sponsorship intent.',
            { stage: 'particle.validate' },
        )
    }
    for (const call of prepared.transactions) {
        if (!ADDRESS.test(String(call?.to ?? '')) || !/^0x(?:[0-9a-f]{2})*$/iu.test(String(call?.data ?? ''))) {
            throw signingError('PARTICLE_DIRECT_INTENT_INVALID', 'The reviewed Particle call is invalid.')
        }
        try {
            if (BigInt(String(call?.value ?? '0')) !== 0n) {
                throw signingError('PARTICLE_NATIVE_VALUE_NOT_ALLOWED', 'Gas Assist does not permit native-value calls.')
            }
        } catch (error) {
            if (error?.code) throw error
            throw signingError('PARTICLE_DIRECT_INTENT_INVALID', 'The reviewed Particle call value is invalid.')
        }
    }
    return prepared
}

async function signParticleAuthorization({ walletClient, authorization }) {
    if (!authorization || typeof authorization !== 'object') {
        throw signingError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned an invalid EIP-7702 authorization.')
    }
    const address = getAddress(String(authorization.address ?? ''))
    const chainId = Number(authorization.chainId)
    const nonce = Number(authorization.nonce)
    if (chainId !== 56 || !Number.isSafeInteger(nonce) || nonce < 0) {
        throw signingError('PARTICLE_AUTHORIZATION_INVALID', 'Particle returned invalid BNB Chain authorization parameters.')
    }
    const request = {
        type: 'eip7702Auth',
        rawPayload: hashAuthorization({ contractAddress: address, chainId, nonce }),
        data: { address, chainId, nonce },
    }
    const signature = await walletClient.request({
        method: PARTICLE_AUTH_SIGN_METHOD,
        params: [request],
    })
    if (!SIGNATURE.test(String(signature ?? ''))) {
        throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid EIP-7702 authorization signature.')
    }
    return signature
}

function createParticleStatusWatcher(address) {
    if (typeof WebSocket !== 'function') return null
    let socket
    let opened = false
    let closed = false
    const pending = new Map()
    const open = new Promise((resolve, reject) => {
        try {
            socket = new WebSocket(PARTICLE_WSS_URL)
        } catch (error) {
            reject(error)
            return
        }
        socket.addEventListener('open', () => {
            opened = true
            socket.send(JSON.stringify({
                type: 'subscribe',
                channel: 'address-update',
                params: { addresses: [address] },
            }))
            resolve()
        }, { once: true })
        socket.addEventListener('error', () => reject(new Error('Particle status channel failed.')), { once: true })
        socket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(String(event.data ?? ''))
                const transactionId = String(message?.data?.transactionId ?? '')
                const status = Number(message?.data?.status)
                const waiter = pending.get(transactionId)
                if (waiter && (status === 7 || status === 11)) {
                    pending.delete(transactionId)
                    waiter.resolve(status)
                }
            } catch {
                // Ignore unrelated/malformed provider push messages.
            }
        })
        socket.addEventListener('close', () => {
            closed = true
            for (const waiter of pending.values()) waiter.reject(new Error('Particle status channel closed.'))
            pending.clear()
        })
    })
    return {
        async wait(transactionId, timeoutMs = 20_000) {
            await open
            if (closed || !opened) throw new Error('Particle status channel is unavailable.')
            return await new Promise((resolve, reject) => {
                const timer = globalThis.setTimeout(() => {
                    pending.delete(transactionId)
                    reject(new Error('Particle status channel timed out.'))
                }, timeoutMs)
                pending.set(transactionId, {
                    resolve: (status) => {
                        globalThis.clearTimeout(timer)
                        resolve(status)
                    },
                    reject: (error) => {
                        globalThis.clearTimeout(timer)
                        reject(error)
                    },
                })
            })
        },
        close() {
            try {
                socket?.close()
            } catch {
                // Closing a best-effort status socket must never affect execution.
            }
        },
    }
}

async function waitForParticleCompletion(universalAccount, watcher, transactionId) {
    if (watcher) {
        try {
            const pushedStatus = await watcher.wait(transactionId)
            if (pushedStatus === 7) return 'success'
            if (pushedStatus === 11) return 'failed'
        } catch (error) {
            gasAssistTraceError('signing.particle.status-push-unavailable', error, { transactionId })
        }
    }

    // Official UA examples use getTransaction(...).status === FINISHED as the
    // confirmation fallback. Polling happens entirely from the browser to Particle.
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const detail = await universalAccount.getTransaction(transactionId)
            if (detail?.status === UA_TRANSACTION_STATUS.FINISHED) return 'success'
        } catch (error) {
            if (attempt === 59) {
                gasAssistTraceError('signing.particle.status-poll-unavailable', error, { transactionId })
            }
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000))
    }
    return 'submitted'
}

export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported = SUPPORTED_CONNECTOR_IDS.has(connectorId) && typeof walletClient?.request === 'function'
    const transport = supported ? 'pistachio-local' : null
    return Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
        atomicMethod: supported ? PARTICLE_AUTH_SIGN_METHOD : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported
            ? ['personal_sign', PARTICLE_AUTH_SIGN_METHOD]
            : [],
        reasonCode: supported ? null : 'PISTACHIO_WALLET_REQUIRED',
    })
}

export async function signRawSponsoredTransaction({ capability, walletClient, transaction, action = 'sponsored-transaction' }) {
    if (capability?.rawTransactionSigningSupported !== true ||
        capability.transport !== 'pistachio-local' || typeof walletClient?.request !== 'function') {
        throw signingError('PISTACHIO_WALLET_REQUIRED', 'Gas Assist requires Pistachio Wallet.', {
            stage: 'wallet.sign', action,
        })
    }
    const signedRawTransaction = await walletClient.request({
        method: 'eth_signTransaction',
        params: [transaction],
    })
    if (typeof signedRawTransaction !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(signedRawTransaction)) {
        throw signingError('WALLET_RAW_TRANSACTION_MALFORMED', 'Pistachio Wallet returned an invalid signed transaction.')
    }
    return signedRawTransaction
}

export async function signPreparedSponsoredTransaction({
    transport,
    capability,
    walletClient,
    preparedTransaction,
    authenticatedWalletAddress,
    multichainAccount,
    submitSignedTransaction,
    action = 'sponsored-transaction',
}) {
    if (typeof submitSignedTransaction !== 'function') {
        throw signingError('SPONSORSHIP_SUBMISSION_REQUIRED', 'A sponsorship submission callback is required.')
    }
    if (transport !== 'pistachio-local') {
        throw signingError('PISTACHIO_WALLET_REQUIRED', 'Gas Assist requires Pistachio Wallet.')
    }
    const normalizedTransaction = normalizePreparedSponsoredTransaction(preparedTransaction, authenticatedWalletAddress)
    let signedRawTransaction = null
    try {
        signedRawTransaction = await signRawSponsoredTransaction({
            capability, walletClient, transaction: normalizedTransaction, action,
        })
        await validateSignedPreparedTransaction({
            signedRawTransaction,
            normalizedTransaction,
            authenticatedWalletAddress,
            multichainAccount: multichainAccount ?? authenticatedWalletAddress,
        })
        return await submitSignedTransaction(signedRawTransaction)
    } finally {
        signedRawTransaction = null
    }
}

export async function signPreparedAtomicSponsoredTransaction({
    transport,
    capability,
    walletClient,
    prepared,
    authenticatedWalletAddress,
    waitForPaymasterApproval,
    // Existing hook name retained for compatibility. In the Particle direct path
    // this callback is invoked BEFORE any owner/7702 signature exists and is used
    // only to wait for backend policy approval. No signed payload is sent to it.
    submitSignedTransaction,
}) {
    const approvalGate = waitForPaymasterApproval ?? submitSignedTransaction
    if (
        transport !== 'pistachio-local' ||
        capability?.atomicMethod !== PARTICLE_AUTH_SIGN_METHOD ||
        typeof walletClient?.request !== 'function' ||
        typeof walletClient?.signMessage !== 'function' ||
        typeof approvalGate !== 'function'
    ) {
        throw signingError(
            'PISTACHIO_WALLET_REQUIRED',
            'Particle Gas Assist requires Pistachio Wallet.',
            { stage: 'particle.validate' },
        )
    }

    const current = assertParticlePackage(prepared, authenticatedWalletAddress)
    gasAssistTrace('signing.particle.start', { orderId: current.orderId, stage: current.stage })
    const universalAccount = new UniversalAccount({
        ...particleBrowserConfig(),
        smartAccountOptions: {
            useEIP7702: true,
            ownerAddress: authenticatedWalletAddress,
        },
    })

    try {
        const transaction = await universalAccount.createUniversalTransaction({
            chainId: 56,
            expectTokens: [],
            transactions: current.transactions.map((call) => ({
                to: getAddress(call.to),
                data: call.data,
                value: BigInt(call.value ?? '0').toString(),
            })),
        })
        if (!transaction || !HASH.test(String(transaction.rootHash ?? '')) || !Array.isArray(transaction.userOps)) {
            throw signingError('PARTICLE_TRANSACTION_INVALID', 'Particle returned an invalid Universal Account transaction.')
        }

        // Critical fail-closed boundary. Particle must have invoked the project's
        // RSA-signed before_paymaster_sign webhook while creating this exact UA
        // operation. If the callback was not observed, we stop BEFORE signing and
        // BEFORE sendTransaction, preventing fallback to user-funded Universal Gas.
        await approvalGate(null)

        const authorizations = []
        for (const userOp of transaction.userOps) {
            if (userOp?.eip7702Auth && !userOp?.eip7702Delegated) {
                const userOpHash = String(userOp.userOpHash ?? '')
                if (!HASH.test(userOpHash)) {
                    throw signingError('PARTICLE_AUTHORIZATION_INVALID', 'Particle omitted the EIP-7702 UserOperation hash.')
                }
                const signature = await signParticleAuthorization({
                    walletClient,
                    authorization: userOp.eip7702Auth,
                })
                authorizations.push({ userOpHash, signature })
            }
        }

        const rootSignature = await walletClient.signMessage({
            account: authenticatedWalletAddress,
            message: { raw: transaction.rootHash },
        })
        if (!SIGNATURE.test(String(rootSignature ?? ''))) {
            throw signingError('INVALID_SIGNATURE', 'Pistachio Wallet returned an invalid Particle root signature.')
        }

        const watcher = createParticleStatusWatcher(authenticatedWalletAddress)
        try {
            const result = await universalAccount.sendTransaction(transaction, rootSignature, authorizations)
            const transactionId = String(result?.transactionId ?? '')
            if (!transactionId) {
                throw signingError('PARTICLE_SUBMISSION_INVALID', 'Particle did not return a transaction identifier.')
            }
            const particleStatus = await waitForParticleCompletion(universalAccount, watcher, transactionId)
            if (particleStatus === 'failed') {
                throw signingError('PARTICLE_TRANSACTION_FAILED', 'Particle reported that the sponsored transaction failed.')
            }
            const directResult = {
                orderId: current.orderId,
                provider: 'particle',
                transactionId,
                particleStatus,
            }
            recordParticleBrowserResult(current.orderId, directResult)
            gasAssistTrace('signing.particle.success', directResult)
            return directResult
        } finally {
            watcher?.close()
        }
    } catch (error) {
        gasAssistTraceError('signing.particle.error', error, { orderId: current?.orderId })
        throw error
    }
}

export const rawSigningInternals = {
    PARTICLE_AUTH_SIGN_METHOD,
    assertParticlePackage,
    particleBrowserConfig,
    signParticleAuthorization,
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
    transactionSummary,
    waitForParticleCompletion,
}
