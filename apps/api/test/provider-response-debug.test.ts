import { describe, expect, it } from 'vitest'

import { providerResponseDebugInternals } from '../src/lib/provider-response-debug.js'

const { sanitizeProviderValue } = providerResponseDebugInternals

describe('provider response debug redaction', () => {
    it('redacts secrets recursively without hiding token metadata', () => {
        expect(sanitizeProviderValue({
            tokenAddress: '0x1111111111111111111111111111111111111111',
            apiKey: 'secret-key',
            nested: {
                authorization: 'Bearer secret',
                accessToken: 'secret-token',
                symbol: 'XAUT',
            },
        })).toEqual({
            tokenAddress: '0x1111111111111111111111111111111111111111',
            apiKey: '[REDACTED]',
            nested: {
                authorization: '[REDACTED]',
                accessToken: '[REDACTED]',
                symbol: 'XAUT',
            },
        })
    })

    it('truncates very long strings', () => {
        const value = sanitizeProviderValue('x'.repeat(9_000))
        expect(String(value)).toContain('[TRUNCATED]')
        expect(String(value).length).toBeLessThan(9_000)
    })
})
