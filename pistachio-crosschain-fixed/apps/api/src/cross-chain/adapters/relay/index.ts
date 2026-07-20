import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    getPlatformFeeConfiguration,
    platformFeeIncompatibility,
    platformFeeEntry,
} from '../../fees.js'
import type {
    CrossChainAdapter,
    CrossChainRequest,
    HttpJson,
    ProviderCapabilities,
} from '../../types.js'
import {
    assertExactQuote,
    CrossChainValidationError,
    normalizeUint,
    validateExactApprovalTransaction,
    validateProviderTransaction,
} from '../../validation.js'
import {
    addUsdDecimals,
    emptyCrossChainCosts,
    normalizeUsdDecimal,
    subtractUsdDecimal,
} from '../../costs.js'

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
                const authority = relayAuthority(chain)
                const targets = relayTransactionTargets(authority)
                return Number.isInteger(chainId) && targets.length
                    ? [{ chainId, targets, authority }]
                    : []
            })
            const routes = metadata.flatMap((source) =>
                metadata.filter((destination) => destination.chainId !== source.chainId)
                    .map((destination) => ({
                        sourceChainId: source.chainId,
                        destinationChainId: destination.chainId,
                        transactionTargets: source.targets,
                        relayAuthority: source.authority,
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
            verifyRelayDestination(currencyOut, details, request)
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
            const costs = normalizeRelayCosts(payload, details)
            return assertExactQuote({
                provider: 'relay',
                request,
                buyAmount,
                minimumBuyAmount: normalizeUint(currencyOut.minimumAmount ?? buyAmount, 'minimum buy amount'),
                fees: [
                    ...parseFees(payload.fees ?? details.fees, request.sourceAsset.address),
                    ...(appFee ? [appFee] : []),
                ],
                costs,
                feeIncluded: true,
                costBreakdownAvailable: relayCostBreakdownAvailable(costs),
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

export function normalizeRelayCosts(
    payload: Record<string, unknown>,
    details: Record<string, unknown> = {},
) {
    const fees = isRecord(payload.fees)
        ? payload.fees
        : isRecord(details.fees) ? details.fees : {}
    const expanded = isRecord(fees.expandedPriceImpact)
        ? fees.expandedPriceImpact
        : isRecord(details.expandedPriceImpact)
          ? details.expandedPriceImpact
          : isRecord(payload.expandedPriceImpact) ? payload.expandedPriceImpact : {}

    // Relay documents `relayer` as relayerService + relayerGas, so it is never
    // added. Expanded execution overlaps relayerGas and is authoritative when
    // present; minimum output is already net of quote costs and is not a fee.
    const destinationGasUsd = impactUsd(expanded.execution) ?? feeUsd(fees.relayerGas)
    const providerFeeUsd = impactUsd(expanded.relay) ?? feeUsd(fees.relayerService)
    const appFeeUsd = impactUsd(expanded.app) ?? feeUsd(fees.app)
    const swapImpactUsd = impactUsd(expanded.swap)
    const sponsoredUsd = impactUsd(expanded.sponsored) ?? feeUsd(fees.subsidized)
    const routeCostUsd = subtractUsdDecimal(
        addUsdDecimals([
            destinationGasUsd,
            providerFeeUsd,
            appFeeUsd,
            swapImpactUsd,
        ]),
        sponsoredUsd,
    )
    return {
        ...emptyCrossChainCosts('quote'),
        destinationGasUsd,
        providerFeeUsd,
        appFeeUsd,
        swapImpactUsd,
        sponsoredUsd,
        routeCostUsd,
    }
}

function relayCostBreakdownAvailable(costs: ReturnType<typeof normalizeRelayCosts>) {
    return [
        costs.destinationGasUsd,
        costs.providerFeeUsd,
        costs.appFeeUsd,
        costs.swapImpactUsd,
        costs.sponsoredUsd,
    ].some((value) => value !== null)
}

function impactUsd(value: unknown) {
    if (!isRecord(value)) return null
    // Relay reports costs as negative price impacts. The normalized model stores
    // their non-negative magnitude so cost addition and sponsorship subtraction
    // remain explicit and decimal-safe.
    const usd = typeof value.usd === 'string'
        ? value.usd.trim().replace(/^-/, '')
        : value.usd
    return normalizeUsdDecimal(usd)
}

function feeUsd(value: unknown) {
    return isRecord(value) ? normalizeUsdDecimal(value.amountUsd) : null
}

function verifyRelayDestination(
    currencyOut: Record<string, unknown>,
    details: Record<string, unknown>,
    request: CrossChainRequest,
) {
    const currency = isRecord(currencyOut.currency) ? currencyOut.currency : currencyOut
    const token = normalizeAddress(currency.address ?? currency.contractAddress)
    if (token !== request.destinationAsset.address) {
        throw new CrossChainValidationError(
            'RELAY_ROUTE_MALFORMED',
            'Relay returned a different destination token.',
        )
    }
    const chainId = currency.chainId ?? details.destinationChainId
    if (Number(chainId) !== request.destinationAsset.chainId) {
        throw new CrossChainValidationError(
            'RELAY_ROUTE_MALFORMED',
            'Relay returned the wrong destination chain.',
        )
    }
    const recipient = normalizeAddress(details.recipient)
    if (recipient !== request.recipient) {
        throw new CrossChainValidationError(
            'RELAY_ROUTE_MALFORMED',
            'Relay returned a different destination recipient.',
        )
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
    const route = capabilities.routes.find((candidate) =>
        candidate.sourceChainId === request.sourceAsset.chainId &&
        candidate.destinationChainId === request.destinationAsset.chainId,
    )
    if (!route?.relayAuthority) {
        throw new CrossChainValidationError(
            'RELAY_AUTHORITY_UNAVAILABLE',
            'Relay authority metadata is unavailable for the source chain.',
        )
    }
    const precedingApprovalSpenders = new Set<string>()
    for (const [stepIndex, step] of array(value).entries()) {
        for (const [itemIndex, item] of array(step.items).entries()) {
            const data = isRecord(item.data) ? item.data : item
            if (typeof data.to !== 'string') continue
            const approval = /(?:approve|approval|authorize)/i.test(
                String(step.id ?? step.kind ?? ''),
            )
            if (
                approval &&
                request.sourceAsset.address === NATIVE_TOKEN_ADDRESS
            ) continue
            const chainId = Number(data.chainId)
            if (!Number.isInteger(chainId)) {
                throw new CrossChainValidationError(
                    'RELAY_ROUTE_MALFORMED',
                    'Relay transaction chain is invalid.',
                )
            }
            // Destination steps describe post-bridge execution. They are not source-wallet
            // transactions and must not be checked against source-chain authorities.
            if (chainId !== request.sourceAsset.chainId) continue
            const transaction = approval
                ? validateRelayApproval(data, request, route.relayAuthority)
                : validateRelayDeposit(
                    data,
                    request,
                    capabilities,
                    chainId,
                    precedingApprovalSpenders,
                )
            if (approval && transaction.allowanceTarget) {
                precedingApprovalSpenders.add(transaction.allowanceTarget)
            }
            const sender = normalizeAddress(data.from)
            if (sender && chainId === request.sourceAsset.chainId &&
                sender !== request.ownerAddress) {
                throw new CrossChainValidationError(
                    'RELAY_ROUTE_MALFORMED',
                    'Relay source transaction sender does not match the route owner.',
                )
            }
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

function validateRelayDeposit(
    value: unknown,
    request: Parameters<typeof validateProviderTransaction>[1],
    capabilities: ProviderCapabilities,
    chainId: number,
    precedingApprovalSpenders: ReadonlySet<string>,
) {
    try {
        const transaction = validateProviderTransaction(value, request, capabilities, chainId)
        const route = capabilities.routes.find((candidate) =>
            candidate.sourceChainId === request.sourceAsset.chainId &&
            candidate.destinationChainId === request.destinationAsset.chainId,
        )
        const authority = route?.relayAuthority
        if (
            transaction.to === authority?.legacy.approvalProxy ||
            transaction.to === authority?.v3.approvalProxy
        ) {
            // Relay omits an approval step when the wallet already has enough
            // allowance. When an approval step is present, it must still name
            // the exact proxy used by the source execution transaction.
            if (
                precedingApprovalSpenders.size > 0 &&
                !precedingApprovalSpenders.has(transaction.to)
            ) {
                throw new CrossChainValidationError(
                    'RELAY_APPROVAL_TARGET_INVALID',
                    'Relay approval spender does not match the source approval proxy.',
                )
            }
        } else {
            const requiredSpender = transaction.to === authority?.protocolV2.depository
                ? authority.protocolV2.depository
                : transaction.to === authority?.v3.router
                  ? authority.v3.approvalProxy
                  : authority?.legacy.approvalProxy
            if (
                precedingApprovalSpenders.size > 0 &&
                requiredSpender &&
                !precedingApprovalSpenders.has(requiredSpender)
            ) {
                throw new CrossChainValidationError(
                    'RELAY_APPROVAL_TARGET_INVALID',
                    'Relay approval spender does not match the source execution contract.',
                )
            }
        }
        return transaction
    } catch (error) {
        const target = isRecord(value) ? address(value.to) : null
        const route = capabilities.routes.find((candidate) =>
            candidate.sourceChainId === request.sourceAsset.chainId &&
            candidate.destinationChainId === request.destinationAsset.chainId,
        )
        relayTargetDiagnostic(target, relayExpectedCategory(target, route?.relayAuthority ?? null))
        if (error instanceof CrossChainValidationError) throw error
        throw new CrossChainValidationError(
            'RELAY_ROUTE_MALFORMED',
            error instanceof Error ? error.message : 'Relay returned a malformed deposit transaction.',
        )
    }
}

function validateRelayApproval(
    value: unknown,
    request: Parameters<typeof validateProviderTransaction>[1],
    authority: NonNullable<ProviderCapabilities['routes'][number]['relayAuthority']>,
) {
    const spenders = [
        authority.legacy.approvalProxy,
        authority.v3.approvalProxy,
        authority.protocolV2.depository,
    ].filter((value): value is string => value !== null)
    if (!spenders.length) {
        throw new CrossChainValidationError(
            'RELAY_AUTHORITY_UNAVAILABLE',
            'Relay approval authority metadata is unavailable for this route flow.',
        )
    }
    return validateExactApprovalTransaction(value, {
        chainId: request.sourceAsset.chainId,
        token: request.sourceAsset.address,
        spenders,
        amount: request.amount,
    })
}

type RelayAuthority = NonNullable<ProviderCapabilities['routes'][number]['relayAuthority']>
function relayAuthority(chain: Record<string, unknown>): RelayAuthority {
    const contracts = isRecord(chain.contracts) ? chain.contracts : {}
    const v3 = isRecord(contracts.v3) ? contracts.v3 : {}
    const protocol = isRecord(chain.protocol) ? chain.protocol : {}
    const protocolV2 = isRecord(protocol.v2) ? protocol.v2 : {}
    return {
        legacy: {
            router: address(contracts.erc20Router),
            approvalProxy: address(contracts.approvalProxy),
        },
        v3: {
            router: address(v3.erc20Router ?? contracts.v3Erc20Router),
            approvalProxy: address(v3.approvalProxy ?? contracts.v3ApprovalProxy),
        },
        protocolV2: {
            depository: address(protocolV2.depository),
        },
        solverAddresses: Array.isArray(chain.solverAddresses)
            ? chain.solverAddresses.map(address).filter((value): value is string => value !== null)
            : [],
    }
}

function relayExpectedCategory(target: string | null, authority: RelayAuthority | null) {
    if (!authority) return 'source-chain-authority'
    if (target === authority.protocolV2.depository) return 'protocol-v2-depository'
    if (target === authority.v3.router) return 'v3-erc20-router'
    if (target === authority.v3.approvalProxy) return 'v3-approval-proxy'
    if (target === authority.legacy.router) return 'erc20-router'
    if (target === authority.legacy.approvalProxy) return 'approval-proxy'
    return 'source-execution-contract'
}
function relayTargetDiagnostic(target: string | null, expectedCategory: string) {
    console.warn('[pistachio-api][relay-target-validation]', {
        targetSuffix: target ? target.slice(-6) : null,
        expectedContractCategory: expectedCategory,
    })
}

function relayTransactionTargets(authority: RelayAuthority) {
    return [...new Set([
        authority.legacy.router,
        authority.legacy.approvalProxy,
        authority.v3.router,
        authority.v3.approvalProxy,
        authority.protocolV2.depository,
    ].filter((value): value is string => value !== null))]
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
