import { describe, expect, it, vi } from 'vitest'
import { createCachedPublicClientResolver } from './cachedPublicClient.js'

describe('wallet runtime public client identity', () => {
    it('returns the same client for repeated same-chain renders without repeating Wagmi lookups', () => {
        const config = {}
        const getPublicClient = vi.fn((_, options) => ({ chainId: options?.chainId }))
        const resolve = createCachedPublicClientResolver(config, getPublicClient)

        const first = resolve(137)
        expect(resolve(137)).toBe(first)
        expect(resolve('137')).toBe(first)
        expect(getPublicClient).toHaveBeenCalledExactlyOnceWith(config, { chainId: 137 })
        expect(resolve(8453)).not.toBe(first)
        expect(getPublicClient).toHaveBeenCalledTimes(2)
        expect(resolve(137)).toBe(first)
    })

    it('does not reuse clients from a different Wagmi config', () => {
        const getPublicClient = vi.fn(() => ({}))
        const one = createCachedPublicClientResolver({ id: 'one' }, getPublicClient)
        const two = createCachedPublicClientResolver({ id: 'two' }, getPublicClient)
        expect(one(137)).not.toBe(two(137))
        expect(getPublicClient).toHaveBeenCalledTimes(2)
    })

    it('retries an initially unavailable RPC client rather than caching failure', () => {
        const getPublicClient = vi.fn()
            .mockImplementationOnce(() => { throw new Error('unavailable') })
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => ({ ready: true }))
        const resolve = createCachedPublicClientResolver({}, getPublicClient)
        expect(resolve(137)).toBeUndefined()
        expect(resolve(137)).toBeUndefined()
        const client = resolve(137)
        expect(client).toEqual({ ready: true })
        expect(resolve(137)).toBe(client)
        expect(getPublicClient).toHaveBeenCalledTimes(3)
    })

    it('never requests a client for malformed or absent configuration', () => {
        const getPublicClient = vi.fn()
        expect(createCachedPublicClientResolver(null, getPublicClient)(137)).toBeUndefined()
        const resolve = createCachedPublicClientResolver({}, getPublicClient)
        for (const chainId of [0, -1, Infinity, NaN, 1.2, 'invalid']) {
            expect(resolve(chainId)).toBeUndefined()
        }
        expect(getPublicClient).not.toHaveBeenCalled()
    })
})
