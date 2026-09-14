import { describe, expect, it, vi } from 'vitest'

import { ensureParticleBrowserProcess } from './particleBrowserRuntime.js'

describe('Particle browser runtime compatibility', () => {
    it('installs the minimal process surface Particle can inspect in a browser', async () => {
        const target = {}
        const processShim = ensureParticleBrowserProcess(target)

        expect(target.process).toBe(processShim)
        expect(processShim).toMatchObject({
            browser: true,
            env: {},
            platform: 'browser',
            version: '',
            versions: {},
        })
        expect(processShim.cwd()).toBe('/')

        const callback = vi.fn()
        processShim.nextTick(callback, 'particle')
        await Promise.resolve()
        expect(callback).toHaveBeenCalledWith('particle')
    })

    it('preserves an existing process object and only supplies a missing env object', () => {
        const existing = { browser: false }
        const target = { process: existing }

        expect(ensureParticleBrowserProcess(target)).toBe(existing)
        expect(target.process).toBe(existing)
        expect(existing.env).toEqual({})
    })

    it('does not replace an existing process env object', () => {
        const env = { NODE_ENV: 'test' }
        const existing = { env }
        const target = { process: existing }

        ensureParticleBrowserProcess(target)
        expect(existing.env).toBe(env)
        expect(existing.env.NODE_ENV).toBe('test')
    })
})
