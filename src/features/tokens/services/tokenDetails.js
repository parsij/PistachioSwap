import { apiBaseUrl as defaultApiBaseUrl } from '../../../lib/apiBaseUrl.js'

function getApiBaseUrl() {
    return defaultApiBaseUrl
}

function getKnownCoinGeckoId(token) {
    return (
        token?.coinGeckoId ??
        token?.coingeckoId ??
        token?.coingecko_coin_id ??
        token?.coinGeckoWebSlug ??
        null
    )
}

function buildCoinGeckoUrl(coinId) {
    return (
        'https://www.coingecko.com/en/coins/' +
        encodeURIComponent(coinId)
    )
}

/**
 * Resolves an external CoinGecko detail URL from configured token metadata/backend lookup.
 * @returns {Promise<string | null>} Valid HTTPS detail URL or null when no trusted mapping exists.
 * @sideEffects May perform one abortable backend HTTP request; never contacts a wallet.
 */
export async function getCoinGeckoTokenUrl(
    token,
    { signal } = {},
) {
    const knownId =
        getKnownCoinGeckoId(token)

    if (knownId) {
        return buildCoinGeckoUrl(knownId)
    }

    const chainId = Number(token?.chainId)
    const address = String(
        token?.address ?? '',
    ).trim()

    if (
        !Number.isInteger(chainId) ||
        chainId <= 0
    ) {
        throw new Error(
            'Token chain ID is unavailable.',
        )
    }

    if (
        !/^0x[a-fA-F0-9]{40}$/.test(address)
    ) {
        throw new Error(
            'CoinGecko details are unavailable for this token.',
        )
    }

    const url = new URL(
        `${getApiBaseUrl()}/v1/token-details/coingecko`,
        globalThis.location?.origin,
    )

    url.searchParams.set(
        'chainId',
        String(chainId),
    )

    url.searchParams.set(
        'address',
        address,
    )

    const response = await fetch(
        url.toString(),
        {
            method: 'GET',
            headers: {
                accept: 'application/json',
            },
            signal,
        },
    )

    if (!response.ok) {
        let message =
            'CoinGecko details are unavailable.'

        try {
            const body = await response.json()

            message =
                body?.error?.message ??
                message
        } catch {
            // Keep the normal error message.
        }

        throw new Error(message)
    }

    const payload = await response.json()

    if (
        typeof payload.url !== 'string' ||
        !payload.url.startsWith(
            'https://www.coingecko.com/',
        )
    ) {
        throw new Error(
            'Backend returned an invalid CoinGecko URL.',
        )
    }

    return payload.url
}


const TOKEN_MARKET_PERIODS = new Set(['1H', '1D', '1W', '1M', '1Y', 'ALL'])

export async function fetchTokenMarketDetails(
    token,
    {
        period = '1D',
        includeYearStats = false,
        chartStyle = 'line',
        signal,
    } = {},
) {
    const chainId = Number(token?.chainId)
    const address = String(token?.address ?? '').trim()
    const normalizedPeriod = String(period).trim().toUpperCase()

    if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error('Token chain ID is unavailable.')
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error('Token contract address is unavailable.')
    }
    if (!TOKEN_MARKET_PERIODS.has(normalizedPeriod)) {
        throw new Error('Unsupported token market period.')
    }

    const url = new URL(
        `${getApiBaseUrl()}/v1/token-details/market`,
        globalThis.location?.origin,
    )
    url.searchParams.set('chainId', String(chainId))
    url.searchParams.set('address', address)
    url.searchParams.set('period', normalizedPeriod)
    if (includeYearStats) url.searchParams.set('includeYearStats', 'true')
    if (chartStyle === 'candles') url.searchParams.set('chartStyle', chartStyle)

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal,
    })

    if (!response.ok) {
        let message = 'Token market data is unavailable.'
        try {
            const body = await response.json()
            message = body?.error?.message ?? message
        } catch {
            // Keep the normal fallback message.
        }
        throw new Error(message)
    }

    const payload = await response.json()
    if (
        payload?.schemaVersion !== 1 ||
        Number(payload?.chainId) !== chainId ||
        String(payload?.address ?? '').toLowerCase() !== address.toLowerCase() ||
        payload?.chart?.period !== normalizedPeriod ||
        !Array.isArray(payload?.chart?.points)
    ) {
        throw new Error('Backend returned invalid token market data.')
    }

    return payload
}
