import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { tokenCatalogRoutes } from '../src/modules/token-catalog.js'

async function statusFor(url: string) {
    const app = Fastify()
    await app.register(tokenCatalogRoutes)
    try {
        return (await app.inject({ method: 'GET', url })).statusCode
    } finally {
        await app.close()
    }
}

describe('token catalog query validation', () => {
    it.each([
        ['a repeated chainId', '/v1/token-catalog?chainId=56&chainId=1'],
        ['a repeated search', '/v1/token-catalog?search=a&search=b'],
        ['an unknown parameter', '/v1/token-catalog?bogusParam=1'],
        ['an overlong search', `/v1/token-catalog?search=${'A'.repeat(300)}`],
    ])('rejects %s with a client error instead of a 500', async (_label, url) => {
        // Fastify returns arrays for repeated parameters and the handler calls
        // string methods on them, which used to surface as an unhandled 500.
        expect(await statusFor(url)).toBe(400)
    })
})
