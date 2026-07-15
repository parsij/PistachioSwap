import { randomUUID } from 'node:crypto'

import { getApiConfig } from '../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { isRecord } from '../../lib/http.js'
import type { NormalizedQuote, QuoteRequest } from './types.js'

export function decimalInteger(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const normalized = String(value)
    return /^(0|[1-9]\d*)$/.test(normalized) ? normalized : null
}

export function quoteId(value: unknown, provider: string) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : `${provider}-${randomUUID()}`
}

export function futureExpiry(seconds = 30) {
    return new Date(Date.now() + seconds * 1000).toISOString()
}

export function normalizeTransaction(
    value: unknown,
): NormalizedQuote['transaction'] {
    if (!isRecord(value)) {
        throw new ProviderError({
            code: 'QUOTE_TRANSACTION_INVALID',
            message: 'Quote provider did not return a transaction.',
        })
    }

    const to = normalizeAddress(value.to)
    const data = typeof value.data === 'string' ? value.data : ''
    const rawValue = decimalInteger(value.value)
    const hexValue =
        typeof value.value === 'string' && /^0x[a-fA-F0-9]+$/.test(value.value)
            ? BigInt(value.value).toString()
            : null
    const gas =
        decimalInteger(value.gas ?? value.gasLimit) ??
        (typeof (value.gas ?? value.gasLimit) === 'string' &&
        /^0x[a-fA-F0-9]+$/.test(String(value.gas ?? value.gasLimit))
            ? BigInt(String(value.gas ?? value.gasLimit)).toString()
            : undefined)

    if (!to || !/^0x[a-fA-F0-9]+$/.test(data) || data === '0x') {
        throw new ProviderError({
            code: 'QUOTE_TRANSACTION_INVALID',
            message: 'Quote provider returned invalid transaction calldata.',
        })
    }

    return {
        to,
        data,
        value: rawValue ?? hexValue ?? '0',
        ...(gas ? { gas } : {}),
    }
}

export function validateQuoteRequest(value: unknown): QuoteRequest {
    if (!isRecord(value)) {
        throw new ProviderError({
            code: 'INVALID_QUOTE_REQUEST',
            message: 'A quote request body is required.',
            statusCode: 400,
        })
    }

    const config = getApiConfig()
    const chainId = Number(value.chainId)
    const sellToken = normalizeAddress(value.sellToken)
    const buyToken = normalizeAddress(value.buyToken)
    const takerAddress = normalizeAddress(value.takerAddress)
    const sellAmount = decimalInteger(value.sellAmount)
    const sellTokenDecimals = Number(value.sellTokenDecimals)
    const buyTokenDecimals = Number(value.buyTokenDecimals)
    const slippageBps = Number(value.slippageBps ?? 50)

    if (
        !config.allowedChains.has(chainId) ||
        !sellToken ||
        !buyToken ||
        sellToken === buyToken ||
        !takerAddress ||
        !sellAmount ||
        BigInt(sellAmount) <= 0n ||
        !Number.isInteger(sellTokenDecimals) ||
        sellTokenDecimals < 0 ||
        sellTokenDecimals > 255 ||
        !Number.isInteger(buyTokenDecimals) ||
        buyTokenDecimals < 0 ||
        buyTokenDecimals > 255 ||
        !Number.isInteger(slippageBps) ||
        slippageBps < 1 ||
        slippageBps > 10_000
    ) {
        throw new ProviderError({
            code: 'INVALID_QUOTE_REQUEST',
            message:
                'Quote requires supported chain and token addresses, a positive integer sell amount, taker address, and valid slippage.',
            statusCode: 400,
        })
    }

    return {
        chainId,
        sellToken:
            sellToken === NATIVE_TOKEN_ADDRESS
                ? NATIVE_TOKEN_ADDRESS
                : sellToken,
        buyToken:
            buyToken === NATIVE_TOKEN_ADDRESS
                ? NATIVE_TOKEN_ADDRESS
                : buyToken,
        sellAmount,
        sellTokenDecimals,
        buyTokenDecimals,
        takerAddress,
        slippageBps,
    }
}

export function assertNormalizedQuote(quote: NormalizedQuote) {
    const buyAmount = decimalInteger(quote.buyAmount)
    const minimum = decimalInteger(quote.minimumBuyAmount)
    const sellAmount = decimalInteger(quote.sellAmount)
    const expiresAt = Date.parse(quote.expiresAt)

    if (
        !buyAmount ||
        !minimum ||
        !sellAmount ||
        BigInt(buyAmount) <= 0n ||
        BigInt(minimum) <= 0n ||
        BigInt(minimum) > BigInt(buyAmount) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
    ) {
        throw new ProviderError({
            code: 'QUOTE_MALFORMED',
            message: 'Quote provider returned a malformed or expired quote.',
        })
    }

    normalizeTransaction(quote.transaction)
    return quote
}
