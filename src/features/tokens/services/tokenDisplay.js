const BROKEN_GLYPHS = /[\uFFFD\u25A1\u25AF\u25FB\u25FC]/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const SAFE_TOKEN_TEXT = /^[\p{Script=Latin}\p{N}\p{M}\s._+\-/$()#:&'’%,]+$/u

function shortAddress(address) {
    const value = String(address ?? '').trim()
    return /^0x[a-fA-F0-9]{40}$/.test(value)
        ? `${value.slice(0, 6)}…${value.slice(-4)}`
        : null
}

export function isSafeTokenDisplayText(value, maximumLength = 80) {
    const text = String(value ?? '').trim()
    return Boolean(
        text &&
        text.length <= maximumLength &&
        !BROKEN_GLYPHS.test(text) &&
        !CONTROL_CHARACTERS.test(text) &&
        SAFE_TOKEN_TEXT.test(text) &&
        /[\p{L}\p{N}]/u.test(text),
    )
}

export function getTokenDisplaySymbol(token) {
    const symbol = String(token?.symbol ?? '').trim()
    if (isSafeTokenDisplayText(symbol, 24)) return symbol
    if (token?.isNative === true) return 'Native'
    return shortAddress(token?.address) ?? 'Token'
}

export function getTokenDisplayName(token) {
    const name = String(token?.name ?? '').trim()
    if (isSafeTokenDisplayText(name, 100)) return name

    const symbol = String(token?.symbol ?? '').trim()
    if (isSafeTokenDisplayText(symbol, 24)) return symbol

    const address = shortAddress(token?.address)
    return address ? `Token ${address}` : 'Unknown token'
}

export const tokenDisplayInternals = {
    shortAddress,
}
