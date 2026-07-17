import { isAddress } from 'viem'
import { isCuratedEvmChainId } from '../web3/curatedEvmChains.js'

export function createQuoteRequestBody({
    chainId,
    sellToken,
    buyToken,
    sellAmount,
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
        sellToken,
        buyToken,
        sellAmount,
        sellTokenDecimals: Number(sellTokenDecimals),
        buyTokenDecimals: Number(buyTokenDecimals),
        takerAddress,
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

export function isCurrentQuoteResponse(signal) {
    return !signal?.aborted
}

const quoteCache = new Map()

export async function fetchSwapQuote({
    endpoint,
    request,
    signal,
}) {
    const key = JSON.stringify(request)
    const cached = quoteCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value

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
        const firstProvider = Array.isArray(error?.providers)
            ? error.providers[0]
            : null
        throw new QuoteRequestError(
            firstProvider?.message ?? error?.message ?? 'No route is currently available.',
            error ?? null,
        )
    }

    const value = await response.json()
    const providerExpiry = Date.parse(value?.selectedQuote?.expiresAt ?? '')
    quoteCache.set(key, {
        value,
        expiresAt: Math.min(
            Number.isFinite(providerExpiry) ? providerExpiry : Date.now() + 10_000,
            Date.now() + 10_000,
        ),
    })
    return value
}
