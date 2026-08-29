import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    gasAssistProxyRoutes,
    readGasAssistProxyConfig,
} from '../src/modules/gas-assist-proxy.js'

const TOKEN = 'public-proxy-private-token-32-characters'
const savedEnvironment = {
    enabled: process.env.GAS_ASSIST_SERVICE_ENABLED,
    url: process.env.GAS_ASSIST_SERVICE_URL,
    token: process.env.GAS_ASSIST_INTERNAL_TOKEN,
    timeoutMs: process.env.GAS_ASSIST_SERVICE_TIMEOUT_MS,
    maxResponseBytes: process.env.GAS_ASSIST_SERVICE_MAX_RESPONSE_BYTES,
}

function restoreEnvironment() {
    const values = [
        ['GAS_ASSIST_SERVICE_ENABLED', savedEnvironment.enabled],
        ['GAS_ASSIST_SERVICE_URL', savedEnvironment.url],
        ['GAS_ASSIST_INTERNAL_TOKEN', savedEnvironment.token],
        ['GAS_ASSIST_SERVICE_TIMEOUT_MS', savedEnvironment.timeoutMs],
        ['GAS_ASSIST_SERVICE_MAX_RESPONSE_BYTES', savedEnvironment.maxResponseBytes],
    ] as const
    for (const [name, value] of values) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }
}

afterEach(() => {
    restoreEnvironment()
    vi.unstubAllGlobals()
})

describe('private Gas Assist proxy', () => {
    it('returns disabled public configuration without contacting a service', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'false'
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const app = Fastify()
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/sponsorship/config',
            })
            expect(response.statusCode).toBe(200)
            expect(response.json()).toEqual({ enabled: false, chainId: 56 })
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            await app.close()
        }
    })

    it('fails closed when enabled without a strong internal token', () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = 'short'

        expect(() => readGasAssistProxyConfig()).toThrow(
            'GAS_ASSIST_INTERNAL_TOKEN must contain at least 32 characters',
        )
    })

    it('rejects invalid private service URLs', () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN

        for (const url of [
            'http://gas-assist.internal:3002',
            'https://user:pass@gas-assist.internal',
        ]) {
            process.env.GAS_ASSIST_SERVICE_URL = url
            expect(() => readGasAssistProxyConfig()).toThrow(
                'GAS_ASSIST_SERVICE_URL must be HTTPS or a localhost HTTP URL without embedded credentials.',
            )
        }
    })

    it('forwards only bounded server-controlled headers', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_SERVICE_URL = 'http://127.0.0.1:3002'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ enabled: true, chainId: 56, atomicExecution: true }),
            {
                status: 200,
                headers: { 'content-type': 'application/json' },
            },
        ))
        vi.stubGlobal('fetch', fetchMock)
        const app = Fastify()
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/sponsorship/config?source=ui',
                headers: {
                    authorization: 'Bearer wallet-session',
                    'x-api-key': 'must-not-forward',
                },
            })
            expect(response.statusCode).toBe(200)
            expect(response.json()).toEqual({
                enabled: true,
                chainId: 56,
                atomicExecution: true,
            })
            expect(fetchMock).toHaveBeenCalledOnce()

            const [target, init] = fetchMock.mock.calls[0]
            expect(String(target)).toBe(
                'http://127.0.0.1:3002/v1/sponsorship/config?source=ui',
            )
            const headers = init?.headers as Headers
            expect(headers.get('x-pistachio-internal-token')).toBe(TOKEN)
            expect(headers.get('authorization')).toBe('Bearer wallet-session')
            expect(headers.get('x-pistachio-client-ip')).toBeTruthy()
            expect(headers.get('x-forwarded-for')).toBeNull()
            expect(headers.get('x-api-key')).toBeNull()
        } finally {
            await app.close()
        }
    })

    it('forwards idempotency keys and strips api prefixes for private routes', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_SERVICE_URL = 'http://127.0.0.1:3002/internal'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ id: 'order-1' }),
            { status: 201, headers: { 'content-type': 'application/json' } },
        ))
        vi.stubGlobal('fetch', fetchMock)
        const app = Fastify()
        await app.register(gasAssistProxyRoutes, { prefix: '/api' })

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/sponsorship/orders',
                headers: { 'idempotency-key': 'idem-1' },
                payload: { sponsored: true, sellToken: '0x1' },
            })
            expect(response.statusCode).toBe(201)
            expect(fetchMock).toHaveBeenCalledOnce()
            const [target, init] = fetchMock.mock.calls[0]
            expect(String(target)).toBe(
                'http://127.0.0.1:3002/internal/v1/sponsorship/orders',
            )
            const headers = init?.headers as Headers
            expect(headers.get('idempotency-key')).toBe('idem-1')
            expect(init?.body).toBe(JSON.stringify({
                sponsored: true,
                sellToken: '0x1',
            }))
        } finally {
            await app.close()
        }
    })

    it('enforces the configured maximum response size', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_SERVICE_MAX_RESPONSE_BYTES = '1024'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1025), {
            status: 200,
            headers: { 'content-type': 'text/plain' },
        })))
        const app = Fastify({ logger: false })
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/sponsorship/config',
            })
            expect(response.statusCode).toBe(503)
            expect(response.json().error.code).toBe('GAS_ASSIST_UNAVAILABLE')
        } finally {
            await app.close()
        }
    })

    it('maps request timeouts and redirect rejections to redacted unavailable responses', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        process.env.GAS_ASSIST_SERVICE_TIMEOUT_MS = '1000'
        const fetchMock = vi.fn(async () => {
            throw new Error('redirect or timeout detail')
        })
        vi.stubGlobal('fetch', fetchMock)
        const app = Fastify({ logger: false })
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/v1/sponsorship/config',
            })
            expect(response.statusCode).toBe(503)
            expect(response.json()).toEqual({
                error: {
                    code: 'GAS_ASSIST_UNAVAILABLE',
                    message: 'Gas Assist is temporarily unavailable.',
                },
            })
            expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error')
            expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
        } finally {
            await app.close()
        }
    })

    it('returns a generic unavailable response when the private service fails', async () => {
        process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
        process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('private network detail')
        }))
        const app = Fastify({ logger: false })
        await app.register(gasAssistProxyRoutes)

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/v1/sponsorship/preview',
                payload: { test: true },
            })
            expect(response.statusCode).toBe(503)
            expect(response.json()).toEqual({
                error: {
                    code: 'GAS_ASSIST_UNAVAILABLE',
                    message: 'Gas Assist is temporarily unavailable.',
                },
            })
        } finally {
            await app.close()
        }
    })
})
