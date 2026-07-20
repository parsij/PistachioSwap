import { randomUUID } from 'node:crypto'

import { getApiConfig } from '../../../config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../../lib/address.js'
import { ProviderError } from '../../../lib/errors.js'
import { isRecord } from '../../../lib/http.js'
import type { NormalizedQuote, QuoteRequest } from '../types/types.js'

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
    const mode = value.mode === 'EXACT_OUTPUT' ? 'EXACT_OUTPUT' : 'EXACT_INPUT'
    const sellAmount = decimalInteger(value.sellAmount)
    const buyAmount = decimalInteger(value.buyAmount)
    const sellTokenDecimals = Number(value.sellTokenDecimals)
    const buyTokenDecimals = Number(value.buyTokenDecimals)
    const slippageBps = Number(value.slippageBps ?? 50)

    if (
        !config.allowedChains.has(chainId) ||
        !sellToken ||
        !buyToken ||
        sellToken === buyToken ||
        !takerAddress ||
        (mode === 'EXACT_INPUT' && (!sellAmount || BigInt(sellAmount) <= 0n)) ||
        (mode === 'EXACT_OUTPUT' && (!buyAmount || BigInt(buyAmount) <= 0n)) ||
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
                'Quote requires supported chain and token addresses, a positive integer amount, taker address, and valid slippage.',
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
        mode,
        sellAmount: sellAmount ?? '0',
        buyAmount: buyAmount ?? null,
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
    const maximumSellAmount = decimalInteger(
        quote.maximumSellAmount ?? quote.sellAmount,
    )
    const expiresAt = Date.parse(quote.expiresAt)

    if (
        !buyAmount ||
        !minimum ||
        !sellAmount ||
        !maximumSellAmount ||
        BigInt(buyAmount) <= 0n ||
        BigInt(minimum) <= 0n ||
        BigInt(sellAmount) <= 0n ||
        BigInt(maximumSellAmount) <= 0n ||
        BigInt(minimum) > BigInt(buyAmount) ||
        BigInt(sellAmount) > BigInt(maximumSellAmount) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
    ) {
        throw new ProviderError({
            code: 'QUOTE_MALFORMED',
            message: 'Quote provider returned a malformed or expired quote.',
        })
    }

    const transaction = normalizeTransaction(quote.transaction)
    const rawApproval: Record<string, unknown> | null = isRecord(quote.approval)
        ? quote.approval as unknown as Record<string, unknown>
        : null
    const legacyPermit2 = rawApproval?.type === 'permit2-allowance'
    const approvalMode: 'erc20' | 'permit2-allowance' | null =
        rawApproval?.mode === 'permit2-allowance' || legacyPermit2
        ? 'permit2-allowance'
        : rawApproval?.mode === 'erc20' || rawApproval?.type === 'erc20'
            ? 'erc20'
            : null
    const approvalContract = normalizeAddress(
        rawApproval?.contract ?? rawApproval?.permit2Address,
    )
    const approvalSpender = normalizeAddress(rawApproval?.spender)
    const approvalToken = normalizeAddress(rawApproval?.token)
    const approvalRequiredAmount = decimalInteger(
        rawApproval?.requiredAmount ?? rawApproval?.amount,
    )
    const pancake = String(quote.provider).trim().toLowerCase() === 'pancakeswap'
    let canonicalApproval: NormalizedQuote['approval'] =
        approvalMode && approvalContract && approvalSpender &&
        approvalToken && approvalRequiredAmount && BigInt(approvalRequiredAmount) > 0n
        ? {
              mode: approvalMode,
              contract: approvalContract,
              spender: approvalSpender,
              token: approvalToken,
              requiredAmount: approvalRequiredAmount,
          }
        : null
    const directAllowanceTarget = normalizeAddress(quote.allowanceTarget)
    if (
        !canonicalApproval &&
        !pancake &&
        normalizeAddress(quote.sellToken) !== NATIVE_TOKEN_ADDRESS &&
        directAllowanceTarget
    ) {
        canonicalApproval = {
            mode: 'erc20',
            contract: directAllowanceTarget,
            spender: directAllowanceTarget,
            token: normalizeAddress(quote.sellToken)!,
            requiredAmount: maximumSellAmount,
        }
    }

    if (
        pancake &&
        normalizeAddress(quote.sellToken) !== NATIVE_TOKEN_ADDRESS &&
        (
            canonicalApproval?.mode !== 'permit2-allowance' ||
            canonicalApproval.contract !== normalizeAddress(quote.allowanceTarget) ||
            canonicalApproval.spender !== transaction.to ||
            canonicalApproval.token !== normalizeAddress(quote.sellToken)
        )
    ) {
        throw new ProviderError({
            code: 'PANCAKESWAP_APPROVAL_METADATA_INVALID',
            message: 'PancakeSwap returned incomplete Permit2 approval metadata.',
            outcome: 'validation',
        })
    }

    return {
        ...quote,
        mode: quote.mode ?? 'EXACT_INPUT',
        maximumSellAmount,
        transaction,
        approval: canonicalApproval,
    }
}
