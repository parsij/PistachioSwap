import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'

export async function moralisWalletTokensRequest({
    walletAddress,
    cursor,
    signal,
}: {
    walletAddress: string
    cursor?: string | null
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
    if (!config.enabled || !config.apiKey) return null

    const url = new URL(
        `${config.baseUrl}/wallets/${encodeURIComponent(wallet)}/tokens`,
    )
    url.searchParams.set('chain', 'bsc')
    url.searchParams.set('exclude_spam', 'false')
    url.searchParams.set('exclude_unverified_contracts', 'false')
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)

    return fetchJson(url, {
        headers: { 'X-API-Key': config.apiKey },
        signal,
        timeoutMs: config.requestTimeoutMs,
        retries: 2,
        dedupeKey: `moralis:56:${wallet}:${cursor ?? 'first'}`,
    })
}
