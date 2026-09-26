import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    encodeFunctionData, erc20Abi, getAddress, hashTypedData, numberToHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
    encodeSelfHostedBatch,
    selfHostedFrontendEnabled,
    selfHostedUserOpTypedData,
    sponsoredBscGasFees,
    submitSelfHostedPaymasterUserOperation,
    validateSelfHostedPrepared,
} from './selfHostedPaymaster.js'

const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const sender = getAddress(signer.address)
const token = getAddress('0x3333333333333333333333333333333333333333')
const treasury = getAddress('0x4444444444444444444444444444444444444444')
const spender = getAddress('0x5555555555555555555555555555555555555555')
const router = getAddress('0x6666666666666666666666666666666666666666')
const entryPoint = getAddress('0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108')
const delegate = getAddress('0xe6Cae83BdE06E4c305530e199D7217f42808555B')
const marker = getAddress('0x7702000000000000000000000000000000000000')
const paymaster = getAddress('0x7777777777777777777777777777777777777777')
const fee = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury, 10n] })
const approval = (value) => encodeFunctionData({
    abi: erc20Abi, functionName: 'approve', args: [spender, value],
})
const calls = [
    { to: token, data: fee, value: '0x0' },
    { to: token, data: approval(0n), value: '0x0' },
    { to: token, data: approval(90n), value: '0x0' },
    { to: router, data: '0x12345678', value: '0x0' },
    { to: token, data: approval(0n), value: '0x0' },
]
const order = {
    id: 'order-1', walletAddress: sender, sellToken: token,
    paymentToken: token, treasuryAddress: treasury, approvalSpender: spender,
    netSwapAmountRaw: '90', paymentAmountRaw: '10',
}
const backendConfig = {
    enabled: true, provider: 'pistachio-paymaster-v08',
    execution: 'erc4337-v08-eip7702-direct',
    entryPoint, delegate, paymaster, eip7702Factory: marker,
}
const settings = { entryPoint, delegate, paymaster }

function prepared(overrides = {}) {
    return {
        provider: 'pistachio-paymaster-v08',
        execution: 'erc4337-v08-eip7702-direct',
        stage: 'direct', paymentMode: 'sponsored', orderId: order.id,
        chainId: 56, entryPoint, delegate, paymaster, eip7702Factory: marker,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        pistachioFeeAmountRaw: '10', transactions: calls,
        ...overrides,
    }
}

beforeEach(() => {
    vi.stubEnv('VITE_GAS_ASSIST_ENABLED', 'true')
    vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'true')
    vi.stubEnv('VITE_ENTRYPOINT_V08_ADDRESS', entryPoint)
    vi.stubEnv('VITE_SIMPLE_7702_ACCOUNT_ADDRESS', delegate)
    vi.stubEnv('VITE_PISTACHIO_PAYMASTER_ADDRESS', paymaster)
    vi.stubEnv('VITE_BSC_PUBLIC_RPC_URL', 'https://rpc.example')
    vi.stubEnv('VITE_BSC_BUNDLER_RPC_URL', 'https://bundler.example')
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('self-hosted browser-owned EIP-7702 Paymaster', () => {
    it('quotes a full BSC priority fee, with separate capped max-fee headroom', () => {
        expect(sponsoredBscGasFees('0x3b9aca00')).toEqual({
            maxPriorityFeePerGas: '0x3b9aca00',
            maxFeePerGas: '0x77359400',
        })
        expect(() => sponsoredBscGasFees('0x0')).toThrow(/gas price is invalid/iu)
    })

    it('rejects disabled frontend and tampered or non-five-call intents', () => {
        expect(selfHostedFrontendEnabled(backendConfig)).toBe(true)
        vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'false')
        expect(selfHostedFrontendEnabled(backendConfig)).toBe(false)
        vi.stubEnv('VITE_SELF_HOSTED_PAYMASTER_ENABLED', 'true')
        expect(validateSelfHostedPrepared(prepared(), order, settings)).toHaveLength(5)
        expect(() => validateSelfHostedPrepared(prepared({ transactions: calls.slice(0, 4) }), order, settings))
            .toThrow(/five-call|does not match/iu)
        expect(() => validateSelfHostedPrepared(prepared({ transactions: [...calls.slice(0, 3), {
            ...calls[3], value: '0x1',
        }, calls[4]] }), order, settings)).toThrow(/native BNB/iu)
        expect(() => validateSelfHostedPrepared(prepared(), { ...order, paymentAmountRaw: '11' }, settings))
            .toThrow(/payment changed/iu)
        expect(() => validateSelfHostedPrepared(prepared({ delegate: treasury }), order, settings))
            .toThrow(/does not match/iu)
    })

    it('encodes the exact reviewed executeBatch and binds final Paymaster data into the account hash', () => {
        const actualCalls = validateSelfHostedPrepared(prepared(), order, settings)
        expect(encodeSelfHostedBatch(actualCalls)).toMatch(/^0x[0-9a-f]+$/iu)
        const userOp = {
            sender, nonce: '0x0', factory: marker, factoryData: '0x',
            callData: encodeSelfHostedBatch(actualCalls),
            callGasLimit: '0x186a0', verificationGasLimit: '0x30d40',
            preVerificationGas: '0x11170',
            maxPriorityFeePerGas: '0x3b9aca00', maxFeePerGas: '0x77359400',
            paymasterData: `0x${'ab'.repeat(125)}`,
            paymasterVerificationGasLimit: '0x222e0', paymasterPostOpGasLimit: '0x0',
        }
        const typed = selfHostedUserOpTypedData(userOp, settings)
        expect(typed.message.initCode.toLowerCase()).toBe(delegate.toLowerCase())
        expect(typed.message.paymasterAndData).toHaveLength(2 + (52 + 125) * 2)
        expect(hashTypedData(typed)).not.toBe(hashTypedData(selfHostedUserOpTypedData({
            ...userOp, paymasterData: `0x${'cd'.repeat(125)}`,
        }, settings)))
    })

    it.each(['0x', `0xef0100${delegate.slice(2)}`])(
        'performs stub, estimate, sponsor, final local signing and direct submission for code %s',
        async (onChainCode) => {
            const requests = []
            let locallySignedHash
            const walletClient = {
                request: vi.fn(async ({ method }) => {
                    expect(method).toBe('pistachio_signSelfHostedAuthorization')
                    return `0x${'12'.repeat(64)}1b`
                }),
                signTypedData: vi.fn(async ({ account, ...typed }) => {
                    expect(getAddress(account)).toBe(sender)
                    locallySignedHash = hashTypedData(typed)
                    return signer.signTypedData(typed)
                }),
            }
            const rpcResult = (method) => {
                switch (method) {
                case 'eth_chainId': return '0x38'
                case 'eth_supportedEntryPoints': return [entryPoint]
                case 'eth_getCode': return onChainCode
                case 'eth_getTransactionCount': return '0x0'
                case 'eth_call': return numberToHex(0n, { size: 32 })
                case 'eth_gasPrice': return '0x3b9aca00'
                case 'eth_estimateUserOperationGas':
                    return { callGasLimit: '0x186a0', verificationGasLimit: '0x30d40', preVerificationGas: '0x11170' }
                case 'eth_sendUserOperation': return locallySignedHash
                case 'eth_getUserOperationReceipt': return {
                    success: true, receipt: { status: '0x1', transactionHash: `0x${'fa'.repeat(32)}` },
                }
                default: throw new Error(`Unexpected RPC ${method}`)
                }
            }
            vi.stubGlobal('fetch', vi.fn(async (url, options) => {
                const body = JSON.parse(options.body)
                requests.push({ url: String(url), body })
                if (body.method) {
                    return new Response(JSON.stringify({
                        jsonrpc: '2.0', id: 1, result: rpcResult(body.method),
                    }), { status: 200 })
                }
                const isStub = String(url).endsWith('/paymaster/stub')
                return new Response(JSON.stringify(isStub ? {
                    paymaster, paymasterData: `0x${'aa'.repeat(125)}`,
                    paymasterVerificationGasLimit: '0x222e0', paymasterPostOpGasLimit: '0x0',
                } : {
                    paymaster, paymasterData: `0x${'bb'.repeat(125)}`,
                    paymasterVerificationGasLimit: '0x222e0', paymasterPostOpGasLimit: '0x0',
                    isFinal: true, validUntil: Math.floor(Date.now() / 1000) + 60,
                }), { status: 200 })
            }))
            const result = await submitSelfHostedPaymasterUserOperation({
                prepared: prepared(), order, backendConfig,
                quoteEndpoint: 'http://localhost:3001/v1/quote',
                sessionToken: 'session',
                walletClient, authenticatedWalletAddress: sender,
            })
            expect(result).toMatchObject({ status: 'completed', userOpHash: locallySignedHash })
            const stubIndex = requests.findIndex((r) => r.url.endsWith('/paymaster/stub'))
            const estimateIndex = requests.findIndex((r) => r.body.method === 'eth_estimateUserOperationGas')
            const sponsorIndex = requests.findIndex((r) => r.url.endsWith('/paymaster/sponsor'))
            const sendIndex = requests.findIndex((r) => r.body.method === 'eth_sendUserOperation')
            expect(stubIndex).toBeLessThan(estimateIndex)
            expect(estimateIndex).toBeLessThan(sponsorIndex)
            expect(sponsorIndex).toBeLessThan(sendIndex)
            expect(requests[sponsorIndex].body.userOperation.signature).toBe('0x')
            expect(requests[sponsorIndex].body.userOperation.eip7702Auth).toBeUndefined()
            expect(requests[sendIndex].body.params[0].signature).toHaveLength(132)
            expect(requests[sendIndex].body.params[0].maxPriorityFeePerGas).toBe('0x3b9aca00')
            expect(requests[sendIndex].body.params[0].maxFeePerGas).toBe('0x77359400')
            expect(requests[sendIndex].url).toBe('https://bundler.example/')
            expect(requests.filter((r) => r.url.startsWith('http://localhost:3001')).every(
                (r) => !JSON.stringify(r.body).includes(locallySignedHash),
            )).toBe(true)
            expect(walletClient.request).toHaveBeenCalledTimes(onChainCode === '0x' ? 1 : 0)
        },
    )
})
