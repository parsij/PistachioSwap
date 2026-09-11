import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    gasAssistProxyRoutes,
    isPublicGasAssistProxyRoute,
} from '../src/modules/gas-assist-proxy.js'

const TOKEN = 'public-proxy-private-token-32-characters'

const savedEnvironment = {
    enabled: process.env.GAS_ASSIST_SERVICE_ENABLED,
    url: process.env.GAS_ASSIST_SERVICE_URL,
    token: process.env.GAS_ASSIST_INTERNAL_TOKEN,
}

afterEach(() => {
    for (const [name, value] of [
        ['GAS_ASSIST_SERVICE_ENABLED', savedEnvironment.enabled],
        ['GAS_ASSIST_SERVICE_URL', savedEnvironment.url],
        ['GAS_ASSIST_INTERNAL_TOKEN', savedEnvironment.token],
    ] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }
    vi.unstubAllGlobals()
})

describe('Gas Assist public proxy boundary', () => {
    it('exposes only explicitly reviewed route shapes', () => {
        expect(isPublicGasAssistProxyRoute('GET', '/v1/sponsorship/config')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/preview')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/auth/challenge')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/auth/verify')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders')).toBe(true)
        expect(isPublicGasAssistProxyRoute('GET', '/v1/sponsorship/orders/order_123')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/prepare')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/delegate')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/submit')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/particle/before-paymaster-sign')).toBe(true)

        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/particle/paymaster-webhook')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/alchemy/sponsorship-webhook')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/package/prepare')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/permit')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/authorize-direct')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/confirm-direct')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/api/v1/sponsorship/intents/intent_123/submit')).toBe(false)
        expect(isPublicGasAssistProxyRoute('GET', '/v1/gas-assist/status/0xabc123')).toBe(false)
        expect(isPublicGasAssistProxyRoute('GET', '/v1/sponsorship/admin/tokens')).toBe(false)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/debug')).toBe(false)
        expect(isPublicGasAssistProxyRoute('GET', '/v1/gas-assist/internal/config')).toBe(false)
        expect(isPublicGasAssistProxyRoute('DELETE', '/v1/sponsorship/orders/order_123')).toBe(false)
    })

    it('rejects unreviewed private-service paths without contacting the service', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_SERVICE_URL = 'http://127.0.0.1:3002'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const app = Fastify({ logger: false })
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/sponsorship/admin/tokens',
            })
            expect(response.statusCode).toBe(404)
            expect(response.json()).toEqual({
                error: {
                    code: 'GAS_ASSIST_ROUTE_NOT_EXPOSED',
                    message: 'This Gas Assist route is not publicly exposed.',
                },
            })
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            await app.close()
        }
    })

    it('forwards Particle signature only on the exact callback route', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_SERVICE_URL = 'http://127.0.0.1:3002'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        const fetchMock = vi.fn(async () => new Response('{"approved":true}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }))
        vi.stubGlobal('fetch', fetchMock)
        const app = Fastify({ logger: false })
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/sponsorship/particle/before-paymaster-sign',
                headers: {
                    'x-particle-signature': 'signed-by-particle',
                    authorization: 'Bearer should-not-matter-to-particle',
                },
                payload: { type: 'before_paymaster_sign' },
            })
            expect(response.statusCode).toBe(200)
            expect(fetchMock).toHaveBeenCalledOnce()
            const [target, init] = fetchMock.mock.calls[0]
            expect(String(target)).toBe('http://127.0.0.1:3002/v1/sponsorship/particle/before-paymaster-sign')
            const headers = init?.headers as Headers
            expect(headers.get('x-particle-signature')).toBe('signed-by-particle')
            expect(headers.get('x-pistachio-internal-token')).toBe(TOKEN)
        } finally {
            await app.close()
        }
    })
})
