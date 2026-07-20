const DEFAULT_API_BASE_URL =
    'http://localhost:3001'

function getApiBaseUrl() {
    return (
        import.meta.env.VITE_API_BASE_URL ??
        DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '')
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
