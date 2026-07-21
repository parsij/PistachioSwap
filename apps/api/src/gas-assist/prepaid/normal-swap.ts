import { isAddressEqual, type Address, type Hex } from 'viem'

import { getApiConfig } from '../../config.js'
import { createUniswapProvider } from '../../features/quotes/providers/uniswap-provider.js'
import { ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN, createZeroXProvider } from '../../features/quotes/providers/zero-x-provider.js'
import type { NormalizedQuote, QuoteProvider, QuoteRequest } from '../../features/quotes/types/types.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import { GasAssistError } from '../errors.js'

const HEX_DATA = /^0x(?:[0-9a-f]{2})+$/i
const UNISWAP_SPONSORED_PROXY_TARGETS = new Set([
    '0x0000000085e102724e78ecd2f45dc9ca239affad',
    '0x02e5be68d46dac0b524905bff209cf47ee6db2a9',
])

export type ExactSponsoredQuote = NormalizedQuote & {
    provider: 'uniswap' | '0x'
    transaction: {
        to: Address
        data: Hex
        value: string
        gas?: string
    }
    allowanceTarget: Address
}

function exactAddress(value: string, field: string) {
    const normalized = normalizeAddress(value)
    if (!normalized) throw new GasAssistError('SPONSORED_QUOTE_INVALID', `The provider returned an invalid ${field}.`, 409)
    return normalized as Address
}

function positiveRaw(value: string, field: string) {
    if (!/^[1-9]\d*$/.test(value)) throw new GasAssistError('SPONSORED_QUOTE_INVALID', `The provider returned an invalid ${field}.`, 409)
    return BigInt(value)
}

function validateBaseQuote({
    quote,
    sellToken,
    buyToken,
    sellAmount,
}: {
    quote: NormalizedQuote
    sellToken: Address
    buyToken: string
    sellAmount: bigint
}) {
    const allowanceTarget = exactAddress(String(quote.allowanceTarget ?? ''), 'allowance target')
    const transactionTo = exactAddress(String(quote.transaction?.to ?? ''), 'swap target')
    const normalizedBuy = buyToken === NATIVE_TOKEN_ADDRESS ? NATIVE_TOKEN_ADDRESS : exactAddress(buyToken, 'buy token')

    if (!['uniswap', '0x'].includes(quote.provider) || quote.billingMode !== 'normal-provider-fee' ||
        quote.chainId !== 56 || quote.mode !== 'EXACT_INPUT' ||
        !isAddressEqual(exactAddress(quote.sellToken, 'sell token'), sellToken) ||
        (normalizedBuy === NATIVE_TOKEN_ADDRESS
            ? quote.buyToken !== NATIVE_TOKEN_ADDRESS
            : !isAddressEqual(exactAddress(quote.buyToken, 'buy token'), normalizedBuy as Address)) ||
        BigInt(quote.sellAmount) !== sellAmount || quote.maximumSellAmount !== quote.sellAmount) {
        throw new GasAssistError('SPONSORED_QUOTE_MISMATCH', 'The quote does not match the exact sponsored request.', 409)
    }
    if (!HEX_DATA.test(String(quote.transaction?.data ?? '')) || String(quote.transaction?.data).length < 10) {
        throw new GasAssistError('SPONSORED_QUOTE_INVALID', 'The provider returned invalid swap calldata.', 409)
    }
    if (!/^\d+$/.test(String(quote.transaction?.value ?? '')) || BigInt(quote.transaction!.value) !== 0n) {
        throw new GasAssistError('SPONSORED_QUOTE_INVALID', 'The sponsored BEP-20 swap must have zero native value.', 409)
    }
    if (quote.platformFee.amount !== '0' || quote.platformFee.bps !== 0 || quote.permitData !== null) {
        throw new GasAssistError('SPONSORED_FEE_MODE_INVALID', 'The prepaid quote must not include a provider-integrator fee or permit payload.', 409)
    }
    if (Date.parse(quote.expiresAt) <= Date.now() + 5_000) {
        throw new GasAssistError('SPONSORED_QUOTE_EXPIRED', 'The sponsored quote is too close to expiration.', 409)
    }
    positiveRaw(quote.buyAmount, 'buy amount')
    positiveRaw(quote.minimumBuyAmount, 'minimum buy amount')
    if (BigInt(quote.minimumBuyAmount) > BigInt(quote.buyAmount)) {
        throw new GasAssistError('SPONSORED_QUOTE_INVALID', 'The minimum output exceeds the expected output.', 409)
    }
    return { allowanceTarget, transactionTo, normalizedBuy }
}

export function validateExactSponsoredQuote({
    quote,
    sellToken,
    buyToken,
    sellAmount,
}: {
    quote: NormalizedQuote
    sellToken: Address
    buyToken: string
    sellAmount: bigint
}): ExactSponsoredQuote {
    const config = getApiConfig().sponsorship
    const { allowanceTarget, transactionTo, normalizedBuy } = validateBaseQuote({ quote, sellToken, buyToken, sellAmount })

    if (quote.provider === '0x') {
        const expectedAllowanceHolder = ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.get(56)
        if (!expectedAllowanceHolder || !isAddressEqual(allowanceTarget, expectedAllowanceHolder as Address) ||
            !config.zeroXSafeApprovalTargets.has(allowanceTarget) ||
            config.zeroXSettlerAddress === allowanceTarget) {
            throw new GasAssistError('UNSAFE_APPROVAL_TARGET', '0x returned an unauthorized allowance target.', 409)
        }
        if (!config.zeroXSettlerAddress || !isAddressEqual(transactionTo, config.zeroXSettlerAddress as Address)) {
            throw new GasAssistError('UNSAFE_SWAP_TARGET', '0x returned a swap target that is not the configured Settler.', 409)
        }
    } else if (quote.provider === 'uniswap') {
        if (!UNISWAP_SPONSORED_PROXY_TARGETS.has(allowanceTarget) ||
            !UNISWAP_SPONSORED_PROXY_TARGETS.has(transactionTo) ||
            !isAddressEqual(allowanceTarget, transactionTo)) {
            throw new GasAssistError('UNSAFE_SWAP_TARGET', 'Uniswap returned an unauthorized proxy approval or swap target.', 409)
        }
        if (quote.approval?.mode !== 'erc20' ||
            !isAddressEqual(exactAddress(String(quote.approval.spender ?? ''), 'approval spender'), allowanceTarget) ||
            !isAddressEqual(exactAddress(String(quote.approval.token ?? ''), 'approval token'), sellToken) ||
            String(quote.approval.requiredAmount ?? '') !== sellAmount.toString()) {
            throw new GasAssistError('UNSAFE_APPROVAL_TARGET', 'Uniswap returned inconsistent exact approval metadata.', 409)
        }
    } else {
        throw new GasAssistError('SPONSORED_PROVIDER_UNSUPPORTED', 'The provider is not supported for exact sponsorship.', 409)
    }

    return {
        ...quote,
        provider: quote.provider,
        sellToken,
        buyToken: normalizedBuy,
        allowanceTarget,
        transaction: {
            to: transactionTo,
            data: quote.transaction!.data as Hex,
            value: quote.transaction!.value,
            ...(quote.transaction!.gas ? { gas: quote.transaction!.gas } : {}),
        },
    } as ExactSponsoredQuote
}

function providerList(provided?: QuoteProvider[]) {
    if (provided) return provided
    const config = getApiConfig()
    const requested = new Set(config.sponsorship.sponsoredSwapProviders)
    const providers: QuoteProvider[] = []
    if (requested.has('uniswap') && config.quotes.uniswap.enabled) {
        providers.push(createUniswapProvider({ applyPlatformFee: false }))
    }
    if (requested.has('0x') && config.quotes.zeroX.enabled) {
        providers.push(createZeroXProvider({ applyPlatformFee: false }))
    }
    return providers
}

export async function getExactSponsoredQuote({
    wallet,
    sellToken,
    buyToken,
    sellAmount,
    sellTokenDecimals,
    buyTokenDecimals,
    slippageBps,
    signal,
    providers,
}: {
    wallet: Address
    sellToken: Address
    buyToken: string
    sellAmount: bigint
    sellTokenDecimals: number
    buyTokenDecimals: number
    slippageBps: number
    signal?: AbortSignal
    providers?: QuoteProvider[]
}) {
    const request: QuoteRequest = {
        chainId: 56,
        sellToken,
        buyToken,
        mode: 'EXACT_INPUT',
        sellAmount: sellAmount.toString(),
        buyAmount: null,
        sellTokenDecimals,
        buyTokenDecimals,
        takerAddress: wallet,
        slippageBps,
    }
    const failures: string[] = []
    for (const provider of providerList(providers)) {
        try {
            const quote = await provider.getQuote(request, signal)
            return validateExactSponsoredQuote({ quote, sellToken, buyToken, sellAmount })
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? String((error as { code?: unknown }).code ?? 'PROVIDER_FAILED')
                : 'PROVIDER_FAILED'
            failures.push(`${provider.name}:${code}`)
        }
    }
    throw new GasAssistError(
        'SPONSORED_ROUTE_UNAVAILABLE',
        'Uniswap and the configured sponsored fallback providers could not return a safe executable route.',
        409,
        { providers: failures },
    )
}

export const getExactSponsoredZeroXQuote = getExactSponsoredQuote
export const validateExactSponsoredZeroXQuote = validateExactSponsoredQuote
export type ExactSponsoredZeroXQuote = ExactSponsoredQuote

export function quoteGasLimit(quote: ExactSponsoredQuote) {
    const value = quote.transaction.gas ?? quote.estimatedGas
    if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
        throw new GasAssistError('SPONSORED_GAS_ESTIMATE_MISSING', 'The provider did not return a usable swap gas estimate.', 409)
    }
    return BigInt(value)
}

export function quoteSelector(quote: ExactSponsoredQuote) {
    return quote.transaction.data.slice(0, 10).toLowerCase()
}
