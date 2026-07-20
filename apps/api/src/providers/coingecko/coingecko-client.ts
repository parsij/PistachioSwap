import { getApiConfig } from '../../config.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'

export async function coinGeckoRequest(
    path: string,
    {
        signal,
        notFoundAsNull = false,
    }: {
        signal?: AbortSignal
        notFoundAsNull?: boolean
    } = {},
) {
    const config = getApiConfig()
    const apiKey = config.coinGecko.apiKey

    if (!apiKey) {
        throw new ProviderError({
            code: 'COINGECKO_NOT_CONFIGURED',
            message: 'CoinGecko API is not configured.',
            statusCode: 503,
            outcome: 'configuration',
        })
    }

    const url = new URL(`${config.coinGecko.baseUrl}${path}`)

    return fetchJson(url, {
        headers: {
            'x-cg-demo-api-key': apiKey,
        },
        signal,
        timeoutMs: config.requestTimeoutMs,
        retries: 2,
        dedupeKey: `coingecko:${url.toString()}`,
        notFoundAsNull,
    })
}
