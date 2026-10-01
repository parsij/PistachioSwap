import { afterEach, describe, expect, it } from 'vitest'

import { readTrustProxy } from '../src/app.js'

describe('trust proxy configuration', () => {
    const previousEnv = { ...process.env }

    afterEach(() => {
        process.env = { ...previousEnv }
    })

    it('trusts exactly one loopback reverse proxy', () => {
        process.env.TRUST_PROXY_HOPS = '1'
        const trust = readTrustProxy()

        expect(typeof trust).toBe('function')
        if (typeof trust !== 'function') throw new Error('Expected trust function.')

        expect(trust('127.0.0.1', 0)).toBe(true)
        expect(trust('::1', 0)).toBe(true)
        expect(trust('::ffff:127.0.0.1', 0)).toBe(true)
        expect(trust('203.0.113.10', 0)).toBe(false)
        expect(trust('127.0.0.1', 1)).toBe(false)
    })

    it('rejects obsolete multi-hop numeric trust', () => {
        process.env.TRUST_PROXY_HOPS = '2'
        expect(() => readTrustProxy()).toThrow(/0 or 1/u)
    })

    it('keeps proxy trust disabled when explicitly set to zero', () => {
        process.env.TRUST_PROXY_HOPS = '0'
        expect(readTrustProxy()).toBe(false)
    })
})
