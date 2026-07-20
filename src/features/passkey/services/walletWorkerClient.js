import { WALLET_WORKER_OPERATIONS } from './walletWorkerProtocol.js'

const allowedOperations = new Set(WALLET_WORKER_OPERATIONS)

/**
 * Serializes requests to the passkey wallet worker and correlates bounded responses.
 * Worker failures reject pending calls with safe errors; disposal terminates the worker
 * and clears all pending operations without exposing secret payloads to UI state.
 */
export class PistachioWalletWorkerClient {
    constructor({
        workerFactory = () => new Worker(new URL('./walletWorker.js', import.meta.url), { type: 'module', name: 'pistachio-wallet' }),
        onFatal = () => {},
    } = {}) {
        this.workerFactory = workerFactory
        this.onFatal = onFatal
        this.worker = null
        this.nextId = 1
        this.pending = new Map()
    }

    ensureWorker() {
        if (this.worker) return this.worker
        const worker = this.workerFactory()
        worker.addEventListener('message', (event) => this.handleMessage(event.data))
        worker.addEventListener('error', () => this.handleFatal())
        worker.addEventListener('messageerror', () => this.handleFatal())
        this.worker = worker
        return worker
    }

    handleFatal() {
        this.terminate('PISTACHIO_WALLET_WORKER_FAILED')
        this.onFatal()
    }

    handleMessage(message) {
        const pending = this.pending.get(message?.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.ok === true) pending.resolve(message.result)
        else {
            const error = new Error(message?.error?.message ?? 'Wallet worker operation failed.')
            error.code = message?.error?.code ?? 'PISTACHIO_WALLET_WORKER_FAILED'
            pending.reject(error)
        }
    }

    request(operation, payload = {}, transfer = []) {
        if (!allowedOperations.has(operation)) return Promise.reject(new TypeError('Unknown wallet worker operation.'))
        const id = this.nextId++
        const worker = this.ensureWorker()
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            try {
                worker.postMessage({ id, operation, payload }, transfer)
            } catch (error) {
                this.pending.delete(id)
                reject(error)
            }
        })
    }

    transferPrf(operation, payload, prfOutput) {
        if (!(prfOutput instanceof ArrayBuffer) || prfOutput.byteLength !== 32) {
            return Promise.reject(new TypeError('Invalid PRF output buffer.'))
        }
        return this.request(operation, { ...payload, prfOutput }, [prfOutput])
    }

    async lock() {
        if (!this.worker) return
        try {
            await this.request('lock')
        } finally {
            this.terminate('PISTACHIO_WALLET_LOCKED')
        }
    }

    terminate(code = 'PISTACHIO_WALLET_WORKER_TERMINATED') {
        this.worker?.terminate()
        this.worker = null
        for (const pending of this.pending.values()) {
            const error = new Error('Pistachio Wallet was locked.')
            error.code = code
            pending.reject(error)
        }
        this.pending.clear()
    }
}

export const walletWorkerClientInternals = { allowedOperations }
