// @vitest-environment jsdom

import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@metamask/connect-multichain', async (importOriginal) => ({
    ...await importOriginal(),
    createMultichainClient: sdk.create,
}))

import {
    connectMetaMaskMultichain,
    disconnectMetaMaskMultichain,
    getMetaMaskMultichainClient,
    initializeMetaMaskMultichain,
    inspectMetaMaskMultichainCapability,
    isMetaMaskConnectorMetadata,
    METAMASK_BSC_SCOPE,
    metamaskMultichainInternals,
    normalizePreparedSponsoredTransaction,
    parseBscCaipAccount,
    sanitizeMetaMaskMultichainError,
    signMetaMaskMultichainTransaction,
    subscribeMetaMaskMultichainSession,
    validatePublicBscRpcUrl,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'

const wallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const otherWallet = privateKeyToAccount('0x8b3a350cf5c34c9194ca3a545d73a0955e5b9c2f8a4b7d5b4d3b2a1908171615')
const destination = '0x2222222222222222222222222222222222222222'
const session = (overrides = {}) => ({
    sessionScopes: {
        [METAMASK_BSC_SCOPE]: {
            accounts: [`${METAMASK_BSC_SCOPE}:${wallet.address}`],
            methods: ['eth_signTransaction'],
            notifications: [],
            ...overrides,
        },
    },
})
const prepared = (overrides = {}) => ({
    type: '0x0',
    chainId: '0x38',
    from: wallet.address,
    to: destination,
    nonce: '0x7',
    gas: '0x186a0',
    gasPrice: '0x0',
    value: '0x2a',
    data: '0x1234',
    ...overrides,
})

function client(currentSession = session()) {
    const listeners = new Map()
    return {
        provider: { getSession: vi.fn().mockResolvedValue(currentSession) },
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        invokeMethod: vi.fn(),
        on: vi.fn((event, listener) => {
            listeners.set(event, listener)
            return () => listeners.delete(event)
        }),
        off: vi.fn(),
        emit(event, value) { listeners.get(event)?.(value) },
    }
}

async function signed(overrides = {}, account = wallet) {
    return account.signTransaction({
        chainId: 56,
        type: 'legacy',
        nonce: 7,
        gas: 100_000n,
        gasPrice: 0n,
        to: destination,
        value: 42n,
        data: '0x1234',
        ...overrides,
    })
}

beforeEach(() => {
    metamaskMultichainInternals.reset()
    metamaskMultichainInternals.allowTestInitialization()
    vi.stubEnv('VITE_METAMASK_MULTICHAIN_ENABLED', 'true')
    vi.stubEnv('VITE_BSC_PUBLIC_RPC_URL', 'https://bsc-dataseed.binance.org')
    sdk.create.mockReset()
})

describe('MetaMask Multichain initialization and sessions', () => {
    it('does not initialize when disabled', async () => {
        vi.stubEnv('VITE_METAMASK_MULTICHAIN_ENABLED', 'false')
        await expect(getMetaMaskMultichainClient()).rejects.toMatchObject({ code: 'METAMASK_MULTICHAIN_DISABLED' })
        expect(sdk.create).not.toHaveBeenCalled()
    })

    it('creates one client with exact dapp metadata and the public BSC scope mapping', async () => {
        const mock = client()
        sdk.create.mockResolvedValue(mock)
        await Promise.all([getMetaMaskMultichainClient(), getMetaMaskMultichainClient()])
        expect(sdk.create).toHaveBeenCalledOnce()
        expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({
            dapp: {
                name: 'PistachioSwap',
                url: window.location.origin,
                iconUrl: `${window.location.origin}/favicon.png`,
            },
            api: { supportedNetworks: { [METAMASK_BSC_SCOPE]: 'https://bsc-dataseed.binance.org/' } },
            analytics: { enabled: false, integrationType: 'direct' },
            ui: { preferExtension: true, headless: true },
        }))
        expect(mock.on).toHaveBeenCalledOnce()
    })

    it('restores an existing session without auto-connecting and publishes session changes once', async () => {
        const mock = client()
        sdk.create.mockResolvedValue(mock)
        const observer = vi.fn()
        const unsubscribe = subscribeMetaMaskMultichainSession(observer)
        await initializeMetaMaskMultichain()
        expect(mock.provider.getSession).toHaveBeenCalledOnce()
        expect(mock.connect).not.toHaveBeenCalled()
        mock.emit('wallet_sessionChanged', undefined)
        expect(observer).toHaveBeenLastCalledWith(null)
        unsubscribe()
    })

    it('requests only BSC with empty account IDs and forces only an explicit reconnect', async () => {
        const mock = client()
        sdk.create.mockResolvedValue(mock)
        await connectMetaMaskMultichain()
        expect(mock.connect).toHaveBeenLastCalledWith([METAMASK_BSC_SCOPE], [], undefined, false)
        await connectMetaMaskMultichain({ forceRequest: true })
        expect(mock.connect).toHaveBeenLastCalledWith([METAMASK_BSC_SCOPE], [], undefined, true)
        await disconnectMetaMaskMultichain()
        expect(mock.disconnect).toHaveBeenCalledWith([METAMASK_BSC_SCOPE])
    })

    it('rejects non-HTTPS, credential-bearing, and NodeReal browser RPC URLs', () => {
        expect(() => validatePublicBscRpcUrl('http://rpc.example')).toThrow(/HTTPS/)
        expect(() => validatePublicBscRpcUrl('https://user:secret@rpc.example')).toThrow(/not allowed/)
        expect(() => validatePublicBscRpcUrl('https://bsc-mainnet.nodereal.io/v1/secret')).toThrow(/not allowed/)
    })
})

describe('MetaMask identity and capability inspection', () => {
    const context = (overrides = {}) => ({
        featureEnabled: true,
        appKitConnected: true,
        appKitAddress: wallet.address,
        authenticatedWalletAddress: wallet.address,
        isMetaMask: true,
        currentSession: session(),
        ...overrides,
    })

    it('uses RDNS or verified WalletConnect peer metadata and never isMetaMask alone', () => {
        expect(isMetaMaskConnectorMetadata({ rdns: 'io.metamask', isMetaMask: false })).toBe(true)
        expect(isMetaMaskConnectorMetadata({ id: 'walletConnect' }, { url: 'https://metamask.io' })).toBe(true)
        expect(isMetaMaskConnectorMetadata({ id: 'injected', isMetaMask: true, name: 'MetaMask' })).toBe(false)
    })

    it.each([
        ['not-metamask', { isMetaMask: false }, 'METAMASK_MULTICHAIN_NOT_METAMASK'],
        ['not-connected', { appKitConnected: false }, 'METAMASK_MULTICHAIN_SESSION_REQUIRED'],
        ['not-connected', { currentSession: null }, 'METAMASK_MULTICHAIN_SESSION_REQUIRED'],
        ['scope-missing', { currentSession: { sessionScopes: {} } }, 'METAMASK_MULTICHAIN_BSC_SCOPE_MISSING'],
        ['method-missing', { currentSession: session({ methods: ['personal_sign'] }) }, 'METAMASK_MULTICHAIN_SIGN_TRANSACTION_NOT_AUTHORIZED'],
        ['account-mismatch', { currentSession: session({ accounts: [`${METAMASK_BSC_SCOPE}:${otherWallet.address}`] }) }, 'METAMASK_MULTICHAIN_ACCOUNT_MISMATCH'],
        ['unsupported', { currentSession: session({ accounts: ['eip155:56:not-an-address'] }) }, 'METAMASK_MULTICHAIN_ACCOUNT_MALFORMED'],
    ])('returns %s when its invariant fails', (status, overrides, reasonCode) => {
        expect(inspectMetaMaskMultichainCapability(context(overrides))).toMatchObject({
            rawTransactionSigningSupported: false,
            status,
            reasonCode,
        })
    })

    it('returns ready-unverified only for an exact account and approved method', () => {
        expect(inspectMetaMaskMultichainCapability(context())).toMatchObject({
            rawTransactionSigningSupported: true,
            method: 'eth_signTransaction',
            transport: 'metamask-connect-multichain',
            status: 'ready-unverified',
            scope: METAMASK_BSC_SCOPE,
            account: wallet.address,
        })
        expect(parseBscCaipAccount(`${METAMASK_BSC_SCOPE}:${wallet.address}`)).toBe(wallet.address)
    })
})

describe('prepared transaction normalization', () => {
    it('preserves the authoritative legacy BSC fields and omits EIP-1559 fields', () => {
        expect(normalizePreparedSponsoredTransaction(prepared(), wallet.address)).toEqual(prepared())
        expect(normalizePreparedSponsoredTransaction(prepared(), wallet.address)).not.toHaveProperty('maxFeePerGas')
    })

    it.each([
        ['wrong chain', { chainId: '0x61' }, 'WALLET_REWROTE_CHAIN_ID'],
        ['nonzero gas price', { gasPrice: '0x1' }, 'WALLET_REWROTE_GAS_PRICE'],
        ['wrong from', { from: otherWallet.address }, 'METAMASK_MULTICHAIN_ACCOUNT_MISMATCH'],
        ['arbitrary field', { arbitrary: '0x1' }, 'WALLET_SIGNED_TRANSACTION_MISMATCH'],
        ['EIP-1559 field', { maxFeePerGas: '0x0' }, 'WALLET_SIGNED_TRANSACTION_MISMATCH'],
    ])('rejects %s', (_label, overrides, code) => {
        expect(() => normalizePreparedSponsoredTransaction(prepared(overrides), wallet.address)).toThrow(expect.objectContaining({ code }))
    })
})

describe('signing request and exact post-signature validation', () => {
    it('invokes eth_signTransaction through the Multichain client and marks the current session verified', async () => {
        const mock = client()
        mock.invokeMethod.mockResolvedValue(await signed())
        sdk.create.mockResolvedValue(mock)
        const injectedRequest = vi.fn()
        window.ethereum = { request: injectedRequest }
        await expect(signMetaMaskMultichainTransaction({
            preparedTransaction: prepared(),
            authenticatedWalletAddress: wallet.address,
            isMetaMask: true,
        })).resolves.toMatch(/^0x/)
        expect(mock.invokeMethod).toHaveBeenCalledWith({
            scope: METAMASK_BSC_SCOPE,
            request: { method: 'eth_signTransaction', params: [prepared()] },
        })
        expect(injectedRequest).not.toHaveBeenCalled()
        expect(inspectMetaMaskMultichainCapability({
            featureEnabled: true,
            appKitConnected: true,
            appKitAddress: wallet.address,
            authenticatedWalletAddress: wallet.address,
            isMetaMask: true,
            currentSession: session(),
        }).status).toBe('verified')
        mock.emit('wallet_sessionChanged', session({ methods: ['eth_signTransaction', 'eth_accounts'] }))
        expect(inspectMetaMaskMultichainCapability({
            featureEnabled: true,
            appKitConnected: true,
            appKitAddress: wallet.address,
            authenticatedWalletAddress: wallet.address,
            isMetaMask: true,
            currentSession: session({ methods: ['eth_signTransaction', 'eth_accounts'] }),
        }).status).toBe('ready-unverified')
    })

    it.each([
        ['signer', {}, otherWallet, 'WALLET_SIGNER_MISMATCH'],
        ['chain ID', { chainId: 97 }, wallet, 'WALLET_REWROTE_CHAIN_ID'],
        ['nonce', { nonce: 8 }, wallet, 'WALLET_REWROTE_NONCE'],
        ['destination', { to: otherWallet.address }, wallet, 'WALLET_REWROTE_DESTINATION'],
        ['calldata', { data: '0xabcd' }, wallet, 'WALLET_REWROTE_CALLDATA'],
        ['value', { value: 43n }, wallet, 'WALLET_REWROTE_VALUE'],
        ['gas limit', { gas: 99_999n }, wallet, 'WALLET_REWROTE_GAS_LIMIT'],
        ['gas price', { gasPrice: 1n }, wallet, 'WALLET_REWROTE_GAS_PRICE'],
    ])('rejects a rewritten %s', async (_label, overrides, account, code) => {
        await expect(validateSignedPreparedTransaction({
            signedRawTransaction: await signed(overrides, account),
            normalizedTransaction: prepared(),
            authenticatedWalletAddress: wallet.address,
            multichainAccount: wallet.address,
        })).rejects.toMatchObject({ code })
    })

    it('rejects EIP-1559 fields, access lists, and malformed raw bytes', async () => {
        const eip1559 = await wallet.signTransaction({
            chainId: 56, type: 'eip1559', nonce: 7, gas: 100_000n, maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n, to: destination, value: 42n, data: '0x1234',
        })
        await expect(validateSignedPreparedTransaction({
            signedRawTransaction: eip1559, normalizedTransaction: prepared(),
            authenticatedWalletAddress: wallet.address, multichainAccount: wallet.address,
        })).rejects.toMatchObject({ code: 'WALLET_ADDED_EIP1559_FIELDS' })
        const accessList = await wallet.signTransaction({
            chainId: 56, type: 'eip2930', nonce: 7, gas: 100_000n, gasPrice: 0n,
            to: destination, value: 42n, data: '0x1234', accessList: [{ address: destination, storageKeys: [] }],
        })
        await expect(validateSignedPreparedTransaction({
            signedRawTransaction: accessList, normalizedTransaction: prepared(),
            authenticatedWalletAddress: wallet.address, multichainAccount: wallet.address,
        })).rejects.toMatchObject({ code: 'WALLET_ADDED_ACCESS_LIST' })
        await expect(validateSignedPreparedTransaction({
            signedRawTransaction: '0x1234', normalizedTransaction: prepared(),
            authenticatedWalletAddress: wallet.address, multichainAccount: wallet.address,
        })).rejects.toMatchObject({ code: 'WALLET_RAW_TRANSACTION_MALFORMED' })
    })

    it('rejects partial signature objects and concurrent signature requests', async () => {
        const mock = client()
        let release
        mock.invokeMethod.mockReturnValue(new Promise((resolve) => { release = resolve }))
        sdk.create.mockResolvedValue(mock)
        const first = signMetaMaskMultichainTransaction({ preparedTransaction: prepared(), authenticatedWalletAddress: wallet.address, isMetaMask: true })
        await Promise.resolve()
        await expect(signMetaMaskMultichainTransaction({ preparedTransaction: prepared(), authenticatedWalletAddress: wallet.address, isMetaMask: true }))
            .rejects.toMatchObject({ code: 'WALLET_SIGNATURE_IN_PROGRESS' })
        release({ r: '0x1', s: '0x2', v: '0x1b' })
        await expect(first).rejects.toMatchObject({ code: 'METAMASK_MULTICHAIN_RAW_TRANSACTION_NOT_RETURNED' })
    })

    it('rejects a completed signature if the Multichain session changed while MetaMask was open', async () => {
        const mock = client()
        let release
        mock.invokeMethod.mockReturnValue(new Promise((resolve) => { release = resolve }))
        sdk.create.mockResolvedValue(mock)
        const request = signMetaMaskMultichainTransaction({
            preparedTransaction: prepared(),
            authenticatedWalletAddress: wallet.address,
            isMetaMask: true,
        })
        await vi.waitFor(() => expect(mock.invokeMethod).toHaveBeenCalledOnce())
        mock.emit('wallet_sessionChanged', session({ accounts: [`${METAMASK_BSC_SCOPE}:${otherWallet.address}`] }))
        release(await signed())
        await expect(request).rejects.toMatchObject({ code: 'METAMASK_MULTICHAIN_SESSION_REQUIRED' })
    })

    it('maps user rejection and missing methods without exposing RPC data', () => {
        expect(sanitizeMetaMaskMultichainError({ code: 4001, message: 'Rejected' })).toMatchObject({ code: 'USER_REJECTED_SIGNATURE' })
        const unavailable = sanitizeMetaMaskMultichainError({ code: -32601, message: 'Method not found', data: { secret: true } })
        expect(unavailable).toMatchObject({ code: 'METAMASK_MULTICHAIN_SIGN_TRANSACTION_UNAVAILABLE' })
        expect(unavailable.details).not.toHaveProperty('data')
    })
})
