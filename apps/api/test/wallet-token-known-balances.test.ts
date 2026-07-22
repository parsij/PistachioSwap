import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createWalletTokenKnownBalanceRoutes,
    walletTokenKnownBalanceInternals,
} from '../src/modules/wallet-token-known-balances.js'

const WALLET = '0xe448af520b5a16293321cf0251c97fd4a1486ce0'
const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const POLYGON_TOKEN = '0x0000000000000000000000000000000000000001'
const NATIVE = '0x0000000000000000000000000000000000000000'

const apps: ReturnType<typeof Fastify>[] = []

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
    vi.restoreAllMocks()
})

async function testApp(fetchImpl: typeof fetch) {
    const app = Fastify({ logger: false })
    apps.push(app)
    await app.register(createWalletTokenKnownBalanceRoutes({
        fetchImpl,
        rpcUrlForChain: (chainId) =>
            new URL(`https://rpc-${chainId}.example/`),
    }))
    await app.ready()
    return app
}

describe('known wallet balance route', () => {
    it('batches cached native and ERC-20 balance checks by chain', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            const requests = JSON.parse(String(init?.body)) as Array<{
                id: number
                method: string
            }>
            expect(requests.map((request) => request.method)).toEqual([
                'eth_getBalance',
                'eth_call',
            ])
            return new Response(JSON.stringify([
                { jsonrpc: '2.0', id: 1, result: '0x2a' },
                { jsonrpc: '2.0', id: 2, result: '0x38' },
            ]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        }) as typeof fetch
        const app = await testApp(fetchImpl)

        const response = await app.inject({
            method: 'POST',
            url: '/v1/wallet-tokens/known-balances',
            payload: {
                address: WALLET,
                tokens: [
                    { chainId: 56, address: NATIVE },
                    { chainId: 56, address: XAUT },
                ],
            },
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({
            address: WALLET,
            balances: [
                { chainId: 56, address: NATIVE, rawBalance: '42' },
                { chainId: 56, address: XAUT, rawBalance: '56' },
            ],
            successfulChainIds: [56],
            failedChainIds: [],
            chainErrors: {},
            partial: false,
        })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('returns successful chains while safely reporting another RPC failure', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (String(url).includes('rpc-137')) {
                throw new Error('provider secret must not escape')
            }
            return new Response(JSON.stringify([
                { jsonrpc: '2.0', id: 1, result: '0x1' },
            ]), { status: 200 })
        }) as typeof fetch
        const app = await testApp(fetchImpl)

        const response = await app.inject({
            method: 'POST',
            url: '/v1/wallet-tokens/known-balances',
            payload: {
                address: WALLET,
                tokens: [
                    { chainId: 56, address: XAUT },
                    { chainId: 137, address: POLYGON_TOKEN },
                ],
            },
        })
        const body = response.json()

        expect(response.statusCode).toBe(200)
        expect(body.balances).toEqual([
            { chainId: 56, address: XAUT, rawBalance: '1' },
        ])
        expect(body.successfulChainIds).toEqual([56])
        expect(body.failedChainIds).toEqual([137])
        expect(body.chainErrors).toEqual({
            137: 'Known balances could not be refreshed.',
        })
        expect(JSON.stringify(body)).not.toContain('provider secret')
        expect(body.partial).toBe(true)
    })

    it('rejects malformed and oversized known-token requests', async () => {
        const app = await testApp(vi.fn() as unknown as typeof fetch)
        const response = await app.inject({
            method: 'POST',
            url: '/v1/wallet-tokens/known-balances',
            payload: {
                address: WALLET,
                tokens: Array.from({ length: 65 }, () => ({
                    chainId: 56,
                    address: XAUT,
                })),
            },
        })
        expect(response.statusCode).toBe(400)
    })

    it('encodes balanceOf without exposing anything except the owner address', () => {
        const data = walletTokenKnownBalanceInternals.balanceOfData(WALLET)
        expect(data).toBe(
            `0x70a08231${WALLET.slice(2).padStart(64, '0')}`,
        )
        expect(data).toHaveLength(74)
    })
})
