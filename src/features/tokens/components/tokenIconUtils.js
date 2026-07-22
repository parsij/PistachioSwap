import { getTokenDisplaySymbol } from '../services/tokenDisplay.js'

/** Returns the ordered, deduplicated logo URL candidates allowed for a token icon. */
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

/** Returns the single visible fallback character used when all token logos fail. */
export function getTokenFallbackLetter(token) {
    return getTokenDisplaySymbol(token)
        .slice(0, 1)
        .toUpperCase()
}
