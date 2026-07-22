import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'
import { tokenDiscoveryContext } from '../../token-discovery/context.js'

export async function moralisWalletHistoryRequest({
    chainId,
    walletAddress,
    limit = 25,
    signal,
}: {
    chainId: number
    walletAddress: string
    limit?: number
    signal?: AbortSignal
}) {
    const wallet = normalizeAddress(walletAddress)
    if (!wallet) {
        throw new ProviderError({
            code: 'MORALIS_INVALID_WALLET_ADDRESS',
            message: 'A valid wallet address is required.',
            statusCode: 400,
            outcome: 'validation',
        })
    }

    const config = getApiConfig().moralis
    const context = tokenDiscoveryContext(chainId)
    const moralisChain = context.chain.providers.moralisChain
    if (!context.chain.capabilities.moralis || !moralisChain) return null
    if (!config.enabled || !config.apiKey) return null

    const url = new URL(
        `${config.baseUrl}/wallets/${encodeURIComponent(wallet)}/history`,
    )
    url.searchParams.set('chain', moralisChain)
    url.searchParams.set('order', 'DESC')
    url.searchParams.set('limit', String(Math.max(1, Math.min(50, limit))))
    url.searchParams.set('include_internal_transactions', 'false')
    url.searchParams.set('nft_metadata', 'false')

    return fetchJson(url, {
        headers: { 'X-API-Key': config.apiKey },
        signal,
        timeoutMs: config.requestTimeoutMs,
        retries: 1,
        dedupeKey: `moralis-history:${chainId}:${wallet}:${limit}`,
    })
}
