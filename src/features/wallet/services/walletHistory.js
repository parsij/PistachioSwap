function normalizeChainIds(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0))]
        .slice(0, 8)
}

export async function fetchWalletHistory({
    walletAddress,
    chainIds,
    limit = 50,
    signal,
    apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL ??
        'http://localhost:3001',
} = {}) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(walletAddress ?? ''))) {
        throw new Error('A valid wallet address is required.')
    }

    const normalizedChainIds = normalizeChainIds(chainIds)
    const url = new URL(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/wallet-activity`,
    )
    url.searchParams.set('address', walletAddress)
    url.searchParams.set('chainIds', normalizedChainIds.join(','))
    url.searchParams.set('limit', String(Math.max(1, Math.min(50, Number(limit) || 50))))

    const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
    })
    if (!response.ok) {
        throw new Error('Wallet history could not be loaded.')
    }

    const payload = await response.json().catch(() => null)
    if (!payload || !Array.isArray(payload.items)) {
        throw new Error('Wallet history response was invalid.')
    }
    return payload
}

export const walletHistoryInternals = {
    normalizeChainIds,
}
