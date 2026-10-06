import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashAuthorization } from 'viem/utils'

import { selfHostedAuthorizationMethods } from './walletManagerSelfHostedPaymasterSigning.js'

const delegate = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const wallet = '0x1111111111111111111111111111111111111111'

afterEach(() => {
    vi.unstubAllEnvs()
})

function signingContext() {
    const stopped = new Error('stop-after-review')
    return {
        stopped,
        ensureUnlockedForSigning: vi.fn(async () => undefined),
        captureSigningContext: vi.fn((chainId) => ({ address: wallet, chainId })),
        reviewQueue: {
            request: vi.fn(async () => {
                throw stopped
            }),
        },
        assertSigningContext: vi.fn(),
        client: {
            request: vi.fn(),
        },
        recordActivity: vi.fn(),
    }
}

describe('self-hosted Gas Assist EIP-7702 authorization signing', () => {
    it('accepts Base and scopes the authorization review to Base', async () => {
        vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'true')
        vi.stubEnv('VITE_SIMPLE_7702_ACCOUNT_ADDRESS', delegate)

        const context = signingContext()
        const nonce = 3
        const rawPayload = hashAuthorization({
            contractAddress: delegate,
            chainId: 8453,
            nonce,
        })

        await expect(selfHostedAuthorizationMethods.signSelfHostedAuthorization.call(
            context,
            {
                type: 'eip7702Auth',
                data: {
                    address: delegate,
                    chainId: 8453,
                    nonce,
                },
                rawPayload,
            },
        )).rejects.toBe(context.stopped)

        expect(context.captureSigningContext).toHaveBeenCalledWith(8453)
        expect(context.reviewQueue.request).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 8453,
            payload: expect.objectContaining({
                authorizationScope: 'Base (8453)',
            }),
        }))
    })

    it('rejects a chain outside the approved Gas Assist source set before review', async () => {
        vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'true')
        vi.stubEnv('VITE_SIMPLE_7702_ACCOUNT_ADDRESS', delegate)

        const context = signingContext()
        const nonce = 0
        const rawPayload = hashAuthorization({
            contractAddress: delegate,
            chainId: 999999,
            nonce,
        })

        await expect(selfHostedAuthorizationMethods.signSelfHostedAuthorization.call(
            context,
            {
                type: 'eip7702Auth',
                data: {
                    address: delegate,
                    chainId: 999999,
                    nonce,
                },
                rawPayload,
            },
        )).rejects.toMatchObject({
            code: 'PAYMASTER_AUTHORIZATION_INVALID',
        })

        expect(context.reviewQueue.request).not.toHaveBeenCalled()
    })
})
