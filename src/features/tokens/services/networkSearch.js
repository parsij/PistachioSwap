/** Local-only network search; names use normalized word-prefix matching. */
export function matchesNetworkSearch(chain, query) {
    const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    const needle = normalize(query)
    if (!needle) return true
    const words = needle.split(' ')
    return [chain.name, chain.id, chain.nativeCurrency?.symbol, ({ 56: 'BSC', 10: 'OP Mainnet', 137: 'MATIC' })[chain.id], ...(chain.searchAliases ?? [])]
        .some((field) => {
            const parts = normalize(field).split(' ')
            return parts.some((_, start) => words.every((word, index) => parts[start + index]?.startsWith(word)))
        })
}
