import { getApiConfig } from '../../../config.js'
import { isCuratedEvmChainId } from '../../../chains.js'
import { normalizeAddress } from '../../../lib/address.js'
import { ProviderError } from '../../../lib/errors.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    decimalInteger,
    futureExpiry,
    normalizeTransaction,
    quoteId,
} from '../schemas/quote-utils.js'
import type { QuoteProvider } from '../types/types.js'
import { normalizeProviderToken } from './provider-token.js'

export const ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN = new Map<number, string>([
    ...[
        1, 10, 56, 130, 137, 146, 480, 8453, 34443, 42161, 43114,
        534352, 59144, 80094, 81457,
    ].map((chainId) => [
        chainId,
        '0x0000000000001ff3684f28c67538d4d072c22734',
    ] as const),
    [5000, '0x0000000000005e88410ccdfade4a5efae4b49562'],
])

export function createZeroXProvider({
    applyPlatformFee = true,
}: {
    applyPlatformFee?: boolean
} = {}): QuoteProvider {
    const config = getApiConfig()

    return {
        name: '0x',
        supportsChain: (chainId) =>
            isCuratedEvmChainId(chainId) &&
            ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.has(chainId),
        supportsQuoteMode: (mode) => mode === 'EXACT_INPUT',

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
            const expectedAllowanceTarget = ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.get(
                request.chainId,
            ) ?? null

            if (!buyAmount || !minimumBuyAmount) {
                throw new ProviderError({
                    code: 'ZEROX_QUOTE_INVALID',
                    message: '0x quote amounts are invalid.',
                })
            }
            if (
                !sellToken.isNative &&
                (!expectedAllowanceTarget ||
                    (allowanceTarget !== null && allowanceTarget !== expectedAllowanceTarget))
            ) {
                throw new ProviderError({
                    code: 'ZEROX_ALLOWANCE_TARGET_INVALID',
                    message: '0x returned an unauthorized allowance target.',
                    outcome: 'validation',
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
                mode: request.mode,
                sellAmount: request.sellAmount,
                buyAmount,
                minimumBuyAmount,
                maximumSellAmount: request.sellAmount,
                estimatedGas:
                    decimalInteger(payload.gas) ?? transaction.gas ?? null,
                estimatedGasUsd: null,
                allowanceTarget:
                    sellToken.isNative ? null : expectedAllowanceTarget,
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
