import { describe, expect, it } from 'vitest'
import { hostedServiceUrl } from './hostedServiceUrl.js'

describe('hosted-mode RPC routing', () => {
    const options = { enabled: true, origin: 'http://localhost:5173' }
    it('proxies the official chain-scoped Bundler without changing its path', () => {
        expect(hostedServiceUrl('https://pistachioswap.com/api/v1/bundler/8453', options))
            .toBe('http://localhost:5173/api/v1/bundler/8453')
    })
    it('keeps production and independent public RPC URLs unchanged', () => {
        const official = 'https://pistachioswap.com/api/v1/bundler'
        expect(hostedServiceUrl(official, { ...options, enabled: false })).toBe(official)
        expect(hostedServiceUrl(official, { ...options, origin: 'https://other.example' })).toBe(official)
        expect(hostedServiceUrl('https://mainnet.base.org/', options)).toBe('https://mainnet.base.org/')
        expect(hostedServiceUrl('https://pistachioswap.com.evil.test/api/v1/bundler', options))
            .toBe('https://pistachioswap.com.evil.test/api/v1/bundler')
    })
})
