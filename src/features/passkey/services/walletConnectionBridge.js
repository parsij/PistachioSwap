function connectionError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

/**
 * Bridges passkey wallet manager account/chain lifecycle events into connector subscribers.
 * Registration and disposal mutate only in-memory listeners; wallet operations remain owned
 * by `PistachioWalletManager` and require explicit caller actions.
 */
export class WalletConnectionBridge {
    constructor() {
        this.pending = null
    }

    wait() {
        if (this.pending) return this.pending.promise
        let resolve
        let reject
        const promise = new Promise((nextResolve, nextReject) => {
            resolve = nextResolve
            reject = nextReject
        })
        this.pending = { promise, reject, resolve }
        promise.catch(() => {}).finally(() => {
            if (this.pending?.promise === promise) this.pending = null
        })
        return promise
    }

    resolve(address) {
        if (!this.pending) return false
        this.pending.resolve(address)
        return true
    }

    reject(error = connectionError('PISTACHIO_CONNECTION_CANCELLED', 'Pistachio Wallet connection was cancelled.')) {
        if (!this.pending) return false
        this.pending.reject(error)
        return true
    }

    get isPending() {
        return Boolean(this.pending)
    }
}

export { connectionError }
