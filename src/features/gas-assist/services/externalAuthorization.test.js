import { describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverAuthorizationAddress } from 'viem/utils'
import { parseSignature } from 'viem'
import { assertExternalWalletContext, signExternalAuthorization } from './externalAuthorization.js'

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const delegate = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const request = { chainId: 56, address: delegate, nonce: 3 }
function provider(overrides = {}) {
    return { request: vi.fn(async ({ method, params }) => {
        if (method in overrides) return typeof overrides[method] === 'function' ? overrides[method](params) : overrides[method]
        if (method === 'eth_accounts') return [account.address]
        if (method === 'eth_chainId') return '0x38'
        if (method === 'wallet_signAuthorization') {
            expect(params).toEqual([{ address: delegate, chainId: '0x38', nonce: '0x3' }])
            return account.signAuthorization({ contractAddress: delegate, chainId: 56, nonce: 3 })
        }
        throw new Error(`Unexpected wallet method ${method}`)
    }) }
}
describe('documented external EIP-7702 provider authorization', () => {
    it.each([56, 137, 8453, 10])('uses a chain-scoped signed tuple on chain %s', async (chainId) => {
        const wallet = provider({ eth_chainId: `0x${chainId.toString(16)}`, wallet_signAuthorization: async ([p]) => {
            expect(p).toEqual({ address: delegate, chainId: `0x${chainId.toString(16)}`, nonce: '0x3' })
            return account.signAuthorization({ contractAddress: p.address, chainId, nonce: Number(BigInt(p.nonce)) })
        } })
        const signature = await signExternalAuthorization(wallet, account.address, { ...request, chainId })
        expect(await recoverAuthorizationAddress({ authorization: { address: delegate, chainId, nonce: 3, ...parseSignature(signature) } })).toBe(account.address)
    })
    it.each(['address', 'chainId', 'nonce', 'yParity', 'r', 's'])('rejects a modified %s', async (field) => {
        const signed = await account.signAuthorization({ contractAddress: delegate, chainId: 56, nonce: 3 })
        const changed = { address: account.address, chainId: 1, nonce: 4, yParity: 2, r: '0x01', s: '0x01' }
        await expect(signExternalAuthorization(provider({ wallet_signAuthorization: { ...signed, [field]: changed[field] } }), account.address, request))
            .rejects.toMatchObject({ code: 'PAYMASTER_AUTHORIZATION_INVALID' })
    })
    it.each([-32601, 4200, 4100])('fails closed for unsupported/restricted methods (%s)', async (code) => {
        const wallet = provider({ wallet_signAuthorization: () => { throw Object.assign(new Error('Unsupported'), { code }) } })
        await expect(signExternalAuthorization(wallet, account.address, request)).rejects.toMatchObject({ code: 'EXTERNAL_AUTHORIZATION_UNSUPPORTED' })
        expect(wallet.request.mock.calls.map(([p]) => p.method)).not.toContain('eth_sign')
    })
    it('preserves a user rejection without trying another signing method', async () => {
        const error = Object.assign(new Error('Rejected'), { code: 4001 })
        await expect(signExternalAuthorization(provider({ wallet_signAuthorization: () => { throw error } }), account.address, request)).rejects.toBe(error)
    })
    it('rejects wrong account and chain before requesting authorization', async () => {
        await expect(assertExternalWalletContext(provider({ eth_accounts: [delegate] }), account.address, 56)).rejects.toMatchObject({ code: 'PISTACHIO_ACCOUNT_MISMATCH' })
        const wallet = provider({ eth_chainId: '0x1' })
        await expect(signExternalAuthorization(wallet, account.address, request)).rejects.toMatchObject({ code: 'PAYMASTER_CHAIN_MISMATCH' })
        expect(wallet.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_signAuthorization' }))
    })
    it('rejects an account switch during the approval', async () => {
        const wallet = provider({ wallet_signAuthorization: async () => {
            wallet.request = provider({ eth_accounts: [delegate] }).request
            return account.signAuthorization({ contractAddress: delegate, chainId: 56, nonce: 3 })
        } })
        await expect(signExternalAuthorization(wallet, account.address, request)).rejects.toMatchObject({ code: 'PISTACHIO_ACCOUNT_MISMATCH' })
    })
})
