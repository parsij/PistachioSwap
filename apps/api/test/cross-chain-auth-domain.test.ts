import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCrossChainRoutes } from '../src/modules/cross-chain.js'

const WALLET = '0x0000000000000000000000000000000000000011'
const savedOrigins = process.env.CORS_ORIGINS

function stubAuth() {
    const createChallenge = vi.fn(async (input: { domain: string }) => ({
        challengeId: 'challenge-1',
        message: `Domain: ${input.domain}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }))
    return {
        createChallenge,
        verifyChallenge: vi.fn(),
        authenticate: vi.fn(),
    } as never
}

async function challengeDomain(host: string, auth: ReturnType<typeof stubAuth>) {
    const app = Fastify()
    await app.register(createCrossChainRoutes({} as never, auth))
    try {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/cross-chain/auth/challenge',
            headers: { host },
            payload: { walletAddress: WALLET, chainId: 1 },
        })
        return response.json().message
    } finally {
        await app.close()
    }
}

beforeEach(() => {
    process.env.CORS_ORIGINS = 'https://pistachioswap.com,https://app.pistachioswap.com'
})

afterEach(() => {
    if (savedOrigins === undefined) delete process.env.CORS_ORIGINS
    else process.env.CORS_ORIGINS = savedOrigins
    vi.restoreAllMocks()
})

describe('wallet-auth signing domain', () => {
    it('signs the domain the request was actually served on', async () => {
        expect(await challengeDomain('app.pistachioswap.com', stubAuth()))
            .toBe('Domain: app.pistachioswap.com')
    })

    it.each([
        ['an unrelated site the caller wants to impersonate', 'some-other-wallet-app.example'],
        ['a lookalike domain', 'pistachioswap.com.evil.example'],
        ['an absent Host header', ''],
    ])('never signs %s', async (_label, host) => {
        // A non-browser client controls its own Host header, so the signed
        // message must not be steerable to a domain this service does not serve.
        const message = await challengeDomain(host, stubAuth())
        expect(message).toBe('Domain: pistachioswap.com')
        expect(message).not.toContain(host || 'unreachable')
    })
})
