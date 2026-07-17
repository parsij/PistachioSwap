import {
    createMultichainClient,
    RPCInvokeMethodErr,
} from '@metamask/connect-multichain'
import {
    getAddress,
    isAddress,
    parseTransaction,
    recoverTransactionAddress,
} from 'viem'

export const METAMASK_BSC_SCOPE = 'eip155:56'
const SIGN_TRANSACTION_METHOD = 'eth_signTransaction'
const PREPARED_TRANSACTION_KEYS = new Set([
    'type',
    'chainId',
    'from',
    'to',
    'nonce',
    'gas',
    'gasPrice',
    'value',
    'data',
])
const subscribers = new Set()

let clientPromise = null
let clientInstance = null
let session = null
let removeSessionListener = null
let verifiedFingerprint = null
let connectPromise = null
let signaturePromise = null
let allowTestInitialization = false

function flag(name) {
    return String(import.meta.env[name] ?? '').trim().toLowerCase() === 'true'
}

export function isMetaMaskMultichainEnabled() {
    return flag('VITE_METAMASK_MULTICHAIN_ENABLED')
}

function makeError(code, message, details) {
    const error = new Error(message)
    error.code = code
    if (details) error.details = details
    return error
}

function normalizedAddress(value) {
    return isAddress(value ?? '') ? getAddress(value).toLowerCase() : null
}

function sessionMaterialFingerprint(value) {
    if (!value?.sessionScopes) return null
    return JSON.stringify({
        scopes: Object.entries(value.sessionScopes).sort(([left], [right]) => left.localeCompare(right)).map(([scope, details]) => ({
            scope,
            accounts: [...(details.accounts ?? [])].map((account) => account.toLowerCase()).sort(),
            methods: [...(details.methods ?? [])].sort(),
            notifications: [...(details.notifications ?? [])].sort(),
        })),
        expiry: value.expiry ?? null,
        scopedProperties: value.scopedProperties ?? null,
        sessionProperties: value.sessionProperties ?? null,
    })
}

export function validatePublicBscRpcUrl(value = import.meta.env.VITE_BSC_PUBLIC_RPC_URL) {
    const configured = String(value ?? '').trim()
    if (!configured) {
        throw makeError(
            'METAMASK_MULTICHAIN_PUBLIC_RPC_REQUIRED',
            'A public BNB Chain RPC URL is required for MetaMask sponsored signing.',
        )
    }

    let url
    try {
        url = new URL(configured)
    } catch {
        throw makeError('METAMASK_MULTICHAIN_PUBLIC_RPC_INVALID', 'The public BNB Chain RPC URL is invalid.')
    }
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(import.meta.env.DEV && isLocalhost && url.protocol === 'http:')) {
        throw makeError('METAMASK_MULTICHAIN_PUBLIC_RPC_INVALID', 'The public BNB Chain RPC URL must use HTTPS.')
    }
    if (url.username || url.password || url.hostname.toLowerCase().includes('nodereal')) {
        throw makeError(
            'METAMASK_MULTICHAIN_PRIVATE_RPC_FORBIDDEN',
            'NodeReal and credential-bearing RPC URLs are not allowed in browser configuration.',
        )
    }
    return url.toString()
}

function notifySessionChanged(nextSession) {
    const normalizedSession = nextSession?.sessionScopes ? nextSession : null
    if (sessionMaterialFingerprint(session) !== sessionMaterialFingerprint(normalizedSession)) {
        verifiedFingerprint = null
    }
    session = normalizedSession
    for (const subscriber of subscribers) subscriber(session)
}

function publishVerifiedSession() {
    if (session) session = { ...session, sessionScopes: { ...session.sessionScopes } }
    for (const subscriber of subscribers) subscriber(session)
}

function sessionFingerprint(value, account) {
    const scope = value?.sessionScopes?.[METAMASK_BSC_SCOPE]
    if (!scope || !account) return null
    return JSON.stringify({
        account: account.toLowerCase(),
        accounts: [...(scope.accounts ?? [])].map((item) => item.toLowerCase()).sort(),
        methods: [...(scope.methods ?? [])].sort(),
    })
}

export function subscribeMetaMaskMultichainSession(subscriber) {
    subscribers.add(subscriber)
    return () => subscribers.delete(subscriber)
}

export async function getMetaMaskMultichainClient() {
    if (!isMetaMaskMultichainEnabled()) {
        throw makeError('METAMASK_MULTICHAIN_DISABLED', 'MetaMask sponsored signing is disabled.')
    }
    if (typeof window === 'undefined') {
        throw makeError('METAMASK_MULTICHAIN_BROWSER_REQUIRED', 'MetaMask sponsored signing requires a browser.')
    }
    if (import.meta.env.MODE === 'test' && !allowTestInitialization) {
        throw makeError('METAMASK_MULTICHAIN_TEST_INITIALIZATION_BLOCKED', 'MetaMask Multichain is not initialized in tests.')
    }
    if (!clientPromise) {
        const rpcUrl = validatePublicBscRpcUrl()
        clientPromise = createMultichainClient({
            dapp: {
                name: 'PistachioSwap',
                url: window.location.origin,
                iconUrl: new URL('/favicon.png', window.location.origin).toString(),
            },
            api: {
                supportedNetworks: {
                    [METAMASK_BSC_SCOPE]: rpcUrl,
                },
            },
            analytics: { enabled: false, integrationType: 'direct' },
            ui: {
                preferExtension: true,
                headless: true,
            },
        }).then((client) => {
            clientInstance = client
            if (!removeSessionListener) {
                const listener = (nextSession) => notifySessionChanged(nextSession)
                const remove = client.on('wallet_sessionChanged', listener)
                removeSessionListener = typeof remove === 'function'
                    ? remove
                    : () => client.off('wallet_sessionChanged', listener)
            }
            return client
        }).catch((error) => {
            clientPromise = null
            clientInstance = null
            throw error
        })
    }
    return clientPromise
}

export async function initializeMetaMaskMultichain() {
    const client = await getMetaMaskMultichainClient()
    const restored = await client.provider.getSession()
    notifySessionChanged(restored)
    return session
}

export async function restoreMetaMaskMultichainSession() {
    return initializeMetaMaskMultichain()
}

export function getMetaMaskMultichainSession() {
    return session
}

export async function connectMetaMaskMultichain({ forceRequest = false } = {}) {
    if (connectPromise) return connectPromise
    connectPromise = (async () => {
        const client = await getMetaMaskMultichainClient()
        await client.connect([METAMASK_BSC_SCOPE], [], undefined, forceRequest === true)
        const connectedSession = await client.provider.getSession()
        notifySessionChanged(connectedSession)
        return session
    })().finally(() => {
        connectPromise = null
    })
    return connectPromise
}

export async function disconnectMetaMaskMultichain() {
    if (clientPromise) {
        const client = await clientPromise
        await client.disconnect([METAMASK_BSC_SCOPE])
    }
    notifySessionChanged(null)
}

export function disposeMetaMaskMultichainListeners() {
    removeSessionListener?.()
    removeSessionListener = null
    subscribers.clear()
    notifySessionChanged(null)
}

export function parseBscCaipAccount(accountId) {
    const match = /^eip155:56:(0x[0-9a-fA-F]{40})$/.exec(String(accountId ?? ''))
    return match && isAddress(match[1]) ? getAddress(match[1]) : null
}

export function isMetaMaskConnectorMetadata(connector, walletConnectPeerMetadata) {
    const rdnsValues = Array.isArray(connector?.rdns) ? connector.rdns : [connector?.rdns]
    if (rdnsValues.some((value) => ['io.metamask', 'io.metamask.mobile'].includes(String(value).toLowerCase()))) {
        return true
    }
    const connectorId = String(connector?.id ?? '').toLowerCase()
    if (['io.metamask', 'io.metamask.mobile'].includes(connectorId)) return true

    if (connectorId === 'walletconnect') {
        try {
            const url = new URL(walletConnectPeerMetadata?.url)
            const redirect = String(walletConnectPeerMetadata?.redirect?.native ?? '')
            return (url.protocol === 'https:' && (url.hostname === 'metamask.io' || url.hostname.endsWith('.metamask.io'))) ||
                redirect.startsWith('metamask://')
        } catch {
            return false
        }
    }
    return false
}

export async function identifyMetaMaskAppKitConnector(connector) {
    if (isMetaMaskConnectorMetadata(connector)) return true
    if (String(connector?.id ?? '').toLowerCase() !== 'walletconnect' || typeof connector?.getProvider !== 'function') {
        return false
    }
    try {
        const provider = await connector.getProvider()
        return isMetaMaskConnectorMetadata(connector, provider?.session?.peer?.metadata)
    } catch {
        return false
    }
}

function baseCapability(status, reasonCode = null) {
    return {
        rawTransactionSigningSupported: false,
        method: null,
        transport: null,
        status,
        scope: null,
        account: null,
        approvedMethods: [],
        reasonCode,
    }
}

export function inspectMetaMaskMultichainCapability({
    featureEnabled = isMetaMaskMultichainEnabled(),
    appKitConnected,
    appKitAddress,
    authenticatedWalletAddress = appKitAddress,
    isMetaMask,
    currentSession = session,
} = {}) {
    if (!featureEnabled) return baseCapability('disabled', 'METAMASK_MULTICHAIN_DISABLED')
    if (!appKitConnected || !normalizedAddress(appKitAddress)) {
        return baseCapability('not-connected', 'METAMASK_MULTICHAIN_SESSION_REQUIRED')
    }
    if (!isMetaMask) return baseCapability('not-metamask', 'METAMASK_MULTICHAIN_NOT_METAMASK')
    if (normalizedAddress(appKitAddress) !== normalizedAddress(authenticatedWalletAddress)) {
        return baseCapability('account-mismatch', 'METAMASK_MULTICHAIN_ACCOUNT_MISMATCH')
    }
    if (!currentSession?.sessionScopes) {
        return baseCapability('not-connected', 'METAMASK_MULTICHAIN_SESSION_REQUIRED')
    }
    const scope = currentSession.sessionScopes[METAMASK_BSC_SCOPE]
    if (!scope) return baseCapability('scope-missing', 'METAMASK_MULTICHAIN_BSC_SCOPE_MISSING')

    const methods = Array.isArray(scope.methods) ? [...scope.methods] : []
    const accounts = Array.isArray(scope.accounts) ? scope.accounts : []
    const parsedAccounts = accounts.map(parseBscCaipAccount)
    if (accounts.length === 0 || parsedAccounts.some((account) => !account)) {
        return {
            ...baseCapability('unsupported', 'METAMASK_MULTICHAIN_ACCOUNT_MALFORMED'),
            scope: METAMASK_BSC_SCOPE,
            approvedMethods: methods,
        }
    }
    const expected = normalizedAddress(appKitAddress)
    const matching = parsedAccounts.find((account) => normalizedAddress(account) === expected)
    if (!matching) {
        return {
            ...baseCapability('account-mismatch', 'METAMASK_MULTICHAIN_ACCOUNT_MISMATCH'),
            scope: METAMASK_BSC_SCOPE,
            account: parsedAccounts[0],
            approvedMethods: methods,
        }
    }
    if (!methods.includes(SIGN_TRANSACTION_METHOD)) {
        return {
            ...baseCapability('method-missing', 'METAMASK_MULTICHAIN_SIGN_TRANSACTION_NOT_AUTHORIZED'),
            scope: METAMASK_BSC_SCOPE,
            account: matching,
            approvedMethods: methods,
        }
    }
    const fingerprint = sessionFingerprint(currentSession, matching)
    const verified = fingerprint !== null && fingerprint === verifiedFingerprint
    return {
        rawTransactionSigningSupported: true,
        method: SIGN_TRANSACTION_METHOD,
        transport: 'metamask-connect-multichain',
        status: verified ? 'verified' : 'ready-unverified',
        scope: METAMASK_BSC_SCOPE,
        account: matching,
        approvedMethods: methods,
        reasonCode: null,
    }
}

function requireQuantity(value, field) {
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
        throw makeError('WALLET_SIGNED_TRANSACTION_MISMATCH', `The backend ${field} is invalid.`)
    }
    return value
}

export function normalizePreparedSponsoredTransaction(preparedTransaction, authenticatedWalletAddress) {
    if (!preparedTransaction || typeof preparedTransaction !== 'object' || Array.isArray(preparedTransaction)) {
        throw makeError('WALLET_SIGNED_TRANSACTION_MISMATCH', 'The backend prepared transaction is invalid.')
    }
    const keys = Object.keys(preparedTransaction)
    if (keys.length !== PREPARED_TRANSACTION_KEYS.size || keys.some((key) => !PREPARED_TRANSACTION_KEYS.has(key))) {
        throw makeError('WALLET_SIGNED_TRANSACTION_MISMATCH', 'The backend prepared transaction contains unsupported fields.')
    }
    const expectedWallet = normalizedAddress(authenticatedWalletAddress)
    const from = normalizedAddress(preparedTransaction.from)
    if (!expectedWallet || from !== expectedWallet) {
        throw makeError('METAMASK_MULTICHAIN_ACCOUNT_MISMATCH', 'The prepared transaction wallet does not match the authenticated wallet.')
    }
    if (!isAddress(preparedTransaction.to ?? '')) {
        throw makeError('WALLET_REWROTE_DESTINATION', 'The prepared transaction destination is invalid.')
    }
    const chainId = typeof preparedTransaction.chainId === 'number'
        ? preparedTransaction.chainId
        : Number(BigInt(requireQuantity(preparedTransaction.chainId, 'chain ID')))
    if (chainId !== 56) throw makeError('WALLET_REWROTE_CHAIN_ID', 'The prepared transaction is not for BNB Chain.')
    if (!['0x0', 'legacy', 0].includes(preparedTransaction.type)) {
        throw makeError('WALLET_REWROTE_TRANSACTION_TYPE', 'The prepared transaction must be legacy type 0.')
    }
    if (BigInt(requireQuantity(preparedTransaction.gasPrice, 'gas price')) !== 0n) {
        throw makeError('WALLET_REWROTE_GAS_PRICE', 'The prepared transaction gas price must be zero.')
    }
    if (typeof preparedTransaction.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(preparedTransaction.data)) {
        throw makeError('WALLET_REWROTE_CALLDATA', 'The prepared transaction calldata is invalid.')
    }
    return {
        type: '0x0',
        chainId: '0x38',
        from: preparedTransaction.from,
        to: preparedTransaction.to,
        nonce: requireQuantity(preparedTransaction.nonce, 'nonce'),
        gas: requireQuantity(preparedTransaction.gas, 'gas limit'),
        gasPrice: '0x0',
        value: requireQuantity(preparedTransaction.value, 'value'),
        data: preparedTransaction.data,
    }
}

function mismatch(code, message) {
    throw makeError(code, message)
}

export async function validateSignedPreparedTransaction({
    signedRawTransaction,
    normalizedTransaction,
    authenticatedWalletAddress,
    multichainAccount,
}) {
    if (typeof signedRawTransaction !== 'string' || !/^0x[0-9a-f]+$/i.test(signedRawTransaction) ||
        signedRawTransaction.length < 132 || signedRawTransaction.length % 2 !== 0) {
        mismatch('WALLET_RAW_TRANSACTION_MALFORMED', 'The wallet returned a malformed signed transaction.')
    }
    let parsed
    let signer
    try {
        parsed = parseTransaction(signedRawTransaction)
        signer = await recoverTransactionAddress({ serializedTransaction: signedRawTransaction })
    } catch {
        mismatch('WALLET_RAW_TRANSACTION_MALFORMED', 'The wallet returned a malformed signed transaction.')
    }

    const expectedWallet = normalizedAddress(authenticatedWalletAddress)
    if (normalizedAddress(signer) !== expectedWallet || normalizedAddress(signer) !== normalizedAddress(multichainAccount)) {
        mismatch('WALLET_SIGNER_MISMATCH', 'The signed transaction account does not match the connected wallet.')
    }
    if (parsed.chainId !== 56) mismatch('WALLET_REWROTE_CHAIN_ID', 'The wallet changed the transaction chain ID.')
    if (parsed.type === 'eip1559' || parsed.maxFeePerGas != null || parsed.maxPriorityFeePerGas != null) mismatch('WALLET_ADDED_EIP1559_FIELDS', 'The wallet added EIP-1559 fee fields.')
    if (parsed.accessList?.length) mismatch('WALLET_ADDED_ACCESS_LIST', 'The wallet added an access list.')
    if (parsed.type !== 'legacy') mismatch('WALLET_REWROTE_TRANSACTION_TYPE', 'The wallet changed the transaction type.')
    if (BigInt(parsed.nonce) !== BigInt(normalizedTransaction.nonce)) mismatch('WALLET_REWROTE_NONCE', 'The wallet changed the transaction nonce.')
    if (!parsed.to || normalizedAddress(parsed.to) !== normalizedAddress(normalizedTransaction.to)) mismatch('WALLET_REWROTE_DESTINATION', 'The wallet changed the transaction destination.')
    if ((parsed.data ?? '0x').toLowerCase() !== normalizedTransaction.data.toLowerCase()) mismatch('WALLET_REWROTE_CALLDATA', 'The wallet changed the transaction calldata.')
    if ((parsed.value ?? 0n) !== BigInt(normalizedTransaction.value)) mismatch('WALLET_REWROTE_VALUE', 'The wallet changed the transaction value.')
    if (parsed.gas !== BigInt(normalizedTransaction.gas)) mismatch('WALLET_REWROTE_GAS_LIMIT', 'The wallet changed the transaction gas limit.')
    if ((parsed.gasPrice ?? 0n) !== 0n) mismatch('WALLET_REWROTE_GAS_PRICE', 'The wallet changed the zero gas price.')
    return { signer: getAddress(signer), parsed }
}

function rawResult(result) {
    if (typeof result === 'string' && /^0x[0-9a-f]+$/i.test(result)) return result
    throw makeError(
        'METAMASK_MULTICHAIN_RAW_TRANSACTION_NOT_RETURNED',
        'MetaMask did not return a complete serialized signed transaction.',
    )
}

export function sanitizeMetaMaskMultichainError(error) {
    if (error?.code && String(error.code).startsWith('WALLET_')) return error
    if (error?.code && String(error.code).startsWith('METAMASK_MULTICHAIN_')) return error
    const rpcCode = error instanceof RPCInvokeMethodErr ? error.rpcCode : error?.code
    const reason = String(error instanceof RPCInvokeMethodErr ? error.reason : error?.message ?? '').toLowerCase()
    if (rpcCode === 4001 || reason.includes('reject')) {
        return makeError('USER_REJECTED_SIGNATURE', 'The MetaMask signature request was rejected.', {
            rpcCode: 4001,
            userRejected: true,
            methodUnavailable: false,
        })
    }
    if (rpcCode === -32601 || reason.includes('method') && (reason.includes('unavailable') || reason.includes('not found') || reason.includes('unsupported'))) {
        return makeError('METAMASK_MULTICHAIN_SIGN_TRANSACTION_UNAVAILABLE', 'This MetaMask version does not provide raw transaction signing.', {
            rpcCode: rpcCode ?? null,
            userRejected: false,
            methodUnavailable: true,
        })
    }
    return makeError('METAMASK_MULTICHAIN_ERROR', 'MetaMask sponsored signing failed.', {
        rpcCode: typeof rpcCode === 'number' ? rpcCode : null,
        userRejected: false,
        methodUnavailable: false,
    })
}

export async function signMetaMaskMultichainTransaction({
    preparedTransaction,
    authenticatedWalletAddress,
    appKitAddress = authenticatedWalletAddress,
    isMetaMask = false,
}) {
    if (signaturePromise) throw makeError('WALLET_SIGNATURE_IN_PROGRESS', 'A transaction signature request is already in progress.')
    signaturePromise = (async () => {
        const client = await getMetaMaskMultichainClient()
        const activeSession = await client.provider.getSession()
        notifySessionChanged(activeSession)
        const capability = inspectMetaMaskMultichainCapability({
            appKitConnected: true,
            appKitAddress,
            authenticatedWalletAddress,
            isMetaMask,
            currentSession: activeSession,
        })
        if (!capability.rawTransactionSigningSupported) {
            throw makeError(capability.reasonCode, 'The active MetaMask Multichain session cannot sign this transaction.')
        }
        const requestedFingerprint = sessionFingerprint(activeSession, capability.account)
        const normalizedTransaction = normalizePreparedSponsoredTransaction(preparedTransaction, authenticatedWalletAddress)
        let result
        try {
            result = await client.invokeMethod({
                scope: METAMASK_BSC_SCOPE,
                request: {
                    method: SIGN_TRANSACTION_METHOD,
                    params: [normalizedTransaction],
                },
            })
        } catch (error) {
            throw sanitizeMetaMaskMultichainError(error)
        }
        const signedRawTransaction = rawResult(result)
        if (sessionFingerprint(session, capability.account) !== requestedFingerprint) {
            throw makeError('METAMASK_MULTICHAIN_SESSION_REQUIRED', 'The MetaMask Multichain session changed during signing.')
        }
        await validateSignedPreparedTransaction({
            signedRawTransaction,
            normalizedTransaction,
            authenticatedWalletAddress,
            multichainAccount: capability.account,
        })
        verifiedFingerprint = sessionFingerprint(activeSession, capability.account)
        publishVerifiedSession()
        return signedRawTransaction
    })().finally(() => {
        signaturePromise = null
    })
    return signaturePromise
}

export const metamaskMultichainInternals = {
    reset() {
        disposeMetaMaskMultichainListeners()
        clientPromise = null
        clientInstance = null
        connectPromise = null
        signaturePromise = null
        verifiedFingerprint = null
        allowTestInitialization = false
    },
    allowTestInitialization(value = true) {
        allowTestInitialization = value
    },
    get client() {
        return clientInstance
    },
    get verifiedFingerprint() {
        return verifiedFingerprint
    },
}
