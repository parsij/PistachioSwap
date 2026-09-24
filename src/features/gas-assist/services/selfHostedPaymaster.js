import {
    concatHex,
    decodeFunctionData,
    decodeFunctionResult,
    encodeFunctionData,
    erc20Abi,
    getAddress,
    hashTypedData,
    isAddress,
    numberToHex,
    parseSignature,
    recoverTypedDataAddress,
} from 'viem'
import { hashAuthorization } from 'viem/utils'

import { getGasAssistBaseUrl } from './gasAssist.js'

const CHAIN_ID = 56
const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const FACTORY_MARKER = '0x7702000000000000000000000000000000000000'
const TRUSTED_DELEGATE = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const AUTH_METHOD = 'pistachio_signSelfHostedAuthorization'
const HEX = /^0x(?:[0-9a-f]{2})*$/iu
const HASH = /^0x[0-9a-f]{64}$/iu
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu
const UINT128_MAX = (1n << 128n) - 1n
const DUMMY_SIGNATURE = '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c'
const SIMPLE_ACCOUNT_ABI = [{
    type: 'function',
    name: 'executeBatch',
    stateMutability: 'nonpayable',
    inputs: [{
        name: 'calls',
        type: 'tuple[]',
        components: [
            { name: 'target', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
        ],
    }],
    outputs: [],
}]
const ENTRY_POINT_ABI = [{
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'sender' }, { type: 'uint192', name: 'key' }],
    outputs: [{ type: 'uint256', name: 'nonce' }],
}]
const USEROP_TYPES = {
    PackedUserOperation: [
        { name: 'sender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'initCode', type: 'bytes' },
        { name: 'callData', type: 'bytes' },
        { name: 'accountGasLimits', type: 'bytes32' },
        { name: 'preVerificationGas', type: 'uint256' },
        { name: 'gasFees', type: 'bytes32' },
        { name: 'paymasterAndData', type: 'bytes' },
    ],
}
function deny(code, message) {
    const error = new Error(message)
    error.code = code
    throw error
}
function address(value, name) {
    if (!isAddress(value ?? '')) deny('PAYMASTER_INTENT_INVALID', `${name} is not an EVM address.`)
    return getAddress(value)
}
function quantity(value, name, max = UINT128_MAX) {
    if (!QUANTITY.test(String(value ?? ''))) deny('PAYMASTER_USEROP_INVALID', `${name} is not a canonical RPC quantity.`)
    const numeric = BigInt(value)
    if (numeric > max) deny('PAYMASTER_USEROP_INVALID', `${name} exceeds its field limit.`)
    return numeric
}
function hex(value, name) {
    if (!HEX.test(String(value ?? ''))) deny('PAYMASTER_USEROP_INVALID', `${name} is not valid bytes.`)
    return value.toLowerCase()
}
function publicRpcUrl(value, name) {
    let parsed
    try {
        parsed = new URL(String(value ?? '').trim())
    } catch {
        deny('PAYMASTER_RPC_NOT_CONFIGURED', `${name} must be configured.`)
    }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
        deny('PAYMASTER_RPC_UNSAFE', `${name} must be a public HTTPS RPC URL without URL credentials or query secrets.`)
    }
    return parsed.href
}
function frontendConfig(backend) {
    if (import.meta.env?.VITE_GAS_ASSIST_ENABLED !== 'true' ||
        import.meta.env?.VITE_SELF_HOSTED_PAYMASTER_ENABLED !== 'true' ||
        backend?.provider !== 'pistachio-paymaster-v08' ||
        backend?.execution !== 'erc4337-v08-eip7702-direct') {
        deny('SELF_HOSTED_PAYMASTER_DISABLED', 'The self-hosted Paymaster is not enabled in this browser and backend.')
    }
    const entryPoint = address(import.meta.env.VITE_ENTRYPOINT_V08_ADDRESS, 'EntryPoint')
    const delegate = address(import.meta.env.VITE_SIMPLE_7702_ACCOUNT_ADDRESS, 'trusted delegate')
    const paymaster = address(import.meta.env.VITE_PISTACHIO_PAYMASTER_ADDRESS, 'Paymaster')
    if (entryPoint !== getAddress(ENTRY_POINT) ||
        delegate !== getAddress(TRUSTED_DELEGATE) ||
        entryPoint !== address(backend.entryPoint, 'backend EntryPoint') ||
        delegate !== address(backend.delegate, 'backend delegate') ||
        paymaster !== address(backend.paymaster, 'backend Paymaster') ||
        address(backend.eip7702Factory, 'factory marker') !== getAddress(FACTORY_MARKER)) {
        deny('PAYMASTER_CONFIG_MISMATCH', 'The browser and backend disagree about the trusted ERC-4337 deployment.')
    }
    return {
        entryPoint, delegate, paymaster,
        publicRpc: publicRpcUrl(import.meta.env.VITE_BSC_PUBLIC_RPC_URL, 'VITE_BSC_PUBLIC_RPC_URL'),
        bundlerRpc: publicRpcUrl(import.meta.env.VITE_BSC_BUNDLER_RPC_URL, 'VITE_BSC_BUNDLER_RPC_URL'),
    }
}
export function selfHostedFrontendEnabled(config) {
    return import.meta.env?.VITE_GAS_ASSIST_ENABLED === 'true' &&
        import.meta.env?.VITE_SELF_HOSTED_PAYMASTER_ENABLED === 'true' &&
        config?.provider === 'pistachio-paymaster-v08' &&
        config?.execution === 'erc4337-v08-eip7702-direct'
}
export function validateSelfHostedPrepared(prepared, order, settings) {
    if (!prepared || prepared.provider !== 'pistachio-paymaster-v08' ||
        prepared.execution !== 'erc4337-v08-eip7702-direct' ||
        prepared.stage !== 'direct' || prepared.paymentMode !== 'sponsored' ||
        Number(prepared.chainId) !== CHAIN_ID || prepared.orderId !== order?.id ||
        Date.parse(prepared.expiresAt) <= Date.now() ||
        !Number.isFinite(Date.parse(prepared.expiresAt)) ||
        address(prepared.entryPoint, 'prepared EntryPoint') !== settings.entryPoint ||
        address(prepared.delegate, 'prepared delegate') !== settings.delegate ||
        address(prepared.paymaster, 'prepared Paymaster') !== settings.paymaster ||
        address(prepared.eip7702Factory, 'prepared factory') !== getAddress(FACTORY_MARKER) ||
        !Array.isArray(prepared.transactions) || prepared.transactions.length !== 5) {
        deny('PAYMASTER_INTENT_INVALID', 'The prepared self-hosted swap does not match the reviewed Gas Assist order.')
    }
    const calls = prepared.transactions.map((call) => {
        const to = address(call?.to, 'reviewed call target')
        const data = hex(call?.data, 'reviewed call data')
        if (quantity(call?.value ?? '0x0', 'native call value', (1n << 256n) - 1n) !== 0n) {
            deny('PAYMASTER_NATIVE_VALUE_FORBIDDEN', 'A sponsored five-call swap must not transfer native BNB.')
        }
        return { target: to, data, value: 0n }
    })
    const decode = (call, functionName) => {
        try {
            const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
            if (decoded.functionName !== functionName) throw new Error('unexpected selector')
            return decoded.args
        } catch {
            deny('PAYMASTER_INTENT_INVALID', 'The reviewed fee or approval calldata is invalid.')
        }
    }
    const [treasury, paymentAmount] = decode(calls[0], 'transfer')
    const [spender0, amount0] = decode(calls[1], 'approve')
    const [spender1, amount1] = decode(calls[2], 'approve')
    const [spender2, amount2] = decode(calls[4], 'approve')
    if (spender0 !== spender1 || spender1 !== spender2 ||
        amount0 !== 0n || amount2 !== 0n || amount1 <= 0n ||
        calls[1].target !== calls[2].target || calls[2].target !== calls[4].target ||
        paymentAmount <= 0n || calls[3].data.length < 10) {
        deny('PAYMASTER_INTENT_INVALID', 'The exact five-call payment, approval and swap sequence is invalid.')
    }
    if (order.paymentToken && calls[0].target !== address(order.paymentToken, 'reviewed payment token')) {
        deny('PAYMASTER_ORDER_CHANGED', 'The fee token changed after review.')
    }
    if (order.sellToken && calls[1].target !== address(order.sellToken, 'reviewed sell token')) {
        deny('PAYMASTER_ORDER_CHANGED', 'The sell token changed after review.')
    }
    if (order.approvalSpender && spender0 !== address(order.approvalSpender, 'reviewed approval spender')) {
        deny('PAYMASTER_ORDER_CHANGED', 'The approval spender changed after review.')
    }
    if (order.netSwapAmountRaw != null && amount1 !== BigInt(order.netSwapAmountRaw)) {
        deny('PAYMASTER_ORDER_CHANGED', 'The approved swap amount changed after review.')
    }
    if (order.paymentAmountRaw != null && paymentAmount !== BigInt(order.paymentAmountRaw)) {
        deny('PAYMASTER_ORDER_CHANGED', 'The Gas Assist payment changed after review.')
    }
    if (prepared.pistachioFeeAmountRaw != null && paymentAmount !== BigInt(prepared.pistachioFeeAmountRaw)) {
        deny('PAYMASTER_ORDER_CHANGED', 'The prepared fee does not match the reviewed call.')
    }
    if (order.treasuryAddress && treasury !== address(order.treasuryAddress, 'reviewed treasury')) {
        deny('PAYMASTER_ORDER_CHANGED', 'The treasury address changed after review.')
    }
    return calls
}
export function encodeSelfHostedBatch(calls) {
    if (!Array.isArray(calls) || calls.length !== 5) deny('PAYMASTER_INTENT_INVALID', 'Exactly five reviewed calls are required.')
    return encodeFunctionData({ abi: SIMPLE_ACCOUNT_ABI, functionName: 'executeBatch', args: [calls] })
}
async function rpc(url, method, params, signal) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal,
    })
    if (!response.ok) deny('PAYMASTER_RPC_UNAVAILABLE', `${method} failed with HTTP ${response.status}.`)
    const payload = await response.json()
    if (payload?.jsonrpc !== '2.0' || payload?.error || !('result' in payload)) {
        deny('PAYMASTER_RPC_REJECTED', `${method} was rejected by the RPC provider.`)
    }
    return payload.result
}
async function backendPost(quoteEndpoint, sessionToken, path, userOperation, signal) {
    const response = await fetch(`${getGasAssistBaseUrl(quoteEndpoint)}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ userOperation }),
        signal,
    })
    const payload = await response.json()
    if (!response.ok || payload?.error) {
        deny(payload?.error?.code ?? 'PAYMASTER_SPONSORSHIP_REJECTED',
            payload?.error?.message ?? 'The reviewed UserOperation was not approved for sponsorship.')
    }
    return payload
}
/**
 * Advisory identifier reporting only: no signed transaction, authorization,
 * UserOperation signature or calldata is uploaded. Gas-Assist verifies the
 * expected hash against its own signed intent and the final receipt on BSC.
 */
async function reportPaymasterHash(quoteEndpoint, sessionToken, path, body, signal) {
    try {
        const response = await fetch(`${getGasAssistBaseUrl(quoteEndpoint)}${path}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify(body),
            signal,
        })
        return response.ok
    } catch {
        // The UserOperation may already have been broadcast. Reporting must
        // never trigger a replacement transaction or label it as reverted.
        return false
    }
}
export async function prepareSelfHostedSponsorship(quoteEndpoint, sessionToken, orderId, signal) {
    const response = await fetch(`${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/orders/${encodeURIComponent(orderId)}/atomic/prepare`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
        body: '{}',
        signal,
    })
    const payload = await response.json()
    if (!response.ok || payload?.error) {
        deny(payload?.error?.code ?? 'PAYMASTER_PREPARE_FAILED',
            payload?.error?.message ?? 'Gas Assist could not prepare the reviewed five-call swap.')
    }
    return payload
}
function packedGasFields(operation) {
    return {
        accountGasLimits: numberToHex((quantity(operation.verificationGasLimit, 'verificationGasLimit') << 128n) |
            quantity(operation.callGasLimit, 'callGasLimit'), { size: 32 }),
        gasFees: numberToHex((quantity(operation.maxPriorityFeePerGas, 'maxPriorityFeePerGas') << 128n) |
            quantity(operation.maxFeePerGas, 'maxFeePerGas'), { size: 32 }),
    }
}
export function selfHostedUserOpTypedData(operation, settings) {
    const { accountGasLimits, gasFees } = packedGasFields(operation)
    const initCode = concatHex([settings.delegate, operation.factoryData])
    const paymasterAndData = concatHex([
        settings.paymaster,
        numberToHex(quantity(operation.paymasterVerificationGasLimit, 'paymasterVerificationGasLimit'), { size: 16 }),
        numberToHex(quantity(operation.paymasterPostOpGasLimit, 'paymasterPostOpGasLimit'), { size: 16 }),
        hex(operation.paymasterData, 'paymasterData'),
    ])
    return {
        domain: {
            name: 'ERC4337',
            version: '1',
            chainId: CHAIN_ID,
            verifyingContract: settings.entryPoint,
        },
        primaryType: 'PackedUserOperation',
        types: USEROP_TYPES,
        message: {
            sender: operation.sender,
            nonce: quantity(operation.nonce, 'nonce', (1n << 256n) - 1n),
            initCode,
            callData: operation.callData,
            accountGasLimits,
            preVerificationGas: quantity(operation.preVerificationGas, 'preVerificationGas'),
            gasFees,
            paymasterAndData,
        },
    }
}
async function delegationState(publicRpc, sender, delegate, signal) {
    const code = String(await rpc(publicRpc, 'eth_getCode', [sender, 'latest'], signal)).toLowerCase()
    if (code === '0x') return 'requires-authorization'
    if (code === `0xef0100${delegate.slice(2).toLowerCase()}`) return 'already-delegated'
    deny('PAYMASTER_UNTRUSTED_DELEGATE', 'This EOA is delegated to a different contract or has unrecognized code.')
}
async function authorizationForFirstUse(walletClient, publicRpc, sender, delegate, signal) {
    const nonce = quantity(await rpc(publicRpc, 'eth_getTransactionCount', [sender, 'latest'], signal), 'EOA authorization nonce', (1n << 64n) - 1n)
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) deny('PAYMASTER_AUTHORIZATION_INVALID', 'The EOA authorization nonce exceeds supported precision.')
    const authRequest = {
        type: 'eip7702Auth',
        data: { chainId: CHAIN_ID, address: delegate, nonce: Number(nonce) },
        rawPayload: hashAuthorization({ contractAddress: delegate, chainId: CHAIN_ID, nonce: Number(nonce) }),
    }
    const signature = await walletClient.request({ method: AUTH_METHOD, params: [authRequest] })
    if (!/^0x[0-9a-f]{130}$/iu.test(String(signature ?? ''))) {
        deny('PAYMASTER_AUTHORIZATION_INVALID', 'The wallet returned an invalid EIP-7702 authorization signature.')
    }
    const parsed = parseSignature(signature)
    return {
        chainId: numberToHex(CHAIN_ID),
        address: delegate,
        nonce: numberToHex(nonce),
        yParity: numberToHex(parsed.yParity),
        r: parsed.r,
        s: parsed.s,
    }
}
export async function submitSelfHostedPaymasterUserOperation({
    prepared, order, backendConfig, quoteEndpoint, sessionToken,
    walletClient, authenticatedWalletAddress, signal, onSubmitted,
}) {
    const settings = frontendConfig(backendConfig)
    const calls = validateSelfHostedPrepared(prepared, order, settings)
    const sender = address(authenticatedWalletAddress, 'authenticated wallet')
    if (order.walletAddress && address(order.walletAddress, 'reviewed wallet') !== sender) {
        deny('PAYMASTER_WALLET_MISMATCH', 'The authenticated wallet changed since order review.')
    }
    if (typeof walletClient?.request !== 'function' || typeof walletClient?.signTypedData !== 'function') {
        deny('PISTACHIO_WALLET_REQUIRED', 'Self-hosted Gas Assist requires the Pistachio Wallet signer.')
    }
    if (quantity(await rpc(settings.publicRpc, 'eth_chainId', [], signal), 'chain id') !== 56n ||
        quantity(await rpc(settings.bundlerRpc, 'eth_chainId', [], signal), 'bundler chain id') !== 56n) {
        deny('PAYMASTER_CHAIN_MISMATCH', 'The public RPC and bundler must both use BNB Chain 56.')
    }
    const supported = await rpc(settings.bundlerRpc, 'eth_supportedEntryPoints', [], signal)
    if (!Array.isArray(supported) || !supported.some((candidate) =>
        isAddress(candidate) && getAddress(candidate) === settings.entryPoint)) {
        deny('PAYMASTER_BUNDLER_INCOMPATIBLE', 'The Bundler does not support the configured ERC-4337 v0.8 EntryPoint.')
    }
    const delegation = await delegationState(settings.publicRpc, sender, settings.delegate, signal)
    const eip7702Auth = delegation === 'requires-authorization'
        ? await authorizationForFirstUse(walletClient, settings.publicRpc, sender, settings.delegate, signal)
        : null
    const encodedNonce = await rpc(settings.publicRpc, 'eth_call', [{
        to: settings.entryPoint,
        data: encodeFunctionData({
            abi: ENTRY_POINT_ABI, functionName: 'getNonce', args: [sender, 0n],
        }),
    }, 'latest'], signal)
    const nonce = decodeFunctionResult({
        abi: ENTRY_POINT_ABI, functionName: 'getNonce', data: hex(encodedNonce, 'EntryPoint nonce result'),
    })
    const gasPrice = quantity(await rpc(settings.publicRpc, 'eth_gasPrice', [], signal), 'gas price')
    if (gasPrice === 0n) deny('PAYMASTER_FEE_INVALID', 'The BNB gas price is invalid.')
    const priorityFee = gasPrice / 10n
    const operation = {
        sender,
        nonce: numberToHex(nonce),
        factory: getAddress(FACTORY_MARKER),
        factoryData: '0x',
        callData: encodeSelfHostedBatch(calls),
        callGasLimit: '0x0',
        verificationGasLimit: '0x0',
        preVerificationGas: '0x0',
        maxPriorityFeePerGas: numberToHex(priorityFee),
        maxFeePerGas: numberToHex(gasPrice * 2n + priorityFee),
        signature: '0x',
    }
    const endpoint = `/v1/sponsorship/orders/${encodeURIComponent(prepared.orderId)}/paymaster`
    const stub = await backendPost(quoteEndpoint, sessionToken, `${endpoint}/stub`, operation, signal)
    if (address(stub.paymaster, 'stub Paymaster') !== settings.paymaster ||
        hex(stub.paymasterData, 'stub Paymaster data').length !== 252 ||
        quantity(stub.paymasterPostOpGasLimit, 'stub postOp gas') !== 0n) {
        deny('PAYMASTER_STUB_INVALID', 'The backend returned an invalid fixed-width Paymaster stub.')
    }
    const estimation = {
        ...operation,
        paymaster: settings.paymaster,
        paymasterData: stub.paymasterData,
        paymasterVerificationGasLimit: stub.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: stub.paymasterPostOpGasLimit,
        signature: DUMMY_SIGNATURE,
        ...(eip7702Auth ? { eip7702Auth } : {}),
    }
    const estimate = await rpc(settings.bundlerRpc, 'eth_estimateUserOperationGas',
        [estimation, settings.entryPoint], signal)
    const estimated = {
        ...operation,
        callGasLimit: numberToHex(quantity(estimate?.callGasLimit, 'estimated call gas')),
        verificationGasLimit: numberToHex(quantity(estimate?.verificationGasLimit, 'estimated verification gas')),
        preVerificationGas: numberToHex(quantity(estimate?.preVerificationGas, 'estimated pre-verification gas')),
        paymaster: settings.paymaster,
        paymasterData: stub.paymasterData,
        paymasterVerificationGasLimit: stub.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: stub.paymasterPostOpGasLimit,
        signature: '0x',
    }
    if ([estimated.callGasLimit, estimated.verificationGasLimit, estimated.preVerificationGas].some((v) => BigInt(v) === 0n)) {
        deny('PAYMASTER_GAS_NOT_ESTIMATED', 'Bundler estimation returned zero gas fields.')
    }
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
        deny('PAYMASTER_INTENT_EXPIRED', 'The reviewed Gas Assist order expired before sponsorship.')
    }
    const sponsorship = await backendPost(quoteEndpoint, sessionToken, `${endpoint}/sponsor`, estimated, signal)
    if (address(sponsorship.paymaster, 'final Paymaster') !== settings.paymaster ||
        quantity(sponsorship.paymasterVerificationGasLimit, 'final Paymaster verification gas') !==
            quantity(stub.paymasterVerificationGasLimit, 'stub verification gas') ||
        quantity(sponsorship.paymasterPostOpGasLimit, 'final postOp gas') !== 0n ||
        hex(sponsorship.paymasterData, 'final Paymaster data').length !== 252 ||
        sponsorship.isFinal !== true || Number(sponsorship.validUntil) * 1_000 <= Date.now()) {
        deny('PAYMASTER_AUTHORIZATION_INVALID', 'The final Paymaster authorization is invalid or expired.')
    }
    // No operation fields are changed after this signature is created.
    const finalUnsigned = Object.freeze({ ...estimated, paymasterData: sponsorship.paymasterData })
    const typedData = selfHostedUserOpTypedData(finalUnsigned, settings)
    const expectedHash = hashTypedData(typedData)
    const signature = await walletClient.signTypedData({ account: sender, ...typedData })
    if (!/^0x[0-9a-f]{130}$/iu.test(String(signature ?? '')) ||
        getAddress(await recoverTypedDataAddress({ ...typedData, signature })) !== sender) {
        deny('PAYMASTER_USER_SIGNATURE_INVALID', 'The local signature does not match the authenticated EOA.')
    }
    if (Number(sponsorship.validUntil) * 1_000 <= Date.now()) {
        deny('PAYMASTER_AUTHORIZATION_EXPIRED', 'Paymaster authorization expired during local signing.')
    }
    const finalOperation = {
        ...finalUnsigned,
        signature,
        ...(eip7702Auth ? { eip7702Auth } : {}),
    }
    const userOpHash = await rpc(settings.bundlerRpc, 'eth_sendUserOperation',
        [finalOperation, settings.entryPoint], signal)
    if (!HASH.test(String(userOpHash ?? '')) || userOpHash.toLowerCase() !== expectedHash.toLowerCase()) {
        deny('PAYMASTER_USEROP_HASH_MISMATCH', 'The Bundler returned a UserOperation hash different from the locally signed hash.')
    }
    // Inform the backend that its one permitted authorization was submitted.
    // It receives only a public hash and cannot relay or modify the operation.
    await reportPaymasterHash(quoteEndpoint, sessionToken,
        `${endpoint}/submitted`, { userOpHash }, signal)
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const receipt = await rpc(settings.bundlerRpc, 'eth_getUserOperationReceipt', [userOpHash], signal)
        if (receipt) {
            const transactionHash = receipt.receipt?.transactionHash ?? null
            if (transactionHash && !HASH.test(transactionHash)) {
                deny('PAYMASTER_RECEIPT_INVALID', 'Bundler receipt contained an invalid transaction hash.')
            }
            // Gas-Assist verifies the actual BNB Chain EntryPoint event and
            // distinguishes a confirmed source operation from Polygon delivery.
            const sourceReport = transactionHash
                ? await reportPaymasterHash(quoteEndpoint, sessionToken,
                    `${endpoint}/receipt`, { userOpHash, transactionHash }, signal)
                : false
            const success = receipt.success === true || receipt.success === '0x1'
            const transactionSuccess = receipt.receipt?.status === '0x1' || receipt.receipt?.status === 1
            if (!success || !transactionSuccess) {
                deny('PAYMASTER_EXECUTION_REVERTED', 'The sponsored UserOperation or swap reverted; Paymaster gas may still have been charged.')
            }
            // Only advance the bridge route after an actual successful source
            // operation. A reverted sponsored operation must not receive an
            // optimistic destination credit or "source submitted" callback.
            if (transactionHash) await onSubmitted?.({
                orderId: prepared.orderId, userOpHash, transactionHash, sourceReport,
            })
            return {
                orderId: prepared.orderId, userOpHash, transactionHash,
                status: 'completed', backendSourceReceiptVerified: sourceReport,
            }
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 2_000))
    }
    return { orderId: prepared.orderId, userOpHash, transactionHash: null, status: 'pending' }
}
