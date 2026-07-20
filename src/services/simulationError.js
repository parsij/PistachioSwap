import { decodeErrorResult, isHex, parseAbi } from 'viem'

const simulationErrorAbi = parseAbi([
    'error AllowanceExpired(uint256 deadline)',
    'error InsufficientAllowance(uint256 amount)',
    'error TransactionDeadlinePassed()',
    'error ExecutionFailed(uint256 commandIndex, bytes message)',
    'error V2TooLittleReceived()',
    'error V3TooLittleReceived()',
    'error V2TooMuchRequested()',
    'error V3TooMuchRequested()',
    'error SafeERC20FailedOperation(address token)',
    'error TransferFailed()',
    'error InsufficientToken()',
    'error InsufficientETH()',
    'error ContractLocked()',
    'error InvalidCommandType(uint256 commandType)',
    'error BalanceTooLow()',
    'error Error(string message)',
    'error Panic(uint256 code)',
])

const GAS_BUFFER_BPS = 2_000n
const BPS_DENOMINATOR = 10_000n
const MINIMUM_GAS_BUFFER = 25_000n

function validRevertData(value) {
    return (
        typeof value === 'string' &&
        isHex(value) &&
        value.length >= 10
    )
}

function nestedValues(value) {
    if (!value || typeof value !== 'object') return []

    return [
        value.data,
        value.error,
        value.cause,
    ]
}

function revertDataFromText(text) {
    if (typeof text !== 'string') return null

    /*
     * Do not match every hexadecimal value in an error message.
     *
     * Viem errors also contain the original transaction calldata. Treating
     * that calldata as revert data produces misleading UnknownRevert results.
     */
    const patterns = [
        /execution reverted(?: with reason)?:\s*(0x[a-fA-F0-9]{8,})/u,
        /revert(?:ed)? data:\s*(0x[a-fA-F0-9]{8,})/u,
        /return data:\s*(0x[a-fA-F0-9]{8,})/u,
        /error data:\s*(0x[a-fA-F0-9]{8,})/u,
    ]

    for (const pattern of patterns) {
        const match = text.match(pattern)

        if (
            match &&
            validRevertData(match[1])
        ) {
            return match[1]
        }
    }

    return null
}

export function extractRevertData(error) {
    const queue = [error]
    const visited = new Set()

    while (queue.length > 0) {
        const current = queue.shift()

        if (validRevertData(current)) {
            return current
        }

        if (
            !current ||
            typeof current !== 'object' ||
            visited.has(current)
        ) {
            continue
        }

        visited.add(current)

        for (const candidate of nestedValues(current)) {
            if (validRevertData(candidate)) {
                return candidate
            }

            if (
                candidate &&
                typeof candidate === 'object'
            ) {
                queue.push(candidate)
            }
        }

        for (const text of [
            current.details,
            current.shortMessage,
            current.message,
        ]) {
            const data = revertDataFromText(text)

            if (data) {
                return data
            }
        }
    }

    return null
}

function safeArguments(name, args) {
    if (!Array.isArray(args)) return []

    if (name === 'ExecutionFailed') {
        return [
            args[0]?.toString?.() ??
            String(args[0] ?? ''),
        ]
    }

    return args.map((value) => {
        if (typeof value === 'bigint') {
            return value.toString()
        }

        if (
            typeof value === 'string' &&
            value.length <= 128
        ) {
            return value
        }

        return '[redacted]'
    })
}

function contractFamily(errorName) {
    if (
        [
            'AllowanceExpired',
            'InsufficientAllowance',
        ].includes(errorName)
    ) {
        return 'permit2'
    }

    if (
        [
            'Error',
            'Panic',
        ].includes(errorName)
    ) {
        return 'solidity'
    }

    if (/Transfer|Token|ETH/u.test(errorName)) {
        return 'token-transfer'
    }

    return 'universal-router'
}

export function decodeSimulationRevert(error) {
    const data = extractRevertData(error)

    if (!data) return null

    try {
        const decoded = decodeErrorResult({
            abi: simulationErrorAbi,
            data,
        })

        if (decoded.errorName === 'ExecutionFailed') {
            const nested = decodeSimulationRevert(
                decoded.args?.[1],
            )

            if (nested) {
                return {
                    ...nested,
                    routerErrorName:
                    decoded.errorName,
                    commandIndex:
                        decoded.args?.[0]?.toString?.() ??
                        null,
                }
            }
        }

        return {
            contractFamily:
                contractFamily(decoded.errorName),

            errorName:
            decoded.errorName,

            safeArguments:
                safeArguments(
                    decoded.errorName,
                    decoded.args,
                ),
        }
    } catch {
        return {
            contractFamily: 'unknown',
            errorName: 'UnknownRevert',
            safeArguments: [],
        }
    }
}

export function simulationErrorMessage(decoded) {
    if (!decoded) {
        return 'This transaction is expected to fail.'
    }

    if (decoded.errorName === 'AllowanceExpired') {
        return 'The Permit2 authorization expired. Refreshing approval is required.'
    }

    if (decoded.errorName === 'InsufficientAllowance') {
        return 'The route does not have enough Permit2 allowance.'
    }

    if (
        decoded.errorName ===
        'TransactionDeadlinePassed'
    ) {
        return 'The quote expired. Request a fresh quote.'
    }

    if (
        /TooLittleReceived|TooMuchRequested|slippage/iu.test(
            decoded.errorName,
        )
    ) {
        return 'The route no longer meets the selected slippage limit.'
    }

    if (
        /Transfer|Token|ETH/iu.test(
            decoded.errorName,
        )
    ) {
        return 'The token transfer would fail. Check balance and token restrictions.'
    }

    return 'This transaction is expected to fail.'
}

export class SwapSimulationError extends Error {
    constructor(cause, decoded) {
        super(
            simulationErrorMessage(decoded),
            { cause },
        )

        this.name = 'SwapSimulationError'
        this.decoded = decoded
    }
}

function positiveBigInt(value) {
    if (typeof value === 'bigint') {
        return value > 0n
            ? value
            : null
    }

    if (
        typeof value !== 'string' &&
        typeof value !== 'number'
    ) {
        return null
    }

    try {
        const parsed = BigInt(value)

        return parsed > 0n
            ? parsed
            : null
    } catch {
        return null
    }
}

function addGasBuffer(estimatedGas) {
    const percentageBuffer =
        (
            estimatedGas *
            GAS_BUFFER_BPS +
            BPS_DENOMINATOR -
            1n
        ) /
        BPS_DENOMINATOR

    const buffer =
        percentageBuffer >
        MINIMUM_GAS_BUFFER
            ? percentageBuffer
            : MINIMUM_GAS_BUFFER

    return estimatedGas + buffer
}

function withoutGas(transaction) {
    const result = {
        ...transaction,
    }

    delete result.gas

    return result
}

export async function runReadOnlySwapSimulation({
                                                    publicClient,
                                                    account,
                                                    transaction,
                                                    onEvent,
                                                }) {
    /*
     * The provider's gas value is useful as a diagnostic, but it must not cap
     * the live eth_estimateGas request. Some provider quotes contain a stale
     * or overly conservative fixed limit.
     */
    const providerGas =
        positiveBigInt(transaction?.gas)

    const transactionForEstimation =
        withoutGas(transaction)

    let preparedTransaction = {
        ...transactionForEstimation,
    }

    if (
        typeof publicClient?.estimateGas ===
        'function'
    ) {
        onEvent?.(
            'simulation.estimate-gas.start',
            {
                providerGas:
                    providerGas?.toString() ??
                    null,
            },
        )

        try {
            const estimatedGas =
                await publicClient.estimateGas({
                    account,
                    ...transactionForEstimation,
                })

            /*
             * Use the live estimate plus either:
             *
             * - a 20% buffer, or
             * - a minimum 25,000 gas buffer.
             *
             * Whichever is larger.
             */
            const safeGas =
                addGasBuffer(estimatedGas)

            preparedTransaction = {
                ...transactionForEstimation,
                gas: safeGas,
            }

            onEvent?.(
                'simulation.estimate-gas.success',
                {
                    providerGas:
                        providerGas?.toString() ??
                        null,

                    estimatedGas:
                        estimatedGas.toString(),

                    safeGas:
                        safeGas.toString(),
                },
            )
        } catch (estimateError) {
            let decoded =
                decodeSimulationRevert(
                    estimateError,
                )

            let diagnosticError =
                estimateError

            /*
             * Retry using eth_call without the provider gas cap so we have a
             * better chance of receiving useful revert data.
             */
            if (
                !decoded &&
                typeof publicClient?.call ===
                'function'
            ) {
                onEvent?.(
                    'simulation.call.fallback.start',
                )

                try {
                    await publicClient.call({
                        account,
                        ...transactionForEstimation,
                    })

                    onEvent?.(
                        'simulation.call.fallback.no-revert-data',
                    )
                } catch (callError) {
                    diagnosticError =
                        callError

                    decoded =
                        decodeSimulationRevert(
                            callError,
                        )

                    onEvent?.(
                        'simulation.call.fallback.failed',
                    )
                }
            }

            throw new SwapSimulationError(
                diagnosticError,
                decoded,
            )
        }
    } else {
        onEvent?.(
            'simulation.estimate-gas.skipped',
        )

        /*
         * If estimation is unavailable, preserve a valid provider gas value.
         * This is a fallback only.
         */
        if (providerGas) {
            preparedTransaction = {
                ...transactionForEstimation,
                gas: providerGas,
            }
        }
    }

    if (
        typeof publicClient?.call ===
        'function'
    ) {
        onEvent?.(
            'simulation.call.start',
            {
                gas:
                    positiveBigInt(
                        preparedTransaction.gas,
                    )?.toString() ??
                    null,
            },
        )

        try {
            await publicClient.call({
                account,
                ...preparedTransaction,
            })

            onEvent?.(
                'simulation.call.success',
            )
        } catch (callError) {
            throw new SwapSimulationError(
                callError,
                decodeSimulationRevert(
                    callError,
                ),
            )
        }
    } else {
        onEvent?.(
            'simulation.call.skipped',
        )
    }

    /*
     * The caller must submit this returned transaction, not the original
     * provider transaction, because this contains the live buffered gas.
     */
    return preparedTransaction
}