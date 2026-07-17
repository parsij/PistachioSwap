import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS } from '../../../lib/address.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    getPlatformFeeConfiguration,
    platformFeeIncompatibility,
    platformFeeEntry,
} from '../../fees.js'
import type {
    CrossChainAdapter,
    HttpJson,
    ProviderCapabilities,
} from '../../types.js'
import {
    assertExactQuote,
    normalizeUint,
    validateExactApprovalTransaction,
    validateProviderTransaction,
} from '../../validation.js'

export function createRelayAdapter(http: HttpJson = fetchJson): CrossChainAdapter {
    const config = getApiConfig().crossChain
    const provider = config.relay
    const headers: Record<string, string> = provider.apiKey
        ? { 'x-api-key': provider.apiKey }
        : {}

    return {
        name: 'relay',
        async getCapabilities(signal) {
            if (!provider.enabled) return unavailable('disabled')
            const incompatible = platformFeeIncompatibility('relay')
            if (incompatible) return unavailable(incompatible)
            const payload = await http(new URL(`${provider.baseUrl}/chains`), {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
            })
            const chains = array(isRecord(payload) ? payload.chains : payload)
            const metadata = chains.flatMap((chain) => {
                const chainId = Number(chain.id ?? chain.chainId)
                const contracts = isRecord(chain.contracts) ? chain.contracts : {}
                const targets = collectContractAddresses(contracts)
                return Number.isInteger(chainId) && targets.length ? [{ chainId, targets }] : []
            })
            const routes = metadata.flatMap((source) =>
                metadata.filter((destination) => destination.chainId !== source.chainId)
                    .map((destination) => ({
                        sourceChainId: source.chainId,
                        destinationChainId: destination.chainId,
                        transactionTargets: source.targets,
                        approvalSpenders: source.targets,
                    })),
            )
            return {
                provider: 'relay',
                available: routes.length > 0,
                fetchedAt: new Date().toISOString(),
                routes,
                ...(routes.length ? {} : { reason: 'Provider supplied no verifiable contract metadata.' }),
            }
        },
        async getQuote(request, capabilities, signal) {
            const platformFee = getPlatformFeeConfiguration('relay')
            const payload = await http(new URL(`${provider.baseUrl}/quote/v2`), {
                method: 'POST',
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
                body: {
                    user: request.ownerAddress,
                    recipient: request.recipient,
                    originChainId: request.sourceAsset.chainId,
                    destinationChainId: request.destinationAsset.chainId,
                    originCurrency: request.sourceAsset.address,
                    destinationCurrency: request.destinationAsset.address,
                    amount: request.amount,
                    tradeType: 'EXACT_INPUT',
                    slippageTolerance: String(request.slippageBps),
                    ...(platformFee.bps > 0
                        ? {
                              appFees: [{
                                  recipient: platformFee.recipient!,
                                  fee: String(platformFee.bps),
                              }],
                          }
                        : {}),
                },
            })
            if (!isRecord(payload)) throw new Error('Relay returned an invalid quote.')
            const details = isRecord(payload.details) ? payload.details : {}
            const currencyOut = isRecord(details.currencyOut) ? details.currencyOut : {}
            const transactionSteps = normalizeTransactions(
                payload.steps,
                request,
                capabilities,
            )
            if (!transactionSteps.length) throw new Error('Relay returned no executable transaction.')
            const buyAmount = normalizeUint(currencyOut.amount, 'buy amount')
            const appFee = platformFeeEntry({
                bps: platformFee.bps,
                token: request.sourceAsset.address,
                baseAmount: request.amount,
            })
            return assertExactQuote({
                provider: 'relay',
                request,
                buyAmount,
                minimumBuyAmount: normalizeUint(currencyOut.minimumAmount ?? buyAmount, 'minimum buy amount'),
                fees: [
                    ...parseFees(payload.fees ?? details.fees, request.sourceAsset.address),
                    ...(appFee ? [appFee] : []),
                ],
                estimatedDurationSeconds: finite(details.timeEstimate ?? payload.timeEstimate),
                executionModel: 'evm-transaction',
                steps: transactionSteps.map(({ requestId: _requestId, ...step }) => step),
                transaction: transactionSteps[0].transaction,
                deposit: null,
                statusId: text(
                    transactionSteps.find(({ requestId }) => requestId)?.requestId ??
                    payload.requestId,
                ),
                expiresAt: expiration(payload),
            }, request)
        },
        async getStatus(statusId, signal) {
            const url = new URL(`${provider.baseUrl}/intents/status/v3`)
            url.searchParams.set('requestId', statusId)
            const payload = await http(url, {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
                notFoundAsNull: true,
            })
            const value = isRecord(payload) ? payload : {}
            return {
                provider: 'relay',
                statusId,
                status: mapStatus(value.status),
                sourceTransactionHash: text(value.originTxHash ?? value.sourceTxHash),
                destinationTransactionHash: text(value.destinationTxHash),
            }
        },
    }
}

function normalizeTransactions(
    value: unknown,
    request: Parameters<typeof validateProviderTransaction>[1],
    capabilities: ProviderCapabilities,
) {
    const result: Array<{
        id: string
        index: number
        type: 'approval' | 'source-transaction'
        label: string
        chainId: number
        status: 'ready'
        transaction: ReturnType<typeof validateProviderTransaction>
        requestId: unknown
    }> = []
    for (const [stepIndex, step] of array(value).entries()) {
        for (const [itemIndex, item] of array(step.items).entries()) {
            const data = isRecord(item.data) ? item.data : item
            if (typeof data.to !== 'string') continue
            const approval = /^(?:approve|approval)$/i.test(
                String(step.id ?? step.kind ?? ''),
            )
            if (
                approval &&
                request.sourceAsset.address === NATIVE_TOKEN_ADDRESS
            ) continue
            const chainId = Number(data.chainId)
            if (!Number.isInteger(chainId)) throw new Error('Relay transaction chain is invalid.')
            const transaction = approval
                ? validateRelayApproval(data, request, capabilities)
                : validateProviderTransaction(data, request, capabilities, chainId)
            result.push({
                id: `${String(step.id ?? `step-${stepIndex}`)}-${itemIndex}`,
                index: result.length,
                type: approval ? 'approval' : 'source-transaction',
                label: String(step.action ?? step.description ?? 'Execute Relay transaction'),
                chainId,
                status: 'ready',
                transaction,
                requestId: step.requestId,
            })
        }
    }
    return result
}

function validateRelayApproval(
    value: unknown,
    request: Parameters<typeof validateProviderTransaction>[1],
    capabilities: ProviderCapabilities,
) {
    const route = capabilities.routes.find((candidate) =>
        candidate.sourceChainId === request.sourceAsset.chainId &&
        candidate.destinationChainId === request.destinationAsset.chainId,
    )
    if (!route?.approvalSpenders?.length) {
        throw new Error('Relay approval spender metadata is unavailable for the source chain.')
    }
    return validateExactApprovalTransaction(value, {
        chainId: request.sourceAsset.chainId,
        token: request.sourceAsset.address,
        spenders: route.approvalSpenders,
        amount: request.amount,
    })
}

function collectContractAddresses(value: Record<string, unknown>): string[] {
    const targets = new Set<string>()
    const visit = (candidate: unknown) => {
        const normalized = address(candidate)
        if (normalized) {
            targets.add(normalized)
            return
        }
        if (isRecord(candidate)) {
            for (const [key, nested] of Object.entries(candidate)) {
                visit(key)
                visit(nested)
            }
        }
    }
    visit(value)
    return [...targets]
}
function array(value: unknown) {
    return Array.isArray(value) ? value.filter(isRecord) : []
}
function unavailable(reason: string): ProviderCapabilities {
    return { provider: 'relay', available: false, fetchedAt: new Date().toISOString(), routes: [], reason }
}
function address(value: unknown) {
    return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null
}
function text(value: unknown) {
    return typeof value === 'string' && value.length <= 256 ? value : null
}
function finite(value: unknown) {
    const result = Number(value)
    return Number.isFinite(result) && result >= 0 ? result : null
}
function expiration(payload: Record<string, unknown>) {
    const raw = payload.expiresAt ?? payload.expiration
    const parsed = typeof raw === 'string' ? Date.parse(raw) : Number(raw) * 1000
    return new Date(Number.isFinite(parsed) && parsed > Date.now() ? parsed : Date.now() + 60_000).toISOString()
}
function parseFees(value: unknown, token: string) {
    if (!isRecord(value)) return []
    return Object.entries(value).flatMap(([name, fee]) => {
        if (/app/i.test(name)) return []
        if (!isRecord(fee)) return []
        const amount = isRecord(fee.amount) ? fee.amount.raw : fee.amount
        const currency = isRecord(fee.currency) ? fee.currency.address : fee.currency
        return typeof amount === 'string' && /^\d+$/.test(amount)
            ? [{
                  type: name === 'gas' ? 'gas' as const : 'relayer' as const,
                  token: address(currency) ?? token,
                  amount,
              }]
            : []
    })
}
function mapStatus(value: unknown) {
    const status = String(value ?? '').toLowerCase()
    if (/success|complete/.test(status)) return 'completed' as const
    if (/refund/.test(status)) return 'refunded' as const
    if (/fail/.test(status)) return 'failed' as const
    if (/submitted|destination/.test(status)) return 'destination-confirming' as const
    if (/depositing|pending/.test(status)) return 'source-confirming' as const
    if (/waiting|delayed/.test(status)) return 'in-flight' as const
    return 'unknown' as const
}
