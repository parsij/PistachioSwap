import { describe, expect, it, vi } from 'vitest'

import { PistachioWalletWorkerClient } from './walletWorkerClient.js'

class FakeWorker {
    constructor({ autoRespond = true } = {}) {
        this.autoRespond = autoRespond
        this.listeners = new Map()
        this.terminated = false
    }
    addEventListener(type, listener) {
        this.listeners.set(type, listener)
    }
    postMessage(message, transfer = []) {
        const cloned = structuredClone(message, { transfer })
        if (this.autoRespond) queueMicrotask(() => this.listeners.get('message')?.({ data: { id: cloned.id, ok: true, result: { operation: cloned.operation } } }))
    }
    terminate() {
        this.terminated = true
    }
}

describe('Pistachio wallet worker client', () => {
    it('transfers and detaches PRF buffers', async () => {
        const client = new PistachioWalletWorkerClient({ workerFactory: () => new FakeWorker() })
        const prf = new Uint8Array(32).fill(9).buffer
        await expect(client.transferPrf('unlockVault', { vault: {}, keyWrapId: 'x' }, prf)).resolves.toEqual({ operation: 'unlockVault' })
        expect(prf.byteLength).toBe(0)
        client.terminate()
    })

    it('rejects unknown operations before creating a worker', async () => {
        const factory = vi.fn(() => new FakeWorker())
        const client = new PistachioWalletWorkerClient({ workerFactory: factory })
        await expect(client.request('unknown', {})).rejects.toThrow('Unknown')
        expect(factory).not.toHaveBeenCalled()
    })

    it('rejects pending requests on lock and creates a fresh worker afterward', async () => {
        const workers = []
        const client = new PistachioWalletWorkerClient({ workerFactory: () => {
            const worker = new FakeWorker({ autoRespond: false })
            workers.push(worker)
            return worker
        } })
        const pending = client.request('getAddress')
        const rejected = expect(pending).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_LOCKED' })
        client.terminate('PISTACHIO_WALLET_LOCKED')
        await rejected
        expect(workers[0].terminated).toBe(true)
        const next = client.request('getAddress')
        expect(workers).toHaveLength(2)
        client.terminate('PISTACHIO_WALLET_LOCKED')
        await expect(next).rejects.toMatchObject({ code: 'PISTACHIO_WALLET_LOCKED' })
    })

    it('propagates worker failure to the manager callback', () => {
        const onFatal = vi.fn()
        const worker = new FakeWorker({ autoRespond: false })
        const client = new PistachioWalletWorkerClient({ workerFactory: () => worker, onFatal })
        client.ensureWorker()
        worker.listeners.get('error')()
        expect(onFatal).toHaveBeenCalledOnce()
        expect(worker.terminated).toBe(true)
    })
})
