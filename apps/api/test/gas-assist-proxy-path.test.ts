import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'

import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { gasAssistProxyRoutes } from '../src/modules/gas-assist-proxy.js'

const TOKEN = 'public-proxy-private-token-32-characters'
const savedEnvironment = {
    enabled: process.env.GAS_ASSIST_SERVICE_ENABLED,
    url: process.env.GAS_ASSIST_SERVICE_URL,
    token: process.env.GAS_ASSIST_INTERNAL_TOKEN,
}

afterEach(() => {
    const values = [
        ['GAS_ASSIST_SERVICE_ENABLED', savedEnvironment.enabled],
        ['GAS_ASSIST_SERVICE_URL', savedEnvironment.url],
        ['GAS_ASSIST_INTERNAL_TOKEN', savedEnvironment.token],
    ] as const
    for (const [name, value] of values) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }
    vi.unstubAllGlobals()
})

/*
 * The route allowlist added in "security: fail closed on private Gas Assist
 * proxy routes" is what confines these paths, but the suite that covers it uses
 * `app.inject()`, which normalizes the request target *before* routing. Under
 * inject a traversal path is rewritten to a 404 no matter what the handler
 * does, so those tests cannot distinguish a working guard from a missing one.
 * These speak HTTP/1.1 down an actual TCP connection instead, and assert on
 * what the proxy forwards rather than only on the status code.
 */
function rawRequest(port: number, target: string) {
    return new Promise<string>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => {
            socket.write(
                `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
            )
        })
        let received = ''
        socket.setEncoding('utf8')
        socket.on('data', (chunk) => { received += chunk })
        socket.on('error', reject)
        socket.on('close', () => resolve(received))
    })
}

async function startProxy() {
    process.env.GAS_ASSIST_SERVICE_ENABLED = 'true'
    process.env.GAS_ASSIST_SERVICE_URL = 'http://127.0.0.1:3002'
    process.env.GAS_ASSIST_INTERNAL_TOKEN = TOKEN

    const forwarded: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
        forwarded.push(String(input))
        return new Response('{"ok":true}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    }))

    const app = Fastify()
    await app.register(gasAssistProxyRoutes)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    return { app, port, forwarded }
}

describe('Gas Assist proxy path confinement', () => {
    it('forwards an in-scope path to the private service', async () => {
        const { app, port, forwarded } = await startProxy()
        try {
            const response = await rawRequest(port, '/v1/gas-assist/config')
            expect(response).toContain('200 OK')
            expect(forwarded).toEqual(['http://127.0.0.1:3002/v1/gas-assist/config'])
        } finally {
            await app.close()
        }
    })

    it.each([
        ['dot segments', '/v1/gas-assist/../../internal/admin/keys'],
        ['dot segments with a query', '/v1/sponsorship/../../ops/refund?amount=1'],
        ['a single dot segment', '/v1/gas-assist/./../secrets'],
        ['encoded dot segments', '/v1/gas-assist/%2e%2e/%2e%2e/internal'],
        ['an encoded separator', '/v1/gas-assist/a%2f..%2f..%2finternal'],
    ])('refuses to forward %s', async (_label, target) => {
        const { app, port, forwarded } = await startProxy()
        try {
            const response = await rawRequest(port, target)
            expect(response).toContain('404')
            expect(response).toContain('GAS_ASSIST_ROUTE_NOT_EXPOSED')
            // The internal token must never leave the process for these paths.
            expect(forwarded).toEqual([])
        } finally {
            await app.close()
        }
    })

    it('never forwards outside the proxied prefixes', async () => {
        const { app, port, forwarded } = await startProxy()
        try {
            await rawRequest(port, '/v1/gas-assist/../../ops/refund')
            await rawRequest(port, '/v1/sponsorship/../../internal/keys')
            expect(forwarded).toEqual([])
        } finally {
            await app.close()
        }
    })
})
