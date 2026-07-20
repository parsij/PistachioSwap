import { describe, expect, it, vi } from 'vitest'

import { createShutdownHandler } from '../src/lib/shutdown.js'

describe('API shutdown', () => {
    it('closes once when multiple termination signals arrive', async () => {
        const close = vi.fn(async () => undefined)
        const onError = vi.fn()
        const shutdown = createShutdownHandler(close, onError)

        await Promise.all([shutdown(), shutdown(), shutdown()])

        expect(close).toHaveBeenCalledOnce()
        expect(onError).not.toHaveBeenCalled()
    })

    it('reports cleanup failures without rejecting the signal handler', async () => {
        const failure = new Error('close failed')
        const onError = vi.fn()
        const shutdown = createShutdownHandler(
            vi.fn(async () => { throw failure }),
            onError,
        )

        await expect(shutdown()).resolves.toBeUndefined()
        expect(onError).toHaveBeenCalledWith(failure)
    })
})
