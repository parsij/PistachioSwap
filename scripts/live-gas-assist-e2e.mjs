import { randomUUID } from 'node:crypto'

import {
    decodeFunctionResult,
    encodeFunctionData,
    erc20Abi,
    formatEther,
    formatUnits,
    getAddress,
    hashTypedData,
    http,
    createPublicClient,
    numberToHex,
    recoverTypedDataAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bsc } from 'viem/chains'
import { recoverAuthorizationAddress } from 'viem/utils'

import {
    bundlerUserOperation,
    classifyDelegationCode,
    encodeSelfHostedBatch,
    selfHostedUserOpTypedData,
    sponsoredBscGasFees,
    validateSelfHostedPrepared,
} from '../src/features/gas-assist/services/selfHostedPaymaster.js'

/*
 * Manual production-only Gas Assist acceptance.
 *
 * This script deliberately has no default signing key and refuses to run
 * unless the operator explicitly confirms BNB mainnet. It never prints the
 * private key, session token, EIP-7702 signature, UserOperation signature, or
 * reviewed calldata. eth_sendUserOperation has a hard one-attempt guard.
 */
const CHAIN_ID = 56
const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const TRUSTED_DELEGATE = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const PAYMASTER = '0xbF7d14999219FAe39FaF7a80574dDBA39839F5C1'
const FACTORY_MARKER = '0x7702000000000000000000000000000000000000'
const EXECUTOR = '0xe8852b674174ed1250F06eD97e64fC6fDe5B20FB'
const TEST_WALLET = '0x880c39159919700166E4612d4b7Aa344fc21CD6F'
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'
const GROSS_INPUT_RAW = 200_000_000_000_000_000n
const SLIPPAGE_BPS = 50
const API_BASE = 'https://pistachioswap.com/api'
const BUNDLER_RPC = 'https://pistachioswap.com/api/v1/bundler'
const PUBLIC_RPC = process.env.GAS_ASSIST_E2E_PUBLIC_RPC_URL?.trim() ||
    process.env.VITE_BSC_PUBLIC_RPC_URL?.trim() ||
    'https://bsc-dataseed.bnbchain.org'
const DUMMY_SIGNATURE = '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c'
const HASH = /^0x[0-9a-f]{64}$/iu
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu

const ENTRY_POINT_ABI = [{
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
        { type: 'address', name: 'sender' },
        { type: 'uint192', name: 'key' },
    ],
    outputs: [{ type: 'uint256', name: 'nonce' }],
}]

function fail(message) {
    throw new Error(message)
}

function requireCondition(condition, message) {
    if (!condition) fail(message)
}

function quantity(value, name) {
    const normalized = String(value ?? '')
    if (!QUANTITY.test(normalized)) {
        fail(`${name} is not a canonical RPC quantity.`)
    }
    return BigInt(normalized)
}

function safeError(error) {
    return {
        name: String(error?.name ?? 'Error'),
        code: error?.code ? String(error.code) : undefined,
        message: String(error?.message ?? 'Unknown error').slice(0, 500),
        status: Number.isInteger(error?.status) ? error.status : undefined,
    }
}

async function jsonRequest(path, {
    method = 'GET',
    token,
    idempotencyKey,
    body,
} = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
            accept: 'application/json',
            ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            ...(token
                ? { authorization: `Bearer ${token}` }
                : {}),
            ...(idempotencyKey
                ? { 'idempotency-key': idempotencyKey }
                : {}),
        },
        ...(body === undefined
            ? {}
            : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(45_000),
    })

    const text = await response.text()
    let payload = null
    try {
        payload = text ? JSON.parse(text) : null
    } catch {
        fail(`${method} ${path} returned non-JSON HTTP ${response.status}.`)
    }

    if (!response.ok || payload?.error) {
        const error = new Error(
            payload?.error?.message ??
            `${method} ${path} failed with HTTP ${response.status}.`,
        )
        error.code = payload?.error?.code ?? 'HTTP_ERROR'
        error.status = response.status
        throw error
    }

    return payload
}

async function rpc(
    url,
    method,
    params,
    { estimateRetry = false } = {},
) {
    const attempts = estimateRetry ? 2 : 1
    let lastError = null

    for (
        let attempt = 0;
        attempt < attempts;
        attempt += 1
    ) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method,
                    params,
                }),
                signal: AbortSignal.timeout(45_000),
            })

            const payload = await response.json()

            if (!response.ok) {
                fail(`${method} failed with HTTP ${response.status}.`)
            }

            if (payload?.error) {
                const error = new Error(
                    typeof payload.error.message === 'string'
                        ? payload.error.message.slice(0, 500)
                        : `${method} was rejected.`,
                )
                error.code = payload.error.code
                throw error
            }

            if (!Object.hasOwn(payload ?? {}, 'result')) {
                fail(`${method} returned no result.`)
            }

            return payload.result
        } catch (error) {
            lastError = error
            if (
                !estimateRetry ||
                attempt + 1 >= attempts
            ) {
                throw error
            }
        }
    }

    throw lastError
}

async function waitForUserOperationReceipt(
    userOpHash,
    attempts = 60,
) {
    for (
        let attempt = 0;
        attempt < attempts;
        attempt += 1
    ) {
        const receipt = await rpc(
            BUNDLER_RPC,
            'eth_getUserOperationReceipt',
            [userOpHash],
        )

        if (receipt) return receipt

        await new Promise((resolve) =>
            setTimeout(resolve, 2_000))
    }

    return null
}

async function balanceOf(client, token, owner) {
    return client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
    })
}

async function allowanceOf(
    client,
    token,
    owner,
    spender,
) {
    return client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, spender],
    })
}

function delegationFromCode(code) {
    const match =
        /^0xef0100([0-9a-f]{40})$/iu.exec(
            String(code ?? ''),
        )

    return match
        ? getAddress(`0x${match[1]}`)
        : null
}

async function main() {
    requireCondition(
        process.env.GAS_ASSIST_E2E_CONFIRM_MAINNET === 'yes',
        'Refusing mainnet E2E. Set GAS_ASSIST_E2E_CONFIRM_MAINNET=yes explicitly.',
    )

    const privateKey =
        String(
            process.env.GAS_ASSIST_E2E_PRIVATE_KEY ??
            '',
        ).trim()

    requireCondition(
        /^0x[0-9a-f]{64}$/iu.test(privateKey),
        'Set GAS_ASSIST_E2E_PRIVATE_KEY to the disposable test wallet key. It is never printed.',
    )

    const account = privateKeyToAccount(privateKey)
    const sender = getAddress(account.address)

    requireCondition(
        sender === getAddress(TEST_WALLET),
        `Refusing to use unexpected wallet ${sender}; expected disposable test wallet ${TEST_WALLET}.`,
    )

    const publicClient = createPublicClient({
        chain: bsc,
        transport: http(
            PUBLIC_RPC,
            { retryCount: 0 },
        ),
    })

    const [
        chainId,
        bundlerChainId,
        supportedEntryPoints,
        config,
    ] = await Promise.all([
        publicClient.getChainId(),
        rpc(
            BUNDLER_RPC,
            'eth_chainId',
            [],
        ),
        rpc(
            BUNDLER_RPC,
            'eth_supportedEntryPoints',
            [],
        ),
        jsonRequest('/v1/sponsorship/config'),
    ])

    requireCondition(
        chainId === CHAIN_ID,
        `Public RPC is on chain ${chainId}, expected 56.`,
    )
    requireCondition(
        quantity(
            bundlerChainId,
            'Bundler chain ID',
        ) === 56n,
        'Bundler is not on BNB Chain 56.',
    )
    requireCondition(
        Array.isArray(supportedEntryPoints) &&
        supportedEntryPoints.some((value) =>
            String(value).toLowerCase() ===
            ENTRY_POINT.toLowerCase()),
        'Bundler does not advertise EntryPoint v0.8.',
    )
    requireCondition(
        config?.enabled === true,
        'Gas Assist is not enabled.',
    )
    requireCondition(
        config?.provider ===
        'pistachio-paymaster-v08',
        'Self-hosted Paymaster is not active.',
    )
    requireCondition(
        config?.execution ===
        'erc4337-v08-eip7702-direct',
        'Unexpected Gas Assist execution mode.',
    )
    requireCondition(
        getAddress(config.entryPoint) ===
        getAddress(ENTRY_POINT),
        'EntryPoint configuration mismatch.',
    )
    requireCondition(
        getAddress(config.delegate) ===
        getAddress(TRUSTED_DELEGATE),
        'Trusted delegate configuration mismatch.',
    )
    requireCondition(
        getAddress(config.paymaster) ===
        getAddress(PAYMASTER),
        'Paymaster configuration mismatch.',
    )
    requireCondition(
        getAddress(config.eip7702Factory) ===
        getAddress(FACTORY_MARKER),
        'EIP-7702 marker configuration mismatch.',
    )

    const before = {
        bnb:
            await publicClient.getBalance({
                address: sender,
            }),
        usdt:
            await balanceOf(
                publicClient,
                USDT,
                sender,
            ),
        usdc:
            await balanceOf(
                publicClient,
                USDC,
                sender,
            ),
        executorBnb:
            await publicClient.getBalance({
                address: EXECUTOR,
            }),
        code:
            await publicClient.getCode({
                address: sender,
            }) ?? '0x',
    }

    requireCondition(
        before.bnb === 0n,
        `Test wallet must start with exactly 0 BNB; found ${formatEther(before.bnb)} BNB.`,
    )
    requireCondition(
        before.usdt >= GROSS_INPUT_RAW,
        `Test wallet has only ${formatUnits(before.usdt, 18)} USDT.`,
    )

    console.log(
        'PRECHECK',
        JSON.stringify({
            wallet: sender,
            bnb: formatEther(before.bnb),
            usdt: formatUnits(before.usdt, 18),
            usdc: formatUnits(before.usdc, 18),
            executorBnb:
                formatEther(before.executorBnb),
            currentDelegate:
                delegationFromCode(before.code),
        }),
    )

    const preview = await jsonRequest(
        '/v1/sponsorship/preview',
        {
            method: 'POST',
            body: {
                walletAddress: sender,
                sellToken: USDT,
                buyToken: USDC,
                grossInputAmount:
                    GROSS_INPUT_RAW.toString(),
                slippageBps: SLIPPAGE_BPS,
            },
        },
    )

    console.log(
        'FRESH_PREVIEW',
        JSON.stringify({
            grossInputAmountRaw:
                preview.grossInputAmountRaw,
            netSwapAmountRaw:
                preview.netSwapAmountRaw,
            paymentAmountRaw:
                preview.paymentAmountRaw,
            expectedOutputRaw:
                preview.expectedOutputRaw,
            minimumOutputRaw:
                preview.minimumOutputRaw,
            expiresAt:
                preview.expiresAt,
            amountsUsd:
                preview.amountsUsd,
        }),
    )

    const challenge = await jsonRequest(
        '/v1/sponsorship/auth/challenge',
        {
            method: 'POST',
            body: {
                walletAddress: sender,
                chainId: CHAIN_ID,
            },
        },
    )

    requireCondition(
        typeof challenge?.message === 'string' &&
        challenge.message.length > 0,
        'Authentication challenge is invalid.',
    )

    const authSignature =
        await account.signMessage({
            message: challenge.message,
        })

    const session = await jsonRequest(
        '/v1/sponsorship/auth/verify',
        {
            method: 'POST',
            body: {
                challengeId:
                    challenge.challengeId,
                signature:
                    authSignature,
            },
        },
    )

    requireCondition(
        session?.walletAddress?.toLowerCase() ===
        sender.toLowerCase(),
        'Authenticated wallet mismatch.',
    )

    const order = await jsonRequest(
        '/v1/sponsorship/orders',
        {
            method: 'POST',
            token: session.sessionToken,
            idempotencyKey: randomUUID(),
            body: {
                sellToken: USDT,
                buyToken: USDC,
                grossInputAmount:
                    GROSS_INPUT_RAW.toString(),
                slippageBps:
                    SLIPPAGE_BPS,
            },
        },
    )

    requireCondition(
        typeof order?.id === 'string' &&
        order.id.length > 0,
        'Fresh order is invalid.',
    )

    console.log(
        'FRESH_ORDER',
        JSON.stringify({
            id: order.id,
            status: order.status,
            grossInputAmountRaw:
                order.grossInputAmountRaw,
            netSwapAmountRaw:
                order.netSwapAmountRaw,
            paymentAmountRaw:
                order.paymentAmountRaw,
            expectedOutputRaw:
                order.expectedOutputRaw,
            minimumOutputRaw:
                order.minimumOutputRaw,
            approvalSpender:
                order.approvalSpender,
            expiresAt:
                order.expiresAt,
            amountsUsd:
                order.amountsUsd,
        }),
    )

    const prepared = await jsonRequest(
        `/v1/sponsorship/orders/${encodeURIComponent(order.id)}/atomic/prepare`,
        {
            method: 'POST',
            token: session.sessionToken,
            body: {},
        },
    )

    const settings = {
        entryPoint: getAddress(ENTRY_POINT),
        delegate: getAddress(TRUSTED_DELEGATE),
        paymaster: getAddress(PAYMASTER),
    }

    const calls =
        validateSelfHostedPrepared(
            prepared,
            order,
            settings,
        )

    console.log(
        'ATOMIC_PREPARE',
        JSON.stringify({
            provider: prepared.provider,
            execution: prepared.execution,
            stage: prepared.stage,
            expiresAt: prepared.expiresAt,
            callCount: calls.length,
            targets:
                calls.map((call) =>
                    call.target),
        }),
    )

    const delegation =
        classifyDelegationCode(
            before.code,
            settings.delegate,
        )

    let eip7702Auth = null

    if (
        delegation.status ===
        'requires-authorization'
    ) {
        const eoaNonceHex = await rpc(
            PUBLIC_RPC,
            'eth_getTransactionCount',
            [sender, 'latest'],
        )

        const eoaNonce =
            quantity(
                eoaNonceHex,
                'EOA authorization nonce',
            )

        requireCondition(
            eoaNonce <=
            BigInt(Number.MAX_SAFE_INTEGER),
            'EOA nonce exceeds safe authorization precision.',
        )

        const signed =
            await account.signAuthorization({
                contractAddress:
                    settings.delegate,
                chainId: CHAIN_ID,
                nonce: Number(eoaNonce),
            })

        const signedAuthorization = {
            chainId: CHAIN_ID,
            address: settings.delegate,
            nonce: Number(eoaNonce),
            yParity: signed.yParity,
            r: signed.r,
            s: signed.s,
        }

        const recovered =
            await recoverAuthorizationAddress({
                authorization:
                    signedAuthorization,
            })

        requireCondition(
            getAddress(recovered) === sender,
            'Local EIP-7702 authorization recovery failed.',
        )

        const [
            freshCode,
            freshNonce,
        ] = await Promise.all([
            rpc(
                PUBLIC_RPC,
                'eth_getCode',
                [sender, 'latest'],
            ),
            rpc(
                PUBLIC_RPC,
                'eth_getTransactionCount',
                [sender, 'latest'],
            ),
        ])

        requireCondition(
            String(freshCode).toLowerCase() ===
            String(before.code).toLowerCase(),
            'Delegation changed while signing authorization.',
        )
        requireCondition(
            quantity(
                freshNonce,
                'fresh EOA nonce',
            ) === eoaNonce,
            'EOA nonce changed while signing authorization.',
        )

        eip7702Auth = {
            chainId:
                numberToHex(CHAIN_ID),
            address:
                settings.delegate,
            nonce:
                numberToHex(eoaNonce),
            yParity:
                numberToHex(
                    signed.yParity,
                ),
            r: signed.r,
            s: signed.s,
        }

        console.log(
            'EIP7702_AUTH',
            JSON.stringify({
                required: true,
                previousDelegate:
                    delegation.previousDelegate,
                nonce:
                    eoaNonce.toString(),
                recoveredSigner:
                    sender,
            }),
        )
    } else {
        console.log(
            'EIP7702_AUTH',
            JSON.stringify({
                required: false,
                currentDelegate:
                    settings.delegate,
            }),
        )
    }

    const encodedNonce = await rpc(
        PUBLIC_RPC,
        'eth_call',
        [{
            to: settings.entryPoint,
            data: encodeFunctionData({
                abi: ENTRY_POINT_ABI,
                functionName: 'getNonce',
                args: [sender, 0n],
            }),
        }, 'latest'],
    )

    const entryPointNonce =
        decodeFunctionResult({
            abi: ENTRY_POINT_ABI,
            functionName: 'getNonce',
            data: encodedNonce,
        })

    const fees =
        sponsoredBscGasFees(
            await rpc(
                PUBLIC_RPC,
                'eth_gasPrice',
                [],
            ),
        )

    const operation = {
        sender,
        nonce:
            numberToHex(entryPointNonce),
        factory:
            getAddress(FACTORY_MARKER),
        factoryData: '0x',
        callData:
            encodeSelfHostedBatch(calls),
        callGasLimit: '0x0',
        verificationGasLimit: '0x0',
        preVerificationGas: '0x0',
        ...fees,
        signature: '0x',
    }

    const paymasterPath =
        `/v1/sponsorship/orders/${encodeURIComponent(order.id)}/paymaster`

    const stub = await jsonRequest(
        `${paymasterPath}/stub`,
        {
            method: 'POST',
            token:
                session.sessionToken,
            body: {
                userOperation:
                    operation,
            },
        },
    )

    requireCondition(
        getAddress(stub.paymaster) ===
        settings.paymaster,
        'Stub Paymaster mismatch.',
    )
    requireCondition(
        String(
            stub.paymasterData ??
            '',
        ).length === 252,
        'Stub Paymaster data has unexpected length.',
    )
    requireCondition(
        quantity(
            stub.paymasterPostOpGasLimit,
            'stub postOp gas',
        ) === 0n,
        'Stub postOp gas must be zero.',
    )

    const estimation = {
        ...operation,
        paymaster:
            settings.paymaster,
        paymasterData:
            stub.paymasterData,
        paymasterVerificationGasLimit:
            stub.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit:
            stub.paymasterPostOpGasLimit,
        signature:
            DUMMY_SIGNATURE,
        ...(eip7702Auth
            ? { eip7702Auth }
            : {}),
    }

    const estimate = await rpc(
        BUNDLER_RPC,
        'eth_estimateUserOperationGas',
        [
            bundlerUserOperation(
                estimation,
            ),
            settings.entryPoint,
        ],
        { estimateRetry: true },
    )

    const estimated = {
        ...operation,
        callGasLimit:
            numberToHex(
                quantity(
                    estimate.callGasLimit,
                    'callGasLimit',
                ),
            ),
        verificationGasLimit:
            numberToHex(
                quantity(
                    estimate.verificationGasLimit,
                    'verificationGasLimit',
                ),
            ),
        preVerificationGas:
            numberToHex(
                quantity(
                    estimate.preVerificationGas,
                    'preVerificationGas',
                ),
            ),
        paymaster:
            settings.paymaster,
        paymasterData:
            stub.paymasterData,
        paymasterVerificationGasLimit:
            stub.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit:
            stub.paymasterPostOpGasLimit,
        signature: '0x',
    }

    requireCondition(
        [
            estimated.callGasLimit,
            estimated.verificationGasLimit,
            estimated.preVerificationGas,
        ].every((value) =>
            BigInt(value) > 0n),
        'Bundler returned a zero gas field.',
    )

    console.log(
        'USEROP_ESTIMATE',
        JSON.stringify({
            callGasLimit:
                estimated.callGasLimit,
            verificationGasLimit:
                estimated.verificationGasLimit,
            preVerificationGas:
                estimated.preVerificationGas,
            paymasterVerificationGasLimit:
                estimated.paymasterVerificationGasLimit,
            paymasterPostOpGasLimit:
                estimated.paymasterPostOpGasLimit,
        }),
    )

    requireCondition(
        Date.parse(prepared.expiresAt) >
        Date.now(),
        'Prepared intent expired before final sponsorship.',
    )

    const sponsorship =
        await jsonRequest(
            `${paymasterPath}/sponsor`,
            {
                method: 'POST',
                token:
                    session.sessionToken,
                body: {
                    userOperation:
                        estimated,
                },
            },
        )

    requireCondition(
        sponsorship?.isFinal === true,
        'Paymaster sponsorship is not final.',
    )
    requireCondition(
        getAddress(sponsorship.paymaster) ===
        settings.paymaster,
        'Final Paymaster mismatch.',
    )
    requireCondition(
        String(
            sponsorship.paymasterData ??
            '',
        ).length === 252,
        'Final Paymaster data has unexpected length.',
    )
    requireCondition(
        quantity(
            sponsorship.paymasterPostOpGasLimit,
            'final postOp gas',
        ) === 0n,
        'Final postOp gas must be zero.',
    )
    requireCondition(
        quantity(
            sponsorship.paymasterVerificationGasLimit,
            'final Paymaster verification gas',
        ) ===
        quantity(
            stub.paymasterVerificationGasLimit,
            'stub Paymaster verification gas',
        ),
        'Final Paymaster verification gas changed after estimation.',
    )
    requireCondition(
        Number(sponsorship.validUntil) *
        1_000 > Date.now(),
        'Paymaster authorization is already expired.',
    )

    const finalUnsigned =
        Object.freeze({
            ...estimated,
            paymasterData:
                sponsorship.paymasterData,
        })

    const typedData =
        selfHostedUserOpTypedData(
            finalUnsigned,
            settings,
        )

    const expectedHash =
        hashTypedData(typedData)

    const userSignature =
        await account.signTypedData(
            typedData,
        )

    const recoveredUser =
        await recoverTypedDataAddress({
            ...typedData,
            signature:
                userSignature,
        })

    requireCondition(
        getAddress(recoveredUser) ===
        sender,
        'Final UserOperation signature failed local recovery.',
    )
    requireCondition(
        Number(sponsorship.validUntil) *
        1_000 > Date.now(),
        'Paymaster authorization expired during local signing.',
    )

    const finalOperation = {
        ...finalUnsigned,
        signature: userSignature,
        ...(eip7702Auth
            ? { eip7702Auth }
            : {}),
    }

    let sendAttempted = false
    let userOpHash = null

    try {
        requireCondition(
            !sendAttempted,
            'Internal single-send guard tripped.',
        )
        sendAttempted = true

        userOpHash = await rpc(
            BUNDLER_RPC,
            'eth_sendUserOperation',
            [
                bundlerUserOperation(
                    finalOperation,
                ),
                settings.entryPoint,
            ],
        )
    } catch (error) {
        console.error(
            'SEND_RESULT_AMBIGUOUS',
            JSON.stringify({
                expectedUserOpHash:
                    expectedHash,
                error:
                    safeError(error),
                action:
                    'No retry will be attempted. Querying expected hash only.',
            }),
        )

        const ambiguousReceipt =
            await waitForUserOperationReceipt(
                expectedHash,
                8,
            ).catch(() => null)

        if (!ambiguousReceipt) {
            fail(
                `eth_sendUserOperation outcome is ambiguous for ${expectedHash}. Do not retry automatically.`,
            )
        }

        userOpHash = expectedHash
    }

    requireCondition(
        HASH.test(
            String(
                userOpHash ??
                '',
            ),
        ),
        'Bundler returned an invalid UserOperation hash.',
    )
    requireCondition(
        userOpHash.toLowerCase() ===
        expectedHash.toLowerCase(),
        'Bundler UserOperation hash differs from the locally signed hash.',
    )

    console.log(
        'USEROP_SUBMITTED',
        JSON.stringify({
            userOpHash,
        }),
    )

    await jsonRequest(
        `${paymasterPath}/submitted`,
        {
            method: 'POST',
            token:
                session.sessionToken,
            body: {
                userOpHash,
            },
        },
    ).catch((error) => {
        console.error(
            'SUBMITTED_REPORT_WARNING',
            JSON.stringify(
                safeError(error),
            ),
        )
    })

    const userOpReceipt =
        await waitForUserOperationReceipt(
            userOpHash,
        )

    requireCondition(
        userOpReceipt,
        'Timed out waiting for the UserOperation receipt. Do not resubmit.',
    )

    const transactionHash =
        userOpReceipt.receipt
            ?.transactionHash

    requireCondition(
        HASH.test(
            String(
                transactionHash ??
                '',
            ),
        ),
        'UserOperation receipt has no valid transaction hash.',
    )

    const sourceReceiptReport =
        await jsonRequest(
            `${paymasterPath}/receipt`,
            {
                method: 'POST',
                token:
                    session.sessionToken,
                body: {
                    userOpHash,
                    transactionHash,
                },
            },
        ).catch((error) => ({
            reportError:
                safeError(error),
        }))

    const txReceipt =
        await publicClient
            .getTransactionReceipt({
                hash: transactionHash,
            })

    const userOpSuccess =
        userOpReceipt.success === true ||
        userOpReceipt.success === '0x1'

    requireCondition(
        userOpSuccess,
        'Sponsored UserOperation reverted.',
    )
    requireCondition(
        txReceipt.status === 'success',
        'Bundler transaction reverted.',
    )

    const approvalSpender =
        getAddress(
            order.approvalSpender,
        )

    const after = {
        bnb:
            await publicClient.getBalance({
                address: sender,
            }),
        usdt:
            await balanceOf(
                publicClient,
                USDT,
                sender,
            ),
        usdc:
            await balanceOf(
                publicClient,
                USDC,
                sender,
            ),
        allowance:
            await allowanceOf(
                publicClient,
                USDT,
                sender,
                approvalSpender,
            ),
        executorBnb:
            await publicClient.getBalance({
                address: EXECUTOR,
            }),
        code:
            await publicClient.getCode({
                address: sender,
            }) ?? '0x',
    }

    requireCondition(
        after.bnb === 0n,
        `Test wallet unexpectedly holds ${formatEther(after.bnb)} BNB after sponsored execution.`,
    )
    requireCondition(
        after.allowance === 0n,
        `USDT allowance cleanup failed; remaining allowance is ${after.allowance}.`,
    )
    requireCondition(
        delegationFromCode(after.code) ===
        getAddress(TRUSTED_DELEGATE),
        'Final EIP-7702 delegate is not the trusted Simple7702Account.',
    )
    requireCondition(
        after.usdt < before.usdt,
        'USDT balance did not decrease.',
    )
    requireCondition(
        after.usdc > before.usdc,
        'USDC balance did not increase.',
    )

    const actualGasCost =
        userOpReceipt.actualGasCost == null
            ? null
            : quantity(
                userOpReceipt.actualGasCost,
                'actualGasCost',
            )

    const actualGasUsed =
        userOpReceipt.actualGasUsed == null
            ? null
            : quantity(
                userOpReceipt.actualGasUsed,
                'actualGasUsed',
            )

    const finalOrder =
        await jsonRequest(
            `/v1/sponsorship/orders/${encodeURIComponent(order.id)}`,
            {
                token:
                    session.sessionToken,
            },
        ).catch((error) => ({
            pollError:
                safeError(error),
        }))

    console.log(
        'E2E_SUCCESS',
        JSON.stringify({
            orderId:
                order.id,
            estimate: {
                callGasLimit:
                    estimated.callGasLimit,
                verificationGasLimit:
                    estimated.verificationGasLimit,
                preVerificationGas:
                    estimated.preVerificationGas,
                paymasterVerificationGasLimit:
                    estimated.paymasterVerificationGasLimit,
            },
            userOpHash,
            transactionHash,
            userOperationReceipt: {
                success:
                    userOpSuccess,
                actualGasCostWei:
                    actualGasCost?.toString() ??
                    null,
                actualGasUsed:
                    actualGasUsed?.toString() ??
                    null,
            },
            transactionReceipt: {
                status:
                    txReceipt.status,
                blockNumber:
                    txReceipt.blockNumber
                        .toString(),
                gasUsed:
                    txReceipt.gasUsed
                        .toString(),
                effectiveGasPrice:
                    txReceipt
                        .effectiveGasPrice
                        ?.toString() ??
                    null,
            },
            balances: {
                usdtBefore:
                    formatUnits(
                        before.usdt,
                        18,
                    ),
                usdtAfter:
                    formatUnits(
                        after.usdt,
                        18,
                    ),
                usdcBefore:
                    formatUnits(
                        before.usdc,
                        18,
                    ),
                usdcAfter:
                    formatUnits(
                        after.usdc,
                        18,
                    ),
                walletBnbBefore:
                    formatEther(
                        before.bnb,
                    ),
                walletBnbAfter:
                    formatEther(
                        after.bnb,
                    ),
                executorBnbBefore:
                    formatEther(
                        before.executorBnb,
                    ),
                executorBnbAfter:
                    formatEther(
                        after.executorBnb,
                    ),
            },
            allowanceAfter:
                after.allowance.toString(),
            finalDelegate:
                delegationFromCode(
                    after.code,
                ),
            backendReceiptReported:
                !sourceReceiptReport
                    ?.reportError,
            backendOrderStatus:
                finalOrder?.status ??
                null,
        }, null, 2),
    )
}

main().catch((error) => {
    console.error(
        'E2E_FAILED',
        JSON.stringify(
            safeError(error),
        ),
    )
    process.exitCode = 1
})
