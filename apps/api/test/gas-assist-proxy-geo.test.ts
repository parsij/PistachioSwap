import type { FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { gasAssistProxyInternals } from '../src/modules/gas-assist-proxy.js'

const originalTrust = process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO

function request(headers: Record<string, string>, ip = '203.0.113.8') {
    return {
        ip,
        protocol: 'https',
        headers,
    } as unknown as FastifyRequest
}

function config() {
    return {
        baseUrl: new URL('http://127.0.0.1:3002'),
        internalToken: 'x'.repeat(32),
        timeoutMs: 30_000,
        maximumResponseBytes: 2 * 1024 * 1024,
    }
}

afterEach(() => {
    if (originalTrust === undefined) delete process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO
    else process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = originalTrust
})

describe('Gas Assist proxy compliance geolocation forwarding', () => {
    it('does not forward Cloudflare geo headers unless trust is explicitly enabled', () => {
        process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = 'false'
        const headers = gasAssistProxyInternals.proxyHeaders(request({
            'cf-connecting-ip': '203.0.113.8',
            'cf-ray': '1234567890abcdef-LAX',
            'cf-ipcountry': 'US',
            'cf-region-code': 'CA',
        }), config())

        expect(headers.get('x-pistachio-client-country')).toBeNull()
        expect(headers.get('x-pistachio-client-region')).toBeNull()
    })

    it('does not forward geo when the Cloudflare connecting IP disagrees with Fastify client IP', () => {
        process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = 'true'
        const headers = gasAssistProxyInternals.proxyHeaders(request({
            'cf-connecting-ip': '198.51.100.4',
            'cf-ray': '1234567890abcdef-LAX',
            'cf-ipcountry': 'US',
            'cf-region-code': 'CA',
        }), config())

        expect(headers.get('x-pistachio-client-country')).toBeNull()
        expect(headers.get('x-pistachio-client-region')).toBeNull()
    })

    it('forwards normalized geo only for an explicitly trusted Cloudflare-shaped request', () => {
        process.env.COMPLIANCE_TRUST_CLOUDFLARE_GEO = 'true'
        const headers = gasAssistProxyInternals.proxyHeaders(request({
            'cf-connecting-ip': '203.0.113.8',
            'cf-ray': '1234567890abcdef-LAX',
            'cf-ipcountry': 'us',
            'cf-region-code': 'ca',
        }), config())

        expect(headers.get('x-pistachio-client-country')).toBe('US')
        expect(headers.get('x-pistachio-client-region')).toBe('CA')
    })
})
