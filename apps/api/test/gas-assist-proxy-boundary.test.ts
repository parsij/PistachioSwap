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
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/package/prepare')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/prepare')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/v1/sponsorship/orders/order_123/atomic/submit')).toBe(true)
        expect(isPublicGasAssistProxyRoute('POST', '/api/v1/sponsorship/intents/intent_123/submit')).toBe(true)
        expect(isPublicGasAssistProxyRoute('GET', '/v1/gas-assist/status/0xabc123')).toBe(true)

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
})
