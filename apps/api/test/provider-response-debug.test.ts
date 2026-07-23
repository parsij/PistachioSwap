import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    logProviderResponse,
    providerResponseDebugInternals,
} from '../src/lib/provider-response-debug.js'

const { sanitizeProviderString, sanitizeProviderValue } = providerResponseDebugInternals

describe('provider response debug redaction', () => {
    const previousEnv = { ...process.env }

    afterEach(() => {
        process.env = { ...previousEnv }
        vi.restoreAllMocks()
    })

    it('does not print provider responses unless explicitly enabled', () => {
        process.env.DEBUG_SPONSORSHIP_PROVIDER_RESPONSES = 'false'
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        logProviderResponse('alchemy', 'wallet-discovery', {
            full: 'provider payload',
            stack: 'large stack',
        })

        expect(log).not.toHaveBeenCalled()
    })

    it('does not print expected abort stacks when debug logging is disabled', () => {
        delete process.env.DEBUG_SPONSORSHIP_PROVIDER_RESPONSES
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        logProviderResponse('alchemy', 'wallet-discovery-aborted', new DOMException(
            'Request aborted',
            'AbortError',
        ))

        expect(log).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
        expect(error).not.toHaveBeenCalled()
    })


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

    it('redacts API keys embedded inside error URLs and bearer text', () => {
        expect(sanitizeProviderString(
            'GET https://api.g.alchemy.com/prices/v1/real-secret/tokens/by-symbol?apiKey=another-secret Bearer abc.def',
        )).toBe(
            'GET https://api.g.alchemy.com/prices/v1/[REDACTED]/tokens/by-symbol?apiKey=[REDACTED] Bearer [REDACTED]',
        )
    })

    it('truncates very long strings', () => {
        const value = sanitizeProviderValue('x'.repeat(9_000))
        expect(String(value)).toContain('[TRUNCATED]')
        expect(String(value).length).toBeLessThan(9_000)
    })
})
