import { getApiConfig } from '../../../config.js'
import { isCuratedEvmChainId } from '../../../chains.js'
import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../../../lib/address.js'
import { ProviderError } from '../../../lib/errors.js'
import { fetchJson, isRecord } from '../../../lib/http.js'
import {
    decimalInteger,
    futureExpiry,
    normalizeTransaction,
    quoteId,
} from '../schemas/quote-utils.js'
import type {
    NormalizedQuote,
    QuoteProvider,
} from '../types/types.js'
import { normalizeProviderToken } from './provider-token.js'
import { getAuthoritativeTokenUsdPrice } from '../../../providers/alchemy/token-prices.js'

const UNISWAP_CURRENT_PROXY_APPROVAL_ADDRESS = normalizeAddress(
    '0x0000000085E102724e78eCd2F45DC9cA239Affad',
)!

const UNISWAP_LEGACY_PROXY_APPROVAL_ADDRESS = normalizeAddress(
    '0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9',
)!

const UNISWAP_ALLOWED_PROXY_APPROVAL_ADDRESSES = new Set<string>([
    UNISWAP_CURRENT_PROXY_APPROVAL_ADDRESS,
    UNISWAP_LEGACY_PROXY_APPROVAL_ADDRESS,
])

const UNISWAP_UNIVERSAL_ROUTER_VERSION = '2.0'
const BPS_DENOMINATOR = 10_000n

type UniswapIntegratorFee = {
    bps: number
    recipient: string
}

function ceilDiv(numerator: bigint, denominator: bigint) {
    return (numerator + denominator - 1n) / denominator
}

function decimalFraction(value: string) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
    if (!match) return null
    return {
        numerator: BigInt(`${match[1]}${match[2] ?? ''}`),
        denominator: 10n ** BigInt((match[2] ?? '').length),
    }
}

export function calculateUniswapEffectiveFee({
    grossOutputRaw,
    configuredBps,
    maximumBps,
    maximumUsd,
    buyTokenPriceUsd,
    buyTokenDecimals,
}: {
    grossOutputRaw: string
    configuredBps: number
    maximumBps: number
    maximumUsd: string
    buyTokenPriceUsd: string
    buyTokenDecimals: number
}) {
    const gross = BigInt(grossOutputRaw)
    const price = decimalFraction(buyTokenPriceUsd)
    const capUsd = decimalFraction(maximumUsd)
    if (gross <= 0n || !price || !capUsd || price.numerator <= 0n || capUsd.numerator <= 0n) {
        throw new ProviderError({ code: 'UNISWAP_FEE_PRICE_INVALID', message: 'The authoritative buy-token price is invalid.', outcome: 'validation' })
    }
    // Floor the token cap so a collected raw amount can never exceed the USD cap.
    const capRaw = (capUsd.numerator * price.denominator * (10n ** BigInt(buyTokenDecimals))) /
        (capUsd.denominator * price.numerator)
    if (capRaw < 1n) {
        throw new ProviderError({ code: 'UNISWAP_FEE_CAP_UNCHARGEABLE', message: 'The route is too small for the verified platform-fee cap.', outcome: 'validation' })
    }
    const minimumChargeableBps = ceilDiv(BPS_DENOMINATOR, gross)
    if (minimumChargeableBps > BigInt(maximumBps)) {
        throw new ProviderError({ code: 'UNISWAP_FEE_ROUTE_TOO_SMALL', message: 'The route output is too small for the platform fee.', outcome: 'validation' })
    }
    const uncappedBps = Math.max(configuredBps, Number(minimumChargeableBps))
    const maximumCapBps = (capRaw * BPS_DENOMINATOR) / gross
    if (maximumCapBps < 1n) {
        throw new ProviderError({ code: 'UNISWAP_FEE_CAP_UNCHARGEABLE', message: 'The route is too large for a chargeable verified platform fee.', outcome: 'validation' })
    }
    const effectiveBps = Math.min(uncappedBps, maximumBps, Number(maximumCapBps))
    const feeAmountRaw = (gross * BigInt(effectiveBps)) / BPS_DENOMINATOR
    if (feeAmountRaw < 1n || feeAmountRaw > capRaw) {
        throw new ProviderError({ code: 'UNISWAP_FEE_CAP_MISMATCH', message: 'The platform fee cannot be represented safely for this route.', outcome: 'validation' })
    }
    return {
        effectiveBps,
        feeAmountRaw: feeAmountRaw.toString(),
        adjustment: effectiveBps < configuredBps ? 'usd-cap' as const : effectiveBps > configuredBps ? 'minimum-chargeable' as const : 'base' as const,
        capped: effectiveBps < configuredBps,
    }
}

export function resolveUniswapIntegratorFee(): UniswapIntegratorFee | null {
    const config = getApiConfig()

    if (config.fees.platformFeeBps === 0) {
        return null
    }

    if (
        config.fees.collectionMode !== 'provider-affiliate' ||
        !config.fees.treasuryAddress
    ) {
        throw new ProviderError({
            code: 'UNISWAP_FEE_MODE_UNSUPPORTED',
            message:
                'Uniswap is incompatible with the configured platform fee mode.',
            outcome: 'configuration',
        })
    }

    if (config.fees.platformFeeBps > config.fees.platformFeeMaxBps) {
        throw new ProviderError({
            code: 'UNISWAP_FEE_TOO_HIGH',
            message: 'Uniswap integrator fees cannot exceed 500 BPS.',
            outcome: 'configuration',
        })
    }

    return {
        bps: config.fees.platformFeeBps,
        recipient: config.fees.treasuryAddress,
    }
}

export function validateUniswapIntegratorFee({
                                                 rawQuote,
                                                 buyToken,
                                                 sellAmount,
                                                 expected,
                                             }: {
    rawQuote: Record<string, unknown>
    buyToken: string
    sellAmount: string
    expected: UniswapIntegratorFee | null
}) {
    const aggregated = Array.isArray(rawQuote.aggregatedOutputs)
        ? rawQuote.aggregatedOutputs.filter(isRecord)
        : []

    const userOutput = aggregated.find(
        (item) => String(item.fee ?? '') !== 'INTEGRATOR',
    )

    if (!expected) {
        return {
            userOutput,
            platformFee: {
                amount: '0',
                token: null,
                bps: 0,
            } as const,
        }
    }

    const feeOutputs = aggregated.filter(
        (item) => String(item.fee ?? '') === 'INTEGRATOR',
    )

    const feeOutput = feeOutputs[0]
    const feeAmount = decimalInteger(feeOutput?.amount)
    const feeToken = normalizeAddress(feeOutput?.token)
    const feeRecipient = normalizeAddress(feeOutput?.recipient)

    const returnedFeeBps =
        feeOutput?.bps === undefined
            ? null
            : Number(feeOutput.bps)

    const portionAmount = decimalInteger(rawQuote.portionAmount)
    const portionRecipient = normalizeAddress(rawQuote.portionRecipient)

    const portionBps =
        rawQuote.portionBips === undefined
            ? null
            : Number(rawQuote.portionBips)

    const userAmount = decimalInteger(userOutput?.amount)

    const output = isRecord(rawQuote.output)
        ? rawQuote.output
        : {}

    const grossOutputAmount = decimalInteger(output.amount)

    const expectedFeeAmount =
        grossOutputAmount !== null
            ? (
            BigInt(grossOutputAmount) *
            BigInt(expected.bps)
        ) / BPS_DENOMINATOR
            : null

    const actualFeeAmount =
        feeAmount === null
            ? null
            : BigInt(feeAmount)

    const amountMatches =
        expectedFeeAmount !== null &&
        actualFeeAmount !== null &&
        expectedFeeAmount === actualFeeAmount && actualFeeAmount > 0n

    const outputAmountsMatch =
        grossOutputAmount !== null &&
        actualFeeAmount !== null &&
        userAmount !== null &&
        BigInt(grossOutputAmount) === BigInt(userAmount) + actualFeeAmount

    const legacyPortionMatches =
        portionAmount === null &&
        portionRecipient === null &&
        portionBps === null
            ? true
            : (
                portionAmount === feeAmount &&
                portionRecipient === expected.recipient &&
                portionBps === expected.bps
            )

    const returnedBpsMatches =
        returnedFeeBps === null ||
        returnedFeeBps === expected.bps

    if (
        feeOutputs.length !== 1 ||
        feeAmount === null ||
        feeToken !== buyToken ||
        feeRecipient !== expected.recipient ||
        !returnedBpsMatches ||
        !amountMatches ||
        !outputAmountsMatch ||
        !legacyPortionMatches ||
        userAmount === null ||
        BigInt(userAmount) <= 0n
    ) {
        console.warn(
            '[pistachio-api][uniswap-integrator-fee-validation]',
            {
                configuredFeeBps: expected.bps,
                returnedFeeBps,
                feeToken,
                sellAmount,
                grossOutputAmount,
                userOutputAmount: userAmount,
                expectedFeeAmount:
                    expectedFeeAmount?.toString() ?? null,
                actualFeeAmount: feeAmount,
                feeRecipientMatches:
                    feeRecipient === expected.recipient,
                feeTokenMatches:
                    feeToken === buyToken,
                feeOutputCount:
                feeOutputs.length,
                legacyPortionFieldsPresent:
                    portionAmount !== null ||
                    portionRecipient !== null ||
                    portionBps !== null,
            },
        )

        throw new ProviderError({
            code: 'UNISWAP_INTEGRATOR_FEE_MISMATCH',
            message:
                'Uniswap returned an inconsistent PistachioSwap fee.',
            outcome: 'validation',
        })
    }

    return {
        userOutput,
        platformFee: {
            amount: feeAmount,
            token: buyToken,
            bps: expected.bps,
        },
    }
}

export function createUniswapProvider(): QuoteProvider {
    const config = getApiConfig()

    return {
        name: 'uniswap',

        supportsChain: isCuratedEvmChainId,

        supportsQuoteMode: (mode) =>
            mode === 'EXACT_INPUT' ||
            mode === 'EXACT_OUTPUT',

        async getQuote(request, signal) {
            const mode = request.mode ?? 'EXACT_INPUT'
            const integratorFee = resolveUniswapIntegratorFee()

            if (!config.quotes.uniswap.apiKey) {
                throw new ProviderError({
                    code: 'UNISWAP_NOT_CONFIGURED',
                    message:
                        'Uniswap Trading API is not configured.',
                    statusCode: 503,
                    outcome: 'configuration',
                })
            }

            const sellToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.sellToken,
                isNative:
                    request.sellToken ===
                    NATIVE_TOKEN_ADDRESS,
            })

            const buyToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.buyToken,
                isNative:
                    request.buyToken ===
                    NATIVE_TOKEN_ADDRESS,
            })

            const headers = {
                'x-api-key':
                config.quotes.uniswap.apiKey,

                'x-permit2-disabled':
                    'true',

                'x-universal-router-version':
                UNISWAP_UNIVERSAL_ROUTER_VERSION,
            }

            const requestQuote = async (fee: UniswapIntegratorFee | null) => {
                try {
                    return await fetchJson(
                    new URL(
                        `${config.quotes.uniswap.baseUrl}/quote`,
                    ),
                    {
                        method: 'POST',
                        headers,
                        body: {
                            tokenIn:
                            sellToken.uniswap,

                            tokenOut:
                            buyToken.uniswap,

                            tokenInChainId:
                            request.chainId,

                            tokenOutChainId:
                            request.chainId,

                            type:
                            mode,

                            amount:
                                mode === 'EXACT_OUTPUT'
                                    ? request.buyAmount
                                    : request.sellAmount,

                            swapper:
                            request.takerAddress,

                            slippageTolerance:
                                request.slippageBps / 100,

                            ...(fee
                                ? {
                                    integratorFees: [
                                        {
                                            bips:
                                            fee.bps,

                                            recipient:
                                            fee.recipient,
                                        },
                                    ],
                                }
                                : {}),
                        },
                        signal,
                        timeoutMs:
                        config.quotes.timeoutMs,
                    },
                    )
                } catch (error) {
                if (
                    error instanceof ProviderError &&
                    error.upstreamStatus === 404
                ) {
                    throw new ProviderError({
                        code: 'UNISWAP_NO_ROUTE',
                        message:
                            'Uniswap reported no route for this pair.',
                        outcome: 'no-route',
                        upstreamStatus: 404,
                        cause: error,
                    })
                }

                    throw error
                }
            }

            let effectiveIntegratorFee = integratorFee
            let feeAdjustment: 'base' | 'minimum-chargeable' | 'usd-cap' | null = null
            let feeCapped = false
            let priceEvidence: Awaited<ReturnType<typeof getAuthoritativeTokenUsdPrice>> = null
            let quotePayload = await requestQuote(integratorFee)

            if (
                !isRecord(quotePayload) ||
                !isRecord(quotePayload.quote)
            ) {
                throw new ProviderError({
                    code: 'UNISWAP_QUOTE_INVALID',
                    message:
                        'Uniswap returned an invalid quote.',
                    outcome: 'validation',
                })
            }

            if (integratorFee) {
                const firstQuote = quotePayload.quote
                const firstOutput = isRecord(firstQuote.output) ? firstQuote.output : {}
                const grossOutputRaw = decimalInteger(firstOutput.amount)
                if (!grossOutputRaw) {
                    throw new ProviderError({ code: 'UNISWAP_QUOTE_INVALID', message: 'Uniswap returned an invalid quote.', outcome: 'validation' })
                }
                const price = await getAuthoritativeTokenUsdPrice({
                    chainId: request.chainId,
                    address: request.buyToken === NATIVE_TOKEN_ADDRESS
                        ? config.market.wrappedNativeAddress
                        : request.buyToken,
                    signal,
                })
                if (!price || Date.now() - price.observedAt > 45_000) {
                    throw new ProviderError({ code: 'UNISWAP_FEE_PRICE_UNAVAILABLE', message: 'A fresh authoritative buy-token price is required to validate the platform fee.', outcome: 'validation' })
                }
                priceEvidence = price
                const calculation = calculateUniswapEffectiveFee({
                    grossOutputRaw,
                    configuredBps: integratorFee.bps,
                    maximumBps: config.fees.platformFeeMaxBps,
                    maximumUsd: config.fees.platformFeeMaxUsd,
                    buyTokenPriceUsd: price.priceUsd,
                    buyTokenDecimals: request.buyTokenDecimals,
                })
                feeAdjustment = calculation.adjustment
                feeCapped = calculation.capped
                if (calculation.effectiveBps !== integratorFee.bps) {
                    effectiveIntegratorFee = { ...integratorFee, bps: calculation.effectiveBps }
                    quotePayload = await requestQuote(effectiveIntegratorFee)
                    if (!isRecord(quotePayload) || !isRecord(quotePayload.quote)) {
                        throw new ProviderError({ code: 'UNISWAP_QUOTE_INVALID', message: 'Uniswap returned an invalid quote.', outcome: 'validation' })
                    }
                }
            }

            if (quotePayload.permitData != null) {
                throw new ProviderError({
                    code:
                        'UNISWAP_PROXY_APPROVAL_MISMATCH',
                    message:
                        'Uniswap returned Permit2 data while proxy approval mode was requested.',
                    outcome: 'validation',
                })
            }

            const routing =
                String(quotePayload.routing ?? '')

            if (
                ![
                    'CLASSIC',
                    'WRAP',
                    'UNWRAP',
                ].includes(routing)
            ) {
                throw new ProviderError({
                    code:
                        routing === 'CHAINED'
                            ? 'UNISWAP_CHAINED_ROUTE_UNSUPPORTED'
                            : 'UNISWAP_ORDER_ROUTE_UNSUPPORTED',

                    message:
                        routing === 'CHAINED'
                            ? 'The Uniswap CHAINED route requires the plan workflow, which is not implemented.'
                            : `The Uniswap ${
                                routing || 'unknown'
                            } route requires an order-signature workflow, which is not implemented.`,

                    outcome: 'configuration',
                })
            }

            const swapPayload = await fetchJson(
                new URL(
                    `${config.quotes.uniswap.baseUrl}/swap`,
                ),
                {
                    method: 'POST',
                    headers,
                    body: {
                        quote: quotePayload.quote,
                    },
                    signal,
                    timeoutMs:
                    config.quotes.timeoutMs,
                },
            )

            if (!isRecord(swapPayload)) {
                throw new ProviderError({
                    code: 'UNISWAP_SWAP_INVALID',
                    message:
                        'Uniswap returned an invalid swap transaction.',
                    outcome: 'validation',
                })
            }

            const rawQuote =
                quotePayload.quote

            const input =
                isRecord(rawQuote.input)
                    ? rawQuote.input
                    : {}

            const output =
                isRecord(rawQuote.output)
                    ? rawQuote.output
                    : {}

            const grossBuyAmount =
                decimalInteger(output.amount)

            if (integratorFee && effectiveIntegratorFee && grossBuyAmount && priceEvidence) {
                const finalCalculation = calculateUniswapEffectiveFee({
                    grossOutputRaw: grossBuyAmount,
                    configuredBps: integratorFee.bps,
                    maximumBps: config.fees.platformFeeMaxBps,
                    maximumUsd: config.fees.platformFeeMaxUsd,
                    buyTokenPriceUsd: priceEvidence.priceUsd,
                    buyTokenDecimals: request.buyTokenDecimals,
                })
                if (finalCalculation.effectiveBps !== effectiveIntegratorFee.bps) {
                    throw new ProviderError({ code: 'UNISWAP_INTEGRATOR_FEE_MISMATCH', message: 'Uniswap returned a route with an inconsistent platform fee.', outcome: 'validation' })
                }
                feeAdjustment = finalCalculation.adjustment
                feeCapped = finalCalculation.capped
            }

            const sellAmount =
                decimalInteger(input.amount) ??
                request.sellAmount

            const maximumSellAmount =
                mode === 'EXACT_OUTPUT'
                    ? (
                        decimalInteger(
                            input.maxAmount ??
                            input.amount,
                        ) ??
                        sellAmount
                    )
                    : sellAmount

            const feeResult =
                validateUniswapIntegratorFee({
                    rawQuote,
                    buyToken:
                    request.buyToken,
                    sellAmount,
                    expected:
                    effectiveIntegratorFee,
                })

            const userOutput = feeResult.userOutput

            const buyAmount: string | null = effectiveIntegratorFee
                ? decimalInteger(userOutput?.amount)
                : grossBuyAmount

            const minimum: string | null =
                mode === 'EXACT_OUTPUT'
                    ? buyAmount
                    : (
                        isRecord(userOutput)
                            ? decimalInteger(
                                userOutput.minAmount ??
                                userOutput.amount,
                            )
                            : null
                    ) ??
                    (
                        buyAmount
                            ? (
                                BigInt(buyAmount) *
                                BigInt(
                                    10_000 -
                                    request.slippageBps,
                                )
                            ) /
                            10_000n
                            : null
                    )?.toString() ??
                    null

            if (
                buyAmount === null ||
                minimum === null ||
                BigInt(buyAmount) <= 0n ||
                BigInt(minimum) <= 0n
            ) {
                throw new ProviderError({
                    code: 'UNISWAP_QUOTE_INVALID',
                    message:
                        'Uniswap quote amounts are invalid.',
                    outcome: 'validation',
                })
            }

            const transaction =
                normalizeTransaction(
                    swapPayload.swap,
                )
            console.warn('[pistachio-api][uniswap-swap-calldata]', {
                to: transaction.to,
                value: transaction.value,
                data: transaction.data,
            })

            const sellTokenIsNative =
                request.sellToken ===
                NATIVE_TOKEN_ADDRESS

            const tokenApprovalApplicable =
                !sellTokenIsNative &&
                quotePayload
                    .isTokenApprovalApplicable !==
                false

            let proxyApprovalAddress: string | null =
                null

            if (tokenApprovalApplicable) {
                const candidateProxyAddress =
                    transaction.to

                const isAllowedProxy =
                    UNISWAP_ALLOWED_PROXY_APPROVAL_ADDRESSES.has(
                        candidateProxyAddress,
                    )

                if (!isAllowedProxy) {
                    console.warn(
                        '[pistachio-api][uniswap-proxy-validation-failed]',
                        {
                            baseUrl:
                            config.quotes.uniswap.baseUrl,

                            routing,

                            permitDataPresent:
                                quotePayload.permitData !=
                                null,

                            isTokenApprovalApplicable:
                                quotePayload
                                    .isTokenApprovalApplicable ??
                                null,

                            transactionTo:
                            candidateProxyAddress,

                            allowedProxyAddresses: [
                                UNISWAP_CURRENT_PROXY_APPROVAL_ADDRESS,
                                UNISWAP_LEGACY_PROXY_APPROVAL_ADDRESS,
                            ],

                            requestHeaders: {
                                permit2Disabled:
                                    headers[
                                        'x-permit2-disabled'
                                        ],

                                universalRouterVersion:
                                    headers[
                                        'x-universal-router-version'
                                        ],
                            },
                        },
                    )

                    throw new ProviderError({
                        code:
                            'UNISWAP_PROXY_TRANSACTION_INVALID',
                        message:
                            'Uniswap returned an unrecognized proxy approval transaction.',
                        outcome: 'validation',
                    })
                }

                proxyApprovalAddress =
                    candidateProxyAddress
            }

            const normalized: NormalizedQuote = {
                provider:
                    'uniswap',

                billingMode:
                    effectiveIntegratorFee
                        ? 'provider-integrator'
                        : 'normal-provider-fee',

                quoteId:
                    quoteId(
                        rawQuote.quoteId,
                        'uniswap',
                    ),

                chainId:
                request.chainId,

                sellToken:
                request.sellToken,

                buyToken:
                request.buyToken,

                mode,

                sellAmount,

                buyAmount,

                minimumBuyAmount:
                minimum,

                maximumSellAmount,

                estimatedGas:
                    decimalInteger(
                        rawQuote.gasUseEstimate,
                    ) ??
                    transaction.gas ??
                    null,

                estimatedGasUsd:
                    typeof rawQuote.gasFeeUSD ===
                    'string'
                        ? rawQuote.gasFeeUSD
                        : null,

                allowanceTarget:
                proxyApprovalAddress,

                approval:
                    proxyApprovalAddress
                        ? {
                            mode: 'erc20',

                            contract:
                            proxyApprovalAddress,

                            spender:
                            proxyApprovalAddress,

                            token:
                            request.sellToken,

                            requiredAmount:
                            maximumSellAmount,
                        }
                        : null,

                transaction,

                platformFee:
                effectiveIntegratorFee
                    ? {
                        ...feeResult.platformFee,
                        configuredBps: integratorFee!.bps,
                        effectiveBps: effectiveIntegratorFee.bps,
                        adjustment: feeAdjustment ?? 'base',
                        capped: feeCapped,
                    }
                    : feeResult.platformFee,

                route:
                    Array.isArray(rawQuote.route)
                        ? rawQuote.route
                        : [],

                permitData:
                    null,

                executable:
                    true,

                expiresAt:
                    futureExpiry(30),
            }

            return normalized
        },

        async healthCheck(signal) {
            if (!config.quotes.uniswap.apiKey) {
                return false
            }

            try {
                const response = await fetch(
                    `${config.quotes.uniswap.baseUrl}/api.json`,
                    { signal },
                )

                return response.ok
            } catch {
                return false
            }
        },
    }
}
