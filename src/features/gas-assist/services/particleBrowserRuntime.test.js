import { describe, expect, it, vi } from 'vitest'

import {
    ensureParticleBrowserProcess,
    normalizeParticleExpectedTokensForSdk,
} from './particleBrowserRuntime.js'

const USDT_BSC = '0x55d398326f99059ff775485246999027b3197955'
const USDC_BSC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'
const SUPPORTED_TOKEN_TYPE = Object.freeze({
    USDT: 'particle-usdt',
    USDC: 'particle-usdc',
})

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

    it('translates canonical BSC USDT into Particle SUPPORTED_TOKEN_TYPE', () => {
        expect(normalizeParticleExpectedTokensForSdk(
            [{ tokenAddress: USDT_BSC, amount: '0.215703' }],
            56,
            SUPPORTED_TOKEN_TYPE,
        )).toEqual([{ type: 'particle-usdt', amount: '0.215703' }])
    })

    it('translates canonical BSC USDC into Particle SUPPORTED_TOKEN_TYPE', () => {
        expect(normalizeParticleExpectedTokensForSdk(
            [{ tokenAddress: USDC_BSC.toUpperCase(), amount: '1.25' }],
            56,
            SUPPORTED_TOKEN_TYPE,
        )).toEqual([{ type: 'particle-usdc', amount: '1.25' }])
    })

    it('fails closed instead of passing an arbitrary ERC-20 address to Particle', () => {
        let thrown
        try {
            normalizeParticleExpectedTokensForSdk(
                [{ tokenAddress: '0x0000000000000000000000000000000000000010', amount: '1' }],
                56,
                SUPPORTED_TOKEN_TYPE,
            )
        } catch (error) {
            thrown = error
        }
        expect(thrown).toMatchObject({ code: 'PARTICLE_EXPECTED_TOKEN_UNSUPPORTED' })
    })
})
