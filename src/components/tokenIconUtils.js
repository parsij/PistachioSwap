export function getTokenLogoCandidates(token) {
    const values = [
        ...(Array.isArray(token?.logoCandidates)
            ? token.logoCandidates
            : []),
        token?.logoURI,
        token?.iconUrl,
    ]
    const seen = new Set()

    return values.filter((value) => {
        if (
            typeof value !== 'string' ||
            !value.trim() ||
            seen.has(value)
        ) {
            return false
        }

        seen.add(value)
        return true
    })
}

export function getTokenFallbackLetter(token) {
    return String(token?.symbol ?? token?.name ?? '?')
        .trim()
        .slice(0, 1)
        .toUpperCase()
}
