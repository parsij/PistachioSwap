import { getAddress, isAddress } from 'viem'
import { isCuratedEvmChainId } from '../../../web3/curatedEvmChains.js'

/**
 * Purpose: creates the stable frontend payload for the same-chain quote API.
 * Inputs: chain/token identities, exact-input or exact-output integer amounts,
 * token decimals, connected taker address, and slippage basis points.
 * Output: normalized request JSON accepted by `POST /v1/quote`.
 * Side effects: none.
 * Errors: throws for unsupported chains, malformed addresses, amounts, or decimals.
 * Security: validates exact addresses before browser data reaches the API.
 */
export function createQuoteRequestBody({
    chainId,
    sellToken,
    buyToken,
    mode = 'EXACT_INPUT',
    sellAmount,
    buyAmount = null,
    sellTokenDecimals,
    buyTokenDecimals,
    takerAddress,
    slippageBps = 50,
}) {
    if (!isCuratedEvmChainId(chainId)) {
        throw new Error('Executable quotes require an enabled EVM chain.')
    }

    if (
        !isAddress(takerAddress ?? '') ||
        !isAddress(sellToken ?? '') ||
        !isAddress(buyToken ?? '')
    ) {
        throw new Error(
            'Valid token and connected wallet addresses are required.',
        )
    }

    if (
        !Number.isInteger(Number(sellTokenDecimals)) ||
        !Number.isInteger(Number(buyTokenDecimals))
    ) {
        throw new Error('Exact token decimals are required.')
    }

    if (
        !Number.isInteger(slippageBps) ||
        slippageBps <= 0 ||
        slippageBps > 10_000
    ) {
        throw new Error('Slippage must be between 1 and 10000 basis points.')
    }

    return {
        chainId: Number(chainId),
        sellToken: getAddress(sellToken),
        buyToken: getAddress(buyToken),
        mode,
        sellAmount,
        buyAmount,
        sellTokenDecimals: Number(sellTokenDecimals),
        buyTokenDecimals: Number(buyTokenDecimals),
        takerAddress: getAddress(takerAddress),
        slippageBps,
    }
}

export class QuoteRequestError extends Error {
    constructor(message, diagnostic = null) {
        super(message)
        this.name = 'QuoteRequestError'
        this.diagnostic = diagnostic
    }
}

/**
 * Purpose: reports whether an abort signal still permits applying a quote.
 * Inputs: optional `AbortSignal` associated with a quote request.
 * Output: boolean currentness result.
 * Side effects: none. Errors: none. Security: prevents stale responses from
 * replacing the active quote.
 */
export function isCurrentQuoteResponse(signal) {
    return !signal?.aborted
}

const quoteCache = new Map()
const MAX_QUOTE_CACHE_ENTRIES = 100
export const APPROVAL_SCHEMA_VERSION = 1

function approvalMetadataDiagnostic(value) {
    const selected = value?.selectedQuote
    const approval = selected?.approval
    return {
        hasApproval: Boolean(approval),
        mode: approval?.mode ?? null,
        contract: approval?.contract ?? null,
        spender: approval?.spender ?? null,
        token: approval?.token ?? null,
        requiredAmount: approval?.requiredAmount ?? null,
        provider: selected?.provider ?? null,
        transactionTarget: selected?.transaction?.to ?? null,
        chainId: selected?.chainId ?? null,
    }
}

function logApprovalMetadata(event, value, level = 'debug') {
    // Approval metadata names the wallet's counterparties; keep it out of
    // production consoles. Errors still surface through the caller.
    if (!import.meta.env.DEV) return
    const logger = level === 'error' ? console.error : console.debug
    logger('[pistachio-swap]', {
        event,
        flow: 'same-chain',
        ...approvalMetadataDiagnostic(value),
    })
}

/**
 * Purpose: validates the stable same-chain API response envelope.
 * Provider-specific approval normalization is owned by the backend, so the
 * browser never reconstructs or guesses approval authorities.
 */
export function normalizeQuoteResponse(value) {
    const selected = value?.selectedQuote
    if (!selected || typeof selected !== 'object') {
        throw new QuoteRequestError('Quote response did not contain an executable route.')
    }
    if (value.approvalSchemaVersion !== APPROVAL_SCHEMA_VERSION) {
        logApprovalMetadata('approval.metadata.invalid-before-review', value, 'error')
        throw new QuoteRequestError(
            'Quote approval information is incompatible. Refresh the quote.',
            { code: 'APPROVAL_SCHEMA_VERSION_UNSUPPORTED' },
        )
    }
    return value
}

function pruneQuoteCache(now = Date.now(), enforceCapacity = false) {
    for (const [key, entry] of quoteCache) {
        if (entry.expiresAt <= now) quoteCache.delete(key)
    }
    while (enforceCapacity && quoteCache.size >= MAX_QUOTE_CACHE_ENTRIES) {
        quoteCache.delete(quoteCache.keys().next().value)
    }
}

/**
 * Purpose: fetches, normalizes, and short-term caches a same-chain quote.
 * Inputs: endpoint, request body, optional abort signal, and force-refresh flag.
 * Output: promise resolving to the normalized quote response.
 * Side effects: performs browser HTTP, writes/prunes cache, and emits diagnostics.
 * Errors: rejects API failures as `QuoteRequestError` and rejects invalid payloads.
 * Security: preserves request identity and trusts only backend-normalized approval metadata.
 */
export async function fetchSwapQuote({
    endpoint,
    request,
    signal,
    forceRefresh = false,
}) {
    const key = `${APPROVAL_SCHEMA_VERSION}:${JSON.stringify(request)}`
    pruneQuoteCache()
    const cached = quoteCache.get(key)
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
        const normalizedCached = normalizeQuoteResponse(cached.value)
        quoteCache.delete(key)
        quoteCache.set(key, { ...cached, value: normalizedCached })
        logApprovalMetadata('approval.metadata.frontend-normalized', normalizedCached)
        return normalizedCached
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        signal,
        body: JSON.stringify(request),
    })

    if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const error = payload?.error
        throw new QuoteRequestError(
            error?.message ?? 'No route is currently available.',
            error ?? null,
        )
    }

    const receivedValue = await response.json()
    logApprovalMetadata('approval.metadata.frontend-received', receivedValue)
    const value = normalizeQuoteResponse(receivedValue)
    logApprovalMetadata('approval.metadata.frontend-normalized', value)
    const providerExpiry = Date.parse(value?.selectedQuote?.expiresAt ?? '')
    pruneQuoteCache(Date.now(), true)
    quoteCache.set(key, {
        value,
        expiresAt: Math.min(
            Number.isFinite(providerExpiry) ? providerExpiry : Date.now() + 10_000,
            Date.now() + 10_000,
        ),
    })
    return value
}

export function quoteCacheSizeForTest() {
    return quoteCache.size
}

export function clearQuoteCacheForTest() {
    quoteCache.clear()
}
