import { getAddress, isAddress, zeroAddress } from 'viem'
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

function sameAddress(left, right) {
    return String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()
}

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
    const logger = level === 'error' ? console.error : console.debug
    logger('[pistachio-swap]', {
        event,
        flow: 'same-chain',
        ...approvalMetadataDiagnostic(value),
    })
}

/**
 * Purpose: validates and normalizes an API quote response and its approval metadata.
 * Inputs: parsed JSON from the quote API.
 * Output: response with checksummed addresses and canonical approval fields.
 * Side effects: emits existing approval diagnostic events.
 * Errors: throws for malformed/legacy approval metadata or quote shape.
 * Security: rejects unbound Permit2 and ERC-20 authorization instructions.
 */
export function normalizeQuoteResponse(value) {
    const selected = value?.selectedQuote
    if (!selected || typeof selected !== 'object') {
        throw new QuoteRequestError('Quote response did not contain an executable route.')
    }

    const provider = String(selected.provider ?? '').trim().toLowerCase()
    const pancakeErc20 = provider === 'pancakeswap' &&
        !sameAddress(selected.sellToken, zeroAddress)
    if (!pancakeErc20) return value

    const approval = selected.approval
    const requiredAmount = String(approval?.requiredAmount ?? '')
    const canonical =
        value.approvalSchemaVersion === APPROVAL_SCHEMA_VERSION &&
        approval?.mode === 'permit2-allowance' &&
        isAddress(approval.contract ?? '') &&
        isAddress(approval.spender ?? '') &&
        isAddress(approval.token ?? '') &&
        /^[1-9]\d*$/.test(requiredAmount) &&
        sameAddress(approval.contract, selected.allowanceTarget) &&
        sameAddress(approval.spender, selected.transaction?.to) &&
        sameAddress(approval.token, selected.sellToken)
    if (!canonical) {
        logApprovalMetadata('approval.metadata.frontend-normalized', value, 'error')
        logApprovalMetadata('approval.metadata.invalid-before-review', value, 'error')
        throw new QuoteRequestError(
            'PancakeSwap approval information is incomplete. Refresh the quote.',
            { code: 'PANCAKESWAP_APPROVAL_METADATA_INCOMPLETE' },
        )
    }

    return {
        ...value,
        approvalSchemaVersion: APPROVAL_SCHEMA_VERSION,
        selectedQuote: {
            ...selected,
            provider,
            approval: {
                mode: 'permit2-allowance',
                contract: getAddress(approval.contract),
                spender: getAddress(approval.spender),
                token: getAddress(approval.token),
                requiredAmount,
            },
        },
    }
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
 * Security: preserves request identity and validates canonical approval metadata.
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
