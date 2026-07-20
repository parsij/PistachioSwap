import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    bpsAsRatio,
    getPlatformFeeConfiguration,
    platformFeeIncompatibility,
    platformFeeEntry,
} from '../../fees.js'
import type {
    CrossChainAdapter,
    CrossChainFee,
    CrossChainRequest,
    HttpJson,
    ProviderCapabilities,
} from '../../types.js'
import {
    assertExactQuote,
    CrossChainValidationError,
    createExactApprovalTransaction,
    normalizeUint,
    validateProviderTransaction,
} from '../../validation.js'

function records(value: unknown) {
    return Array.isArray(value) ? value.filter(isRecord) : []
}

export function createAcrossAdapter(http: HttpJson = fetchJson): CrossChainAdapter {
    const config = getApiConfig().crossChain
    const provider = config.across
    const headers: Record<string, string> = provider.apiKey
        ? { authorization: `Bearer ${provider.apiKey}` }
        : {}

    return {
        name: 'across',
        async getCapabilities(signal) {
            if (!provider.enabled) return unavailable('disabled')
            if (!provider.apiKey || !provider.integratorId) {
                return unavailable('not configured: API key and integrator ID are required')
            }
            const incompatible = platformFeeIncompatibility('across')
            if (incompatible) return unavailable(incompatible)
            const url = new URL(`${provider.baseUrl}/swap/tokens`)
            url.searchParams.set('integratorId', provider.integratorId)
            const payload = await http(url, {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
            })
            const tokens = records(isRecord(payload) ? payload.tokens : payload).flatMap((token) => {
                const chainId = Number(token.chainId)
                const tokenAddress = address(token.address)
                return Number.isInteger(chainId) && tokenAddress
                    ? [{ chainId, address: tokenAddress }]
                    : []
            })
            const routes = tokens.flatMap((sell) => tokens
                .filter((buy) => buy.chainId !== sell.chainId)
                .map((buy) => ({
                    sourceChainId: sell.chainId,
                    destinationChainId: buy.chainId,
                    sellTokens: [sell.address],
                    buyTokens: [buy.address],
                    transactionTargets: [],
                })))
            return {
                provider: 'across',
                available: routes.length > 0,
                fetchedAt: new Date().toISOString(),
                routes,
                ...(routes.length ? {} : { reason: 'Provider supplied no verifiable contract metadata.' }),
            }
        },
        async getQuote(request, capabilities, signal) {
            const platformFee = getPlatformFeeConfiguration('across')
            const url = new URL(`${provider.baseUrl}/swap/approval`)
            for (const [key, value] of Object.entries({
                tradeType: 'exactInput',
                originChainId: request.sourceAsset.chainId,
                destinationChainId: request.destinationAsset.chainId,
                inputToken: request.sourceAsset.address,
                outputToken: request.destinationAsset.address,
                amount: request.amount,
                depositor: request.ownerAddress,
                recipient: request.recipient,
                slippage: bpsAsRatio(request.slippageBps),
                ...(provider.integratorId ? { integratorId: provider.integratorId } : {}),
                ...(platformFee.bps > 0
                    ? {
                          appFee: bpsAsRatio(platformFee.bps),
                          appFeeRecipient: platformFee.recipient!,
                      }
                    : {}),
            })) url.searchParams.set(key, String(value))
            const payload = await http(url, { headers, signal, timeoutMs: config.quoteTimeoutMs })
            if (!isRecord(payload)) throw new Error('Across returned an invalid quote.')
            const tx = isRecord(payload.swapTx) ? payload.swapTx : payload.transaction
            if (!isRecord(tx)) throw new Error('Across returned no source transaction.')
            const transactionTarget = address(tx.to)
            if (!transactionTarget) throw new Error('Across returned an invalid transaction target.')
            validateAcrossDestination(payload, request)
            const buyAmount = normalizeUint(
                payload.expectedOutputAmount ?? payload.outputAmount,
                'buy amount',
            )
            const appFee = platformFeeEntry({
                bps: platformFee.bps,
                token: request.destinationAsset.address,
                baseAmount: buyAmount,
            })
            const fees = [
                ...parseFees(payload.fees, request.sourceAsset.address),
                ...(appFee ? [appFee] : []),
            ]
            const approval = normalizeAcrossApprovals(payload, request)
            const transaction = {
                ...validateProviderTransaction(tx, request, {
                    ...capabilities,
                    routes: [{
                        sourceChainId: request.sourceAsset.chainId,
                        destinationChainId: request.destinationAsset.chainId,
                        transactionTargets: [transactionTarget],
                    }],
                }),
                allowanceTarget: approval.spender,
            }
            const approvalSteps = approval.transactions.map((approvalTransaction, index) => ({
                id: `approval-${index}`,
                index,
                type: 'approval' as const,
                label: 'Approve source token',
                chainId: request.sourceAsset.chainId,
                status: 'ready' as const,
                transaction: approvalTransaction,
            }))
            return assertExactQuote({
                provider: 'across',
                request,
                buyAmount,
                minimumBuyAmount: normalizeUint(
                    payload.minOutputAmount ?? payload.minimumOutputAmount ?? buyAmount,
                    'minimum buy amount',
                ),
                fees,
                estimatedDurationSeconds: numberOrNull(payload.estimatedFillTimeSec),
                executionModel: 'evm-transaction',
                steps: [
                    ...approvalSteps,
                    {
                        id: 'source-transaction',
                        index: approvalSteps.length,
                        type: 'source-transaction',
                        label: 'Submit source transaction',
                        chainId: request.sourceAsset.chainId,
                        status: 'ready',
                        transaction,
                    } as const,
                ],
                transaction,
                deposit: null,
                statusId: stringOrNull(payload.depositId ?? payload.id),
                expiresAt: expiry(payload.expiration),
            }, request)
        },
        async getStatus(statusId, signal) {
            const url = new URL(`${provider.baseUrl}/deposit/status`)
            url.searchParams.set('depositId', statusId)
            const payload = await http(url, { headers, signal, timeoutMs: config.quoteTimeoutMs })
            const value = isRecord(payload) ? payload : {}
            return {
                provider: 'across',
                statusId,
                status: mapStatus(value.status),
                sourceTransactionHash: stringOrNull(value.sourceTxHash ?? value.depositTxHash),
                destinationTransactionHash: stringOrNull(value.destinationTxHash ?? value.fillTxHash),
            }
        },
    }
}

function validateAcrossDestination(
    payload: Record<string, unknown>,
    request: CrossChainRequest,
) {
    const steps = isRecord(payload.steps) ? payload.steps : null
    const destinationSwap = steps && isRecord(steps.destinationSwap)
        ? steps.destinationSwap
        : null
    const tokenOut = destinationSwap && isRecord(destinationSwap.tokenOut)
        ? destinationSwap.tokenOut
        : null
    const outputToken = address(
        tokenOut?.address ?? payload.outputToken ?? payload.destinationToken,
    )
    if (outputToken && outputToken !== request.destinationAsset.address) {
        throw new Error('Across returned a different destination token.')
    }
    if (tokenOut?.chainId !== undefined &&
        Number(tokenOut.chainId) !== request.destinationAsset.chainId) {
        throw new Error('Across returned the wrong destination chain.')
    }
    const recipient = address(payload.recipient)
    if (recipient && recipient !== request.recipient) {
        throw new Error('Across returned a different destination recipient.')
    }
}

function normalizeAcrossApprovals(
    payload: Record<string, unknown>,
    request: CrossChainRequest,
) {
    if (request.sourceAsset.address === NATIVE_TOKEN_ADDRESS) {
        return { transactions: [], spender: null }
    }
    const checks = isRecord(payload.checks) ? payload.checks : null
    const allowance = checks && isRecord(checks.allowance) ? checks.allowance : null
    if (!allowance) {
        return { transactions: [], spender: null }
    }

    const tokenMetadata = isRecord(allowance.token) ? allowance.token : null
    const token = normalizeAddress(tokenMetadata?.address ?? allowance.token)
    if (token !== request.sourceAsset.address) {
        throw acrossError('APPROVAL_TARGET_INVALID', 'Across allowance token does not match the source token.')
    }
    if (
        tokenMetadata?.chainId !== undefined &&
        Number(tokenMetadata.chainId) !== request.sourceAsset.chainId
    ) throw acrossError('APPROVAL_TARGET_INVALID', 'Across allowance token is for the wrong chain.')
    const spender = normalizeAddress(allowance.spender)
    if (!spender) throw acrossError('AUTHORITY_UNAVAILABLE', 'Across returned an invalid allowance spender.')
    let expected
    let actual
    try {
        expected = normalizeUint(allowance.expected, 'allowance expected amount')
        actual = normalizeUint(allowance.actual, 'allowance actual amount')
    } catch (error) {
        throw acrossError(
            'APPROVAL_AMOUNT_INVALID',
            error instanceof Error ? error.message : 'Across returned invalid allowance amounts.',
        )
    }
    if (expected === '0' || BigInt(expected) === (2n ** 256n) - 1n) {
        throw acrossError(
            'APPROVAL_AMOUNT_INVALID',
            'Across returned a zero or unlimited approval amount.',
        )
    }
    const originInput = acrossOriginInputAmount(payload, request.sourceAsset.address)
    if (BigInt(expected) > BigInt(request.amount)) {
        throw acrossError(
            'APPROVAL_AMOUNT_INVALID',
            'Across required allowance exceeds the exact-input amount.',
        )
    }
    if (originInput !== null && originInput !== expected) {
        throw acrossError(
            'APPROVAL_AMOUNT_INVALID',
            'Across required allowance conflicts with its origin input amount.',
        )
    }
    if (BigInt(actual) >= BigInt(expected)) return { transactions: [], spender }
    return {
        transactions: [createExactApprovalTransaction({
            chainId: request.sourceAsset.chainId,
            token,
            spender,
            amount: expected,
        })],
        spender,
    }
}

function acrossOriginInputAmount(payload: Record<string, unknown>, token: string) {
    const checks = isRecord(payload.checks) ? payload.checks : {}
    const balance = isRecord(checks.balance) ? checks.balance : null
    const balanceToken = balance && isRecord(balance.token) ? balance.token.address : balance?.token
    if (balance && (balanceToken === undefined || normalizeAddress(balanceToken) === token)) {
        for (const value of [balance.expected, balance.required]) {
            if (value === undefined) continue
            try {
                return normalizeUint(value, 'origin input amount')
            } catch {
                throw acrossError('ROUTE_MALFORMED', 'Across returned an invalid origin input amount.')
            }
        }
    }
    const steps = isRecord(payload.steps) ? payload.steps : {}
    for (const step of [steps.originSwap, steps.bridge]) {
        if (!isRecord(step)) continue
        const stepToken = isRecord(step.tokenIn) ? step.tokenIn.address : step.inputToken
        if (stepToken !== undefined && normalizeAddress(stepToken) !== token) continue
        for (const value of [step.inputAmount, step.amount, step.amountIn]) {
            if (value === undefined) continue
            try {
                return normalizeUint(value, 'origin input amount')
            } catch {
                throw acrossError('ROUTE_MALFORMED', 'Across returned an invalid origin input amount.')
            }
        }
    }
    return null
}

function acrossError(suffix: string, message: string) {
    return new CrossChainValidationError(`ACROSS_${suffix}`, message)
}

function unavailable(reason: string): ProviderCapabilities {
    return { provider: 'across', available: false, fetchedAt: new Date().toISOString(), routes: [], reason }
}
function address(value: unknown) {
    return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
        ? value.toLowerCase()
        : null
}
function stringOrNull(value: unknown) {
    return typeof value === 'string' && value.length <= 256 ? value : null
}
function numberOrNull(value: unknown) {
    const result = Number(value)
    return Number.isFinite(result) && result >= 0 ? result : null
}
function expiry(value: unknown) {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number(value) * 1000
    return new Date(Number.isFinite(parsed) && parsed > Date.now() ? parsed : Date.now() + 60_000).toISOString()
}
function parseFees(value: unknown, token: string): CrossChainFee[] {
    if (!isRecord(value)) return []
    return Object.entries(value).flatMap(([type, fee]) => {
        if (/app/i.test(type)) return []
        const amount = isRecord(fee) ? fee.amount : fee
        return typeof amount === 'string' && /^(?:0|[1-9]\d*)$/.test(amount)
            ? [{ type: type.toLowerCase().includes('gas') ? 'gas' as const : 'bridge' as const, token, amount }]
            : []
    })
}
function mapStatus(value: unknown) {
    const status = String(value ?? '').toLowerCase()
    if (/filled|complete|success/.test(status)) return 'completed' as const
    if (/refund/.test(status)) return 'refunded' as const
    if (/fail|expired/.test(status)) return 'failed' as const
    if (/fill|destination/.test(status)) return 'destination-confirming' as const
    if (/pending|deposit/.test(status)) return 'in-flight' as const
    return 'unknown' as const
}
