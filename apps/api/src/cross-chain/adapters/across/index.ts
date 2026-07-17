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
    normalizeUint,
    validateExactApprovalTransaction,
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
            const incompatible = platformFeeIncompatibility('across')
            if (incompatible) return unavailable(incompatible)
            const url = new URL(`${provider.baseUrl}/available-routes`)
            const payload = await http(url, {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
            })
            const routes = records(isRecord(payload) ? payload.routes : payload).flatMap((route) => {
                const sourceChainId = Number(route.originChainId)
                const destinationChainId = Number(route.destinationChainId)
                const sellToken = address(route.originToken)
                const buyToken = address(route.destinationToken)
                const targets = [
                    route.spokePoolAddress,
                    route.depositContract,
                    isRecord(route.contracts) ? route.contracts.spokePool : null,
                ].map(address).filter((item): item is string => Boolean(item))
                return Number.isInteger(sourceChainId) &&
                    Number.isInteger(destinationChainId) &&
                    sellToken && buyToken
                    ? [{
                          sourceChainId,
                          destinationChainId,
                          sellTokens: [sellToken],
                          buyTokens: [buyToken],
                          transactionTargets: targets,
                      }]
                    : []
            })
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
                tradeType: 'minOutput',
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
                ...validateProviderTransaction(tx, request, capabilities),
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

function normalizeAcrossApprovals(
    payload: Record<string, unknown>,
    request: CrossChainRequest,
) {
    if (request.sourceAsset.address === NATIVE_TOKEN_ADDRESS) {
        return { transactions: [], spender: null }
    }
    const checks = isRecord(payload.checks) ? payload.checks : null
    const allowance = checks && isRecord(checks.allowance) ? checks.allowance : null
    const rawTransactions = payload.approvalTxns
    if (rawTransactions !== undefined && !Array.isArray(rawTransactions)) {
        throw new Error('Across returned invalid approval transactions.')
    }
    const transactions = records(rawTransactions)
    if (
        Array.isArray(rawTransactions) &&
        transactions.length !== rawTransactions.length
    ) throw new Error('Across returned invalid approval transactions.')
    if (!allowance) {
        if (transactions.length) {
            throw new Error('Across approval transactions lack authoritative allowance metadata.')
        }
        return { transactions: [], spender: null }
    }

    const tokenMetadata = isRecord(allowance.token) ? allowance.token : null
    const token = normalizeAddress(tokenMetadata?.address ?? allowance.token)
    if (token !== request.sourceAsset.address) {
        throw new Error('Across allowance token does not match the source token.')
    }
    if (
        tokenMetadata?.chainId !== undefined &&
        Number(tokenMetadata.chainId) !== request.sourceAsset.chainId
    ) throw new Error('Across allowance token is for the wrong chain.')
    const spender = normalizeAddress(allowance.spender)
    if (!spender) throw new Error('Across returned an invalid allowance spender.')
    const expected = normalizeUint(allowance.expected, 'allowance expected amount')
    const actual = normalizeUint(allowance.actual, 'allowance actual amount')
    if (expected !== request.amount) {
        throw new Error('Across allowance amount does not exactly match the request.')
    }
    if (BigInt(actual) < BigInt(expected) && transactions.length === 0) {
        throw new Error('Across omitted a required approval transaction.')
    }
    if (BigInt(actual) >= BigInt(expected) && transactions.length > 0) {
        throw new Error('Across returned an unnecessary approval transaction.')
    }
    return {
        transactions: transactions.map((transaction) =>
            validateExactApprovalTransaction(transaction, {
                chainId: request.sourceAsset.chainId,
                token: request.sourceAsset.address,
                spenders: [spender],
                amount: request.amount,
            })),
        spender,
    }
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
