import { getApiConfig } from '../../config.js'
import { isCuratedEvmChainId } from '../../chains.js'
import { normalizeAddress } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson, isRecord } from '../../lib/http.js'
import {
    decimalInteger,
    futureExpiry,
    normalizeTransaction,
    quoteId,
} from './quote-utils.js'
import type { QuoteProvider } from './types.js'
import { normalizeProviderToken } from './provider-token.js'

export function createZeroXProvider({
    applyPlatformFee = true,
}: {
    applyPlatformFee?: boolean
} = {}): QuoteProvider {
    const config = getApiConfig()

    return {
        name: '0x',
        supportsChain: isCuratedEvmChainId,

        async getQuote(request, signal) {
            const apiKey = config.quotes.zeroX.apiKey
            if (!apiKey) {
                throw new ProviderError({
                    code: 'ZEROX_NOT_CONFIGURED',
                    message: '0x Swap API is not configured.',
                    statusCode: 503,
                    outcome: 'configuration',
                })
            }

            const sellToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.sellToken,
                isNative: request.sellToken === '0x0000000000000000000000000000000000000000',
            })
            const buyToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.buyToken,
                isNative: request.buyToken === '0x0000000000000000000000000000000000000000',
            })

            const url = new URL(
                `${config.quotes.zeroX.baseUrl}/swap/allowance-holder/quote`,
            )
            url.searchParams.set('chainId', String(request.chainId))
            url.searchParams.set('sellToken', sellToken.zeroX)
            url.searchParams.set('buyToken', buyToken.zeroX)
            url.searchParams.set('sellAmount', request.sellAmount)
            url.searchParams.set('taker', request.takerAddress)
            url.searchParams.set(
                'slippageBps',
                String(request.slippageBps),
            )

            if (
                applyPlatformFee &&
                config.fees.platformFeeBps > 0 &&
                config.fees.collectionMode === 'provider-affiliate' &&
                config.fees.treasuryAddress
            ) {
                url.searchParams.set(
                    'swapFeeRecipient',
                    config.fees.treasuryAddress,
                )
                url.searchParams.set(
                    'swapFeeBps',
                    String(config.fees.platformFeeBps),
                )
                url.searchParams.set('swapFeeToken', buyToken.zeroX)
            }

            const payload = await fetchJson(url, {
                headers: {
                    '0x-api-key': apiKey,
                    '0x-version': 'v2',
                },
                signal,
                timeoutMs: config.quotes.timeoutMs,
            })

            if (!isRecord(payload)) {
                throw new ProviderError({
                    code: 'ZEROX_QUOTE_INVALID',
                    message: '0x returned an invalid quote.',
                })
            }

            if (payload.liquidityAvailable === false) {
                throw new ProviderError({
                    code: 'ZEROX_NO_ROUTE',
                    message: '0x reported no available liquidity for this pair.',
                    outcome: 'no-route',
                })
            }

            const buyAmount = decimalInteger(payload.buyAmount)
            const minimumBuyAmount = decimalInteger(payload.minBuyAmount)
            const transaction = normalizeTransaction(payload.transaction)
            const issues = isRecord(payload.issues) ? payload.issues : {}
            const allowanceIssue = isRecord(issues.allowance)
                ? issues.allowance
                : null
            const fees = isRecord(payload.fees) ? payload.fees : {}
            const integratorFee = isRecord(fees.integratorFee)
                ? fees.integratorFee
                : null
            const feeAmount =
                decimalInteger(integratorFee?.amount) ?? '0'
            const feeToken = normalizeAddress(integratorFee?.token)
            const allowanceTarget = normalizeAddress(
                allowanceIssue?.spender ?? payload.allowanceTarget,
            )

            if (!buyAmount || !minimumBuyAmount) {
                throw new ProviderError({
                    code: 'ZEROX_QUOTE_INVALID',
                    message: '0x quote amounts are invalid.',
                })
            }

            return {
                provider: '0x',
                billingMode:
                    applyPlatformFee && config.fees.platformFeeBps > 0
                        ? 'provider-integrator'
                        : 'normal-provider-fee',
                quoteId: quoteId(payload.zid ?? payload.blockNumber, '0x'),
                chainId: request.chainId,
                sellToken: request.sellToken,
                buyToken: request.buyToken,
                sellAmount: request.sellAmount,
                buyAmount,
                minimumBuyAmount,
                estimatedGas:
                    decimalInteger(payload.gas) ?? transaction.gas ?? null,
                estimatedGasUsd: null,
                allowanceTarget:
                    sellToken.isNative ? null : allowanceTarget,
                transaction,
                platformFee: {
                    amount: feeAmount,
                    token: feeToken,
                    bps:
                        feeAmount === '0'
                            ? 0
                            : applyPlatformFee
                                ? config.fees.platformFeeBps
                                : 0,
                },
                route:
                    isRecord(payload.route) && Array.isArray(payload.route.fills)
                        ? payload.route.fills
                        : [],
                permitData: null,
                executable: true,
                expiresAt: futureExpiry(30),
            }
        },

        async healthCheck(signal) {
            if (!config.quotes.zeroX.apiKey) return false
            try {
                const url = new URL(`${config.quotes.zeroX.baseUrl}/sources`)
                url.searchParams.set('chainId', '56')
                const response = await fetch(url, {
                    headers: {
                        '0x-api-key': config.quotes.zeroX.apiKey,
                        '0x-version': 'v2',
                    },
                    signal,
                })
                return response.ok
            } catch {
                return false
            }
        },
    }
}
