import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    getPlatformFeeConfiguration,
    platformFeeEntry,
    platformFeeIncompatibility,
} from '../../fees.js'
import type {
    CrossChainAdapter,
    CrossChainFee,
    CrossChainRequest,
    CrossChainStep,
    HttpJson,
    ProviderCapabilities,
} from '../../types.js'
import {
    assertExactQuote,
    createExactApprovalTransaction,
    normalizeUint,
    validateProviderTransaction,
} from '../../validation.js'

const PROVIDER = '0x-cross-chain' as const

export function createZeroXCrossChainAdapter(
    http: HttpJson = fetchJson,
): CrossChainAdapter {
    const config = getApiConfig().crossChain
    const provider = config.zeroX
    const headers: Record<string, string> = provider.apiKey
        ? { '0x-api-key': provider.apiKey, '0x-version': 'v2' }
        : { '0x-version': 'v2' }

    return {
        name: PROVIDER,
        async getCapabilities(signal) {
            if (!provider.enabled) return unavailable('disabled')
            if (!provider.apiKey) return unavailable('not configured')
            const incompatible = platformFeeIncompatibility(PROVIDER)
            if (incompatible) return unavailable(incompatible)

            const payload = await http(
                new URL('/cross-chain/sources', provider.baseUrl),
                { headers, signal, timeoutMs: config.quoteTimeoutMs },
            )
            const chainIds = readSupportedChainIds(payload)
            const routes = chainIds.flatMap((sourceChainId) =>
                chainIds
                    .filter((destinationChainId) => destinationChainId !== sourceChainId)
                    .map((destinationChainId) => ({
                        sourceChainId,
                        destinationChainId,
                        transactionTargets: [],
                    })),
            )
            return {
                provider: PROVIDER,
                available: routes.length > 0,
                fetchedAt: new Date().toISOString(),
                routes,
                ...(routes.length ? {} : { reason: 'Provider supplied no supported chain pairs.' }),
            }
        },
        async getQuote(request, capabilities, signal) {
            const fee = getPlatformFeeConfiguration(PROVIDER)
            const url = new URL('/cross-chain/quotes', provider.baseUrl)
            const query = {
                originChain: request.sourceAsset.chainId,
                destinationChain: request.destinationAsset.chainId,
                sellToken: request.sourceAsset.address,
                buyToken: request.destinationAsset.address,
                sellAmount: request.amount,
                originAddress: request.ownerAddress,
                destinationAddress: request.recipient,
                slippageBps: request.slippageBps,
                maxNumQuotes: 1,
                sortQuotesBy: 'buyAmount',
                ...(fee.bps > 0 ? {
                    feeBps: fee.bps,
                    feeRecipient: fee.recipient!,
                    feeToken: request.sourceAsset.address,
                } : {}),
            }
            for (const [key, value] of Object.entries(query)) {
                url.searchParams.set(key, String(value))
            }

            const payload = await http(url, {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
            })
            const quote = firstQuote(payload)
            verifyEchoedRequest(quote, request)

            const transactionValue = isRecord(quote.transaction) && isRecord(quote.transaction.details)
                ? quote.transaction.details
                : quote.transaction
            if (!isRecord(transactionValue)) throw new Error('0x returned no origin transaction.')
            const target = normalizeAddress(transactionValue.to)
            if (!target || target === NATIVE_TOKEN_ADDRESS) {
                throw new Error('0x returned an invalid origin transaction target.')
            }
            const authoritativeCapabilities: ProviderCapabilities = {
                ...capabilities,
                routes: [{
                    sourceChainId: request.sourceAsset.chainId,
                    destinationChainId: request.destinationAsset.chainId,
                    transactionTargets: [target],
                }],
            }
            const transaction = validateProviderTransaction({
                ...transactionValue,
                chainId: request.sourceAsset.chainId,
            }, request, authoritativeCapabilities)
            const allowanceTarget = normalizeAddress(
                quote.allowanceTarget ?? transactionValue.allowanceTarget,
            )
            const allowanceIssue = isRecord(quote.issues) && isRecord(quote.issues.allowance)
                ? quote.issues.allowance
                : null
            const issueSpender = allowanceIssue
                ? normalizeAddress(allowanceIssue.spender)
                : null
            if (issueSpender && issueSpender !== allowanceTarget) {
                throw new Error('0x returned inconsistent approval targets.')
            }
            const approval = allowanceTarget && request.sourceAsset.address !== NATIVE_TOKEN_ADDRESS
                ? createExactApprovalTransaction({
                      chainId: request.sourceAsset.chainId,
                      token: request.sourceAsset.address,
                      spender: allowanceTarget,
                      amount: request.amount,
                  })
                : null
            const executableTransaction = {
                ...transaction,
                allowanceTarget: approval?.allowanceTarget ?? null,
            }
            const providerQuoteId = text(quote.quoteId)
            if (!providerQuoteId || !/^[a-zA-Z0-9_\-.]{1,200}$/.test(providerQuoteId)) {
                throw new Error('0x returned an invalid quote identifier.')
            }
            const appFee = platformFeeEntry({
                bps: fee.bps,
                token: request.sourceAsset.address,
                baseAmount: request.amount,
            })

            return assertExactQuote({
                provider: PROVIDER,
                request,
                buyAmount: normalizeUint(
                    quote.buyAmount ?? quote.destinationAmount,
                    'buy amount',
                ),
                minimumBuyAmount: normalizeUint(
                    quote.minimumBuyAmount ?? quote.minBuyAmount ?? quote.buyAmount,
                    'minimum buy amount',
                ),
                fees: [
                    ...readFees(quote.fees, request),
                    ...(appFee ? [appFee] : []),
                ],
                estimatedDurationSeconds: finite(
                    quote.estimatedDurationSeconds ?? quote.estimatedTimeSeconds,
                ),
                executionModel: 'evm-transaction',
                steps: buildSteps(request, executableTransaction, approval),
                transaction: executableTransaction,
                deposit: null,
                statusId: `${request.sourceAsset.chainId}:${providerQuoteId}`,
                expiresAt: new Date(Date.now() + 45_000).toISOString(),
            }, request)
        },
        async getStatus(statusId, signal, sourceTransactionHash) {
            const [originChain, quoteId] = statusId.split(':', 2)
            if (!/^\d+$/.test(originChain) || !quoteId || !sourceTransactionHash) {
                throw new Error('0x status tracking requires the submitted origin transaction.')
            }
            const url = new URL('/cross-chain/status', provider.baseUrl)
            url.searchParams.set('originChain', originChain)
            url.searchParams.set('originTxHash', sourceTransactionHash)
            url.searchParams.set('quoteId', quoteId)
            const payload = await http(url, {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
            })
            const value = isRecord(payload) ? payload : {}
            return {
                provider: PROVIDER,
                statusId,
                status: mapStatus(value.status),
                sourceTransactionHash,
                destinationTransactionHash: transactionHash(
                    value.destinationTxHash ?? value.destinationTransactionHash,
                ),
            }
        },
    }
}

function unavailable(reason: string): ProviderCapabilities {
    return {
        provider: PROVIDER,
        available: false,
        fetchedAt: new Date().toISOString(),
        routes: [],
        reason,
    }
}

function readSupportedChainIds(payload: unknown) {
    const value = isRecord(payload) ? payload : {}
    const sources = Array.isArray(value.sources)
        ? value.sources
        : Array.isArray(value.chains) ? value.chains : []
    return [...new Set(sources.flatMap((source) => {
        const record = isRecord(source) ? source : {}
        const chainId = Number(record.chainId ?? record.id)
        return Number.isInteger(chainId) && chainId > 0 ? [chainId] : []
    }))]
}

function firstQuote(payload: unknown) {
    const value = isRecord(payload) ? payload : {}
    const quote = Array.isArray(value.quotes) ? value.quotes[0] : value.quote
    if (!isRecord(quote)) throw new Error('0x returned no cross-chain quote.')
    return quote
}

function verifyEchoedRequest(quote: Record<string, unknown>, request: CrossChainRequest) {
    const checks: Array<[unknown, number, string]> = [
        [quote.originChain ?? quote.sourceChainId, request.sourceAsset.chainId, 'origin chain'],
        [quote.destinationChain ?? quote.destinationChainId, request.destinationAsset.chainId, 'destination chain'],
    ]
    for (const [actual, expected, label] of checks) {
        if (actual !== undefined && Number(actual) !== expected) {
            throw new Error(`0x quote has the wrong ${label}.`)
        }
    }
    const sellToken = quote.sellToken === undefined ? null : normalizeAddress(quote.sellToken)
    const buyToken = quote.buyToken === undefined ? null : normalizeAddress(quote.buyToken)
    if (quote.sellToken !== undefined && sellToken !== request.sourceAsset.address) {
        throw new Error('0x quote has the wrong sell token.')
    }
    if (quote.buyToken !== undefined && buyToken !== request.destinationAsset.address) {
        throw new Error('0x quote has the wrong buy token.')
    }
    const recipient = quote.destinationAddress === undefined && quote.recipient === undefined
        ? null
        : normalizeAddress(quote.destinationAddress ?? quote.recipient)
    if (recipient && recipient !== request.recipient) {
        throw new Error('0x quote has the wrong destination recipient.')
    }
    if (quote.sellAmount !== undefined && normalizeUint(quote.sellAmount, 'sell amount') !== request.amount) {
        throw new Error('0x quote has the wrong sell amount.')
    }
}

function buildSteps(
    request: CrossChainRequest,
    transaction: NonNullable<ReturnType<typeof validateProviderTransaction>>,
    approval: ReturnType<typeof createExactApprovalTransaction> | null,
): CrossChainStep[] {
    const steps: CrossChainStep[] = []
    if (approval) {
        steps.push({
            id: 'approval',
            index: steps.length,
            type: 'approval',
            label: 'Approve source token',
            chainId: request.sourceAsset.chainId,
            status: 'ready',
            transaction: approval,
        })
    }
    steps.push({
        id: 'source-transaction',
        index: steps.length,
        type: 'source-transaction',
        label: 'Swap on source chain',
        chainId: request.sourceAsset.chainId,
        status: 'ready',
        transaction,
    }, {
        id: 'cross-chain-transfer',
        index: steps.length + 1,
        type: 'wait',
        label: 'Transfer across chains',
        chainId: null,
        status: 'pending',
        transaction: null,
    }, {
        id: 'destination',
        index: steps.length + 2,
        type: 'destination',
        label: 'Complete on destination chain',
        chainId: request.destinationAsset.chainId,
        status: 'pending',
        transaction: null,
    })
    return steps
}

function readFees(value: unknown, request: CrossChainRequest): CrossChainFee[] {
    const entries = Array.isArray(value)
        ? value
        : isRecord(value) ? Object.entries(value).map(([type, fee]) => ({ type, fee })) : []
    return entries.flatMap((entry) => {
        const record = isRecord(entry) ? entry : {}
        const nested = isRecord(record.fee) ? record.fee : record
        const amountValue = nested.amount ?? nested.amountWei
        if (amountValue === undefined) return []
        let amount: string
        try {
            amount = normalizeUint(amountValue, 'fee amount')
        } catch {
            return []
        }
        return [{
            type: 'provider' as const,
            token: normalizeAddress(nested.token ?? nested.tokenAddress) ?? request.sourceAsset.address,
            amount,
            includedInQuote: nested.includedInQuote !== false,
        }]
    })
}

function mapStatus(value: unknown) {
    const status = String(value ?? '').toLowerCase()
    if (['success', 'completed', 'complete'].includes(status)) return 'completed' as const
    if (['failed', 'reverted'].includes(status)) return 'failed' as const
    if (['refunded'].includes(status)) return 'refunded' as const
    if (['pending', 'submitted'].includes(status)) return 'pending' as const
    if (['inflight', 'in_flight', 'bridging'].includes(status)) return 'in-flight' as const
    return 'unknown' as const
}

function transactionHash(value: unknown) {
    const hash = String(value ?? '').toLowerCase()
    return /^0x[a-f0-9]{64}$/.test(hash) ? hash : null
}

function finite(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

function text(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}
