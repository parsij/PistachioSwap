export function sendTokenMatchesSearch(token, query) {
    const normalizedQuery = String(query ?? '').trim().toLowerCase()
    if (!normalizedQuery) return true

    const aliases = Array.isArray(token?.searchAliases)
        ? token.searchAliases
        : []
    const fields = [
        token?.name,
        token?.symbol,
        token?.sourceName,
        token?.sourceSymbol,
        token?.address,
        ...aliases,
    ]

    return fields.some((value) =>
        String(value ?? '').toLowerCase().includes(normalizedQuery))
}
