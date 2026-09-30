import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { isNormalQuotePlatformFeeExemptWallet } from '../../../lib/platform-fee-exemptions.js'
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

export const KYBERSWAP_NATIVE_TOKEN_ADDRESS =
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const KYBERSWAP_ROUTER_ADDRESS =
    '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'

const KYBERSWAP_BASE_URL = 'https://aggregator-api.kyberswap.com'
const KYBERSWAP_CHAIN_NAMES = new Map<number, string>([
    [1, 'ethereum'],
    [10, 'optimism'],
    [56, 'bsc'],
    [130, 'unichain'],
    [137, 'polygon'],
    [146, 'sonic'],
    [8453, 'base'],
    [42161, 'arbitrum'],
    [43114, 'avalanche'],
    [59144, 'linea'],
    [80094, 'berachain'],
])

const BPS_DENOMINATOR = 10_000n

function enabled() {
    return process.env.KYBERSWAP_ENABLED?.trim().toLowerCase() !== 'false'
}

function clientId() {
    return process.env.KYBERSWAP_CLIENT_ID?.trim() || 'PistachioSwap'
}

function minimumAmount(amount: string, slippageBps: number) {
    const raw = BigInt(amount)
    const retainedBps = BPS_DENOMINATOR - BigInt(slippageBps)
    return (raw * retainedBps / BPS_DENOMINATOR).toString()
}

function validateExtraFee(
    routeSummary: Record<string, unknown>,
    expectedBps: number,
    expectedRecipient: string | null,
) {
    const extraFee = isRecord(routeSummary.extraFee)
        ? routeSummary.extraFee
        : null

    if (expectedBps === 0) {
        if (extraFee && Number(extraFee.feeAmount ?? 0) > 0) {
            throw new ProviderError({
                code: 'KYBERSWAP_UNEXPECTED_INTEGRATOR_FEE',
                message: 'KyberSwap returned an unexpected integrator fee.',
                outcome: 'validation',
            })
        }
        return
    }

    const feeRecipient = normalizeAddress(extraFee?.feeReceiver)
    const feeAmount = Number(extraFee?.feeAmount)
    const valid =
        extraFee?.chargeFeeBy === 'currency_in' &&
        extraFee?.isInBps === true &&
        Number.isInteger(feeAmount) &&
        feeAmount === expectedBps &&
        feeRecipient === expectedRecipient

    if (!valid) {
        throw new ProviderError({
            code: 'KYBERSWAP_INTEGRATOR_FEE_MISMATCH',
            message: 'KyberSwap returned an inconsistent PistachioSwap fee.',
            outcome: 'validation',
        })
    }
}

export function createKyberSwapProvider({
    applyPlatformFee = true,
}: {
    applyPlatformFee?: boolean
} = {}): QuoteProvider {
    const config = getApiConfig()

    return {
        name: 'kyberswap',

        supportsChain: (chainId) =>
            enabled() && KYBERSWAP_CHAIN_NAMES.has(chainId),

        supportsQuoteMode: (mode) => mode === 'EXACT_INPUT',

        async getQuote(request, signal) {
            if (!enabled()) {
                throw new ProviderError({
                    code: 'KYBERSWAP_DISABLED',
                    message: 'KyberSwap Aggregator is disabled.',
                    statusCode: 503,
                    outcome: 'configuration',
                })
            }

            const chain = KYBERSWAP_CHAIN_NAMES.get(request.chainId)
            if (!chain) {
                throw new ProviderError({
                    code: 'KYBERSWAP_CHAIN_UNSUPPORTED',
                    message: 'KyberSwap does not support this chain.',
                    outcome: 'configuration',
                })
            }

            const sellToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.sellToken,
                isNative: request.sellToken === NATIVE_TOKEN_ADDRESS,
            })
            const buyToken = normalizeProviderToken({
                chainId: request.chainId,
                address: request.buyToken,
                isNative: request.buyToken === NATIVE_TOKEN_ADDRESS,
            })

            const feeBps =
                applyPlatformFee &&
                !isNormalQuotePlatformFeeExemptWallet(request.takerAddress) &&
                config.fees.platformFeeBps > 0 &&
                config.fees.collectionMode === 'provider-affiliate' &&
                config.fees.treasuryAddress
                    ? config.fees.platformFeeBps
                    : 0
            const feeRecipient = feeBps > 0
                ? config.fees.treasuryAddress
                : null

            const routeUrl = new URL(
                `${KYBERSWAP_BASE_URL}/${chain}/api/v1/routes`,
            )
            routeUrl.searchParams.set('tokenIn', sellToken.kyberSwap)
            routeUrl.searchParams.set('tokenOut', buyToken.kyberSwap)
            routeUrl.searchParams.set('amountIn', request.sellAmount)
            routeUrl.searchParams.set('gasInclude', 'true')
            routeUrl.searchParams.set('origin', request.takerAddress)

            if (feeBps > 0 && feeRecipient) {
                routeUrl.searchParams.set('chargeFeeBy', 'currency_in')
                routeUrl.searchParams.set('feeReceiver', feeRecipient)
                routeUrl.searchParams.set('isInBps', 'true')
                routeUrl.searchParams.set('feeAmount', String(feeBps))
            }

            const headers = {
                'x-client-id': clientId(),
            }
            const routePayload = await fetchJson(routeUrl, {
                headers,
                signal,
                timeoutMs: config.quotes.timeoutMs,
            })
            const routeData = isRecord(routePayload) && isRecord(routePayload.data)
                ? routePayload.data
                : null
            const routeSummary = routeData && isRecord(routeData.routeSummary)
                ? routeData.routeSummary
                : null

            if (!routeSummary) {
                throw new ProviderError({
                    code: 'KYBERSWAP_NO_ROUTE',
                    message: 'KyberSwap reported no available route for this pair.',
                    outcome: 'no-route',
                })
            }

            const routerAddress = normalizeAddress(routeData?.routerAddress)
            if (routerAddress !== KYBERSWAP_ROUTER_ADDRESS) {
                throw new ProviderError({
                    code: 'KYBERSWAP_ROUTER_INVALID',
                    message: 'KyberSwap returned an unauthorized router address.',
                    outcome: 'validation',
                })
            }

            validateExtraFee(routeSummary, feeBps, feeRecipient)

            const amountOut = decimalInteger(routeSummary.amountOut)
            if (!amountOut || BigInt(amountOut) <= 0n) {
                throw new ProviderError({
                    code: 'KYBERSWAP_QUOTE_INVALID',
                    message: 'KyberSwap returned an invalid output amount.',
                    outcome: 'validation',
                })
            }

            const deadline = Math.floor(Date.now() / 1_000) + 15 * 60
            const buildUrl = new URL(
                `${KYBERSWAP_BASE_URL}/${chain}/api/v1/route/build`,
            )
            const buildPayload = await fetchJson(buildUrl, {
                method: 'POST',
                headers,
                body: {
                    routeSummary,
                    sender: request.takerAddress,
                    origin: request.takerAddress,
                    recipient: request.takerAddress,
                    slippageTolerance: request.slippageBps,
                    deadline,
                    enableGasEstimation: true,
                    source: clientId(),
                },
                signal,
                timeoutMs: config.quotes.timeoutMs,
            })
            const buildData = isRecord(buildPayload) && isRecord(buildPayload.data)
                ? buildPayload.data
                : null
            const builtRouter = normalizeAddress(buildData?.routerAddress)
            if (!buildData || builtRouter !== KYBERSWAP_ROUTER_ADDRESS) {
                throw new ProviderError({
                    code: 'KYBERSWAP_BUILD_INVALID',
                    message: 'KyberSwap returned an invalid swap transaction.',
                    outcome: 'validation',
                })
            }

            const builtAmountOut = decimalInteger(buildData.amountOut) ?? amountOut
            const gas = decimalInteger(buildData.gas ?? routeSummary.gas)
            const transaction = normalizeTransaction({
                to: builtRouter,
                data: buildData.data,
                value: sellToken.isNative ? request.sellAmount : '0',
                ...(gas ? { gas } : {}),
            })

            return {
                provider: 'kyberswap',
                billingMode: feeBps > 0
                    ? 'provider-integrator'
                    : 'normal-provider-fee',
                quoteId: quoteId(routeSummary.routeID ?? routeData?.requestId, 'kyberswap'),
                chainId: request.chainId,
                sellToken: request.sellToken,
                buyToken: request.buyToken,
                mode: request.mode,
                sellAmount: request.sellAmount,
                buyAmount: builtAmountOut,
                minimumBuyAmount: minimumAmount(
                    builtAmountOut,
                    request.slippageBps,
                ),
                maximumSellAmount: request.sellAmount,
                estimatedGas: gas,
                estimatedGasUsd:
                    typeof buildData.gasUsd === 'string'
                        ? buildData.gasUsd
                        : typeof routeSummary.gasUsd === 'string'
                            ? routeSummary.gasUsd
                            : null,
                allowanceTarget: sellToken.isNative
                    ? null
                    : KYBERSWAP_ROUTER_ADDRESS,
                transaction,
                platformFee: {
                    amount: '0',
                    token: feeBps > 0 ? request.sellToken : null,
                    bps: feeBps,
                    configuredBps: feeBps,
                    effectiveBps: feeBps,
                },
                route: Array.isArray(routeSummary.route)
                    ? routeSummary.route
                    : [],
                permitData: null,
                executable: true,
                expiresAt: futureExpiry(30),
            }
        },

        async healthCheck(signal) {
            if (!enabled()) return false
            try {
                const url = new URL(
                    `${KYBERSWAP_BASE_URL}/bsc/api/v1/routes`,
                )
                url.searchParams.set(
                    'tokenIn',
                    '0x55d398326f99059ff775485246999027b3197955',
                )
                url.searchParams.set(
                    'tokenOut',
                    KYBERSWAP_NATIVE_TOKEN_ADDRESS,
                )
                url.searchParams.set('amountIn', '1000000000000000000')
                const response = await fetch(url, {
                    headers: { 'x-client-id': clientId() },
                    signal,
                })
                return response.ok
            } catch {
                return false
            }
        },
    }
}
