import { getCuratedEvmChain } from '../../../web3/curatedEvmChains.js'
import { PISTACHIO_SIGNING_TTL_MS } from './constants.js'

function reviewError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

/**
 * Queues one passkey signing review at a time and resolves only the exact accepted request.
 * Cancellation/rejection clears the pending request and never signs or broadcasts by itself.
 */
export class SigningReviewQueue {
    constructor({
        now = () => Date.now(),
        setTimer = globalThis.setTimeout.bind(globalThis),
        clearTimer = globalThis.clearTimeout.bind(globalThis),
    } = {}) {
        this.now = now
        this.setTimer = setTimer
        this.clearTimer = clearTimer
        this.active = null
        this.subscribers = new Set()
    }

    subscribe(subscriber) {
        this.subscribers.add(subscriber)
        subscriber(this.snapshot())
        return () => this.subscribers.delete(subscriber)
    }

    snapshot() {
        if (!this.active) return null
        const { resolve: _resolve, reject: _reject, timer: _timer, ...publicRequest } = this.active
        return structuredClone(publicRequest)
    }

    notify() {
        const snapshot = this.snapshot()
        for (const subscriber of this.subscribers) subscriber(snapshot)
    }

    request({ walletAddress, chainId, action, payload, origin = globalThis.location?.origin ?? 'unknown' }) {
        if (this.active) return Promise.reject(reviewError('PISTACHIO_SIGNING_REQUEST_ACTIVE', 'Another signing request is awaiting review.'))
        const chain = getCuratedEvmChain(chainId)
        if (!chain) return Promise.reject(reviewError('PISTACHIO_CHAIN_NOT_ALLOWED', 'This network is not enabled in PistachioSwap.'))
        const createdAtMs = this.now()
        const id = crypto.randomUUID()
        const immutablePayload = structuredClone(payload)
        return new Promise((resolve, reject) => {
            const timer = this.setTimer(() => this.reject(id, 'PISTACHIO_SIGNING_REQUEST_EXPIRED'), PISTACHIO_SIGNING_TTL_MS)
            this.active = {
                id,
                walletAddress,
                chainId: chain.id,
                chainName: chain.name,
                action,
                origin,
                payload: immutablePayload,
                createdAt: new Date(createdAtMs).toISOString(),
                expiresAt: new Date(createdAtMs + PISTACHIO_SIGNING_TTL_MS).toISOString(),
                resolve,
                reject,
                timer,
            }
            this.notify()
        })
    }

    approve(id) {
        if (!this.active || this.active.id !== id) throw reviewError('PISTACHIO_SIGNING_REQUEST_STALE', 'This signing request is no longer active.')
        if (Date.parse(this.active.expiresAt) <= this.now()) return this.reject(id, 'PISTACHIO_SIGNING_REQUEST_EXPIRED')
        const { resolve, timer } = this.active
        this.clearTimer(timer)
        this.active = null
        this.notify()
        resolve(true)
    }

    reject(id, code = 'PISTACHIO_SIGNING_REQUEST_REJECTED') {
        if (!this.active || this.active.id !== id) return
        const { reject, timer } = this.active
        this.clearTimer(timer)
        this.active = null
        this.notify()
        reject(reviewError(code, code === 'PISTACHIO_SIGNING_REQUEST_EXPIRED' ? 'The signing request expired.' : 'The signing request was rejected.'))
    }

    clear(code = 'PISTACHIO_WALLET_LOCKED') {
        if (this.active) this.reject(this.active.id, code)
    }
}
