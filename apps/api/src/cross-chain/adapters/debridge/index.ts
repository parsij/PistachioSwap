import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    bpsAsPercent,
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
    createExactApprovalTransaction,
    normalizeUint,
    validateProviderTransaction,
} from '../../validation.js'

// Explicitly verified deployments. New chains must be added deliberately.
const DLN_SOURCE_BY_EVM_CHAIN: Readonly<Record<number, string>> = {
    1: '0xef4fb24ad0916217251f553c0596f8edc630eb66',
    8453: '0xef4fb24ad0916217251f553c0596f8edc630eb66',
}

export function createDebridgeAdapter(http: HttpJson = fetchJson): CrossChainAdapter {
    const config = getApiConfig().crossChain
    const provider = config.debridge
    const headers: Record<string, string> = provider.accessToken
        ? { authorization: `Bearer ${provider.accessToken}` }
        : {}

    return {
        name: 'debridge-dln',
        async getCapabilities(signal) {
            if (!provider.enabled) return unavailable('disabled')
            const incompatible = platformFeeIncompatibility('debridge-dln')
            if (incompatible) return unavailable(incompatible)
            const payload = await http(new URL(`${provider.baseUrl}/v1.0/supported-chains-info`), {
                headers,
                signal,
                timeoutMs: config.quoteTimeoutMs,
            })
            const chains = list(payload, 'chains')
            const chainMetadata = chains.flatMap((chain) => {
                const internalChainId = Number(chain.chainId)
                const chainId = Number(chain.originalChainId ?? chain.chainId)
                const targets = [
                    DLN_SOURCE_BY_EVM_CHAIN[chainId],
                    chain.dlnSourceAddress,
                    chain.sourceContractAddress,
                    isRecord(chain.contracts) ? chain.contracts.dlnSource : null,
                ].map(address).filter((item): item is string => Boolean(item))
                return Number.isInteger(chainId) &&
                    Number.isInteger(internalChainId) &&
                    targets.length
                    ? [{ chainId, internalChainId, targets }]
                    : []
            })
            const routes = chainMetadata.flatMap((source) =>
                chainMetadata
                    .filter((destination) => destination.chainId !== source.chainId)
                    .map((destination) => ({
                        sourceChainId: source.chainId,
                        destinationChainId: destination.chainId,
                        providerSourceChainId: source.internalChainId,
                        providerDestinationChainId: destination.internalChainId,
                        transactionTargets: source.targets,
                    })),
            )
            return {
                provider: 'debridge-dln',
                available: routes.length > 0,
                fetchedAt: new Date().toISOString(),
                routes,
                ...(routes.length ? {} : { reason: 'Provider supplied no verifiable contract metadata.' }),
            }
        },
        async getQuote(request, capabilities, signal) {
            const route = capabilities.routes.find((candidate) =>
                candidate.sourceChainId === request.sourceAsset.chainId &&
                candidate.destinationChainId === request.destinationAsset.chainId,
            )
            if (
                !route?.providerSourceChainId ||
                !route.providerDestinationChainId
            ) throw new Error('deBridge internal chain metadata is unavailable.')
            const platformFee = getPlatformFeeConfiguration('debridge-dln')
            const url = new URL(`${provider.baseUrl}/v1.0/dln/order/create-tx`)
            const query = {
                srcChainId: route.providerSourceChainId,
                srcChainTokenIn: request.sourceAsset.address,
                srcChainTokenInAmount: request.amount,
                dstChainId: route.providerDestinationChainId,
                dstChainTokenOut: request.destinationAsset.address,
                dstChainTokenOutRecipient: request.recipient,
                senderAddress: request.ownerAddress,
                srcChainOrderAuthorityAddress: request.ownerAddress,
                dstChainOrderAuthorityAddress: request.recipient,
                prependOperatingExpenses: true,
                ...(provider.referralCode ? { referralCode: provider.referralCode } : {}),
                ...(platformFee.bps > 0
                    ? {
                          affiliateFeePercent: bpsAsPercent(platformFee.bps),
                          affiliateFeeRecipient: platformFee.recipient!,
                      }
                    : {}),
            }
            for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
            const payload = await http(url, { headers, signal, timeoutMs: config.quoteTimeoutMs })
            if (!isRecord(payload)) throw new Error('deBridge returned an invalid quote.')
            const estimation = isRecord(payload.estimation) ? payload.estimation : {}
            const destinationOutput = isRecord(estimation.dstChainTokenOut)
                ? estimation.dstChainTokenOut
                : {}
            verifyDebridgeDestination(destinationOutput, payload, request)
            const tx = isRecord(payload.tx) ? payload.tx : payload.transaction
            const buyAmount = normalizeUint(
                destinationOutput.amount ?? payload.dstChainTokenOutAmount,
                'buy amount',
            )
            const recommended = estimation.recommendedSlippage
            if (typeof recommended === 'number' && recommended * 10_000 > request.slippageBps) {
                throw new Error('Requested slippage is below the provider minimum.')
            }
            const approval = normalizeDebridgeApproval(payload, tx, request)
            const transaction = {
                ...validateProviderTransaction(tx, request, capabilities),
                allowanceTarget: approval?.allowanceTarget ?? null,
            }
            const approvalSteps = approval?.transaction
                ? [{
                      id: 'approval',
                      index: 0,
                      type: 'approval' as const,
                      label: 'Approve source token',
                      chainId: request.sourceAsset.chainId,
                      status: 'ready' as const,
                      transaction: approval.transaction,
                  }]
                : []
            const appFee = platformFeeEntry({
                bps: platformFee.bps,
                token: request.sourceAsset.address,
                baseAmount: request.amount,
            })
            return assertExactQuote({
                provider: 'debridge-dln',
                request,
                buyAmount,
                minimumBuyAmount: normalizeUint(
                    destinationOutput.recommendedAmount ?? destinationOutput.amount ?? buyAmount,
                    'minimum buy amount',
                ),
                fees: [
                    ...parseFees(estimation, request.sourceAsset.address),
                    ...(appFee ? [appFee] : []),
                ],
                estimatedDurationSeconds: finite(estimation.estimatedDeliveryTime),
                executionModel: 'evm-transaction',
                steps: [
                    ...approvalSteps,
                    {
                        id: 'source-transaction',
                        index: approvalSteps.length,
                        type: 'source-transaction',
                        label: 'Create DLN order',
                        chainId: request.sourceAsset.chainId,
                        status: 'ready',
                        transaction,
                    } as const,
                ],
                transaction,
                deposit: null,
                statusId: text(payload.orderId),
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }, request)
        },
        async getStatus(statusId, signal) {
            const payload = await http(
                new URL(`${provider.baseUrl}/v1.0/dln/order/${encodeURIComponent(statusId)}/status`),
                { headers, signal, timeoutMs: config.quoteTimeoutMs, notFoundAsNull: true },
            )
            const value = isRecord(payload) ? payload : {}
            return {
                provider: 'debridge-dln',
                statusId,
                status: mapStatus(value.status),
                sourceTransactionHash: text(value.srcChainTxHash),
                destinationTransactionHash: text(value.dstChainTxHash),
            }
        },
    }
}

function verifyDebridgeDestination(
    destinationOutput: Record<string, unknown>,
    payload: Record<string, unknown>,
    request: CrossChainRequest,
) {
    const token = normalizeAddress(
        destinationOutput.address ?? destinationOutput.tokenAddress,
    )
    if (token && token !== request.destinationAsset.address) {
        throw new Error('deBridge returned a different destination token.')
    }
    const chainId = destinationOutput.originalChainId ?? payload.dstChainOriginalChainId
    if (chainId !== undefined && Number(chainId) !== request.destinationAsset.chainId) {
        throw new Error('deBridge returned the wrong destination chain.')
    }
    const recipient = normalizeAddress(
        payload.dstChainTokenOutRecipient ?? payload.recipient,
    )
    if (recipient && recipient !== request.recipient) {
        throw new Error('deBridge returned a different destination recipient.')
    }
}

function normalizeDebridgeApproval(
    payload: Record<string, unknown>,
    transactionValue: unknown,
    request: CrossChainRequest,
) {
    if (request.sourceAsset.address === NATIVE_TOKEN_ADDRESS) return null
    const transaction = isRecord(transactionValue) ? transactionValue : {}
    const rawTarget = transaction.allowanceTarget ?? payload.allowanceTarget
    const rawAmount = transaction.allowanceValue ?? payload.allowanceValue
    const allowanceTarget = normalizeAddress(rawTarget)
    if (!allowanceTarget || allowanceTarget === NATIVE_TOKEN_ADDRESS) {
        throw new Error('deBridge returned no authoritative allowance target.')
    }
    const allowanceValue = normalizeUint(rawAmount, 'allowance value')
    if (allowanceValue === '0') {
        return { allowanceTarget, transaction: null }
    }
    return {
        allowanceTarget,
        transaction: createExactApprovalTransaction({
            chainId: request.sourceAsset.chainId,
            token: request.sourceAsset.address,
            spender: allowanceTarget,
            amount: allowanceValue,
        }),
    }
}

function list(value: unknown, key: string) {
    const selected = isRecord(value) ? value[key] : value
    if (Array.isArray(selected)) return selected.filter(isRecord)
    return isRecord(selected) ? Object.values(selected).filter(isRecord) : []
}
function unavailable(reason: string): ProviderCapabilities {
    return { provider: 'debridge-dln', available: false, fetchedAt: new Date().toISOString(), routes: [], reason }
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
function parseFees(value: Record<string, unknown>, token: string) {
    return Object.entries(value).flatMap(([key, amount]) =>
        /fee/i.test(key) && !/affiliate/i.test(key) &&
        typeof amount === 'string' && /^\d+$/.test(amount)
            ? [{ type: 'provider' as const, token, amount }]
            : [],
    )
}
function mapStatus(value: unknown) {
    const status = String(value ?? '').toLowerCase()
    if (/fulfilled|complete|claimed/.test(status)) return 'completed' as const
    if (/cancel|refund/.test(status)) return 'refunded' as const
    if (/fail|expired/.test(status)) return 'failed' as const
    if (/sent|fulfilled/.test(status)) return 'destination-confirming' as const
    if (/created|claimed|order/.test(status)) return 'in-flight' as const
    return 'unknown' as const
}
