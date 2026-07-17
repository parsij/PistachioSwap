const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export function randomBytes(length, cryptoImpl = globalThis.crypto) {
    if (!Number.isInteger(length) || length < 1 || !cryptoImpl?.getRandomValues) {
        throw new TypeError('Secure random bytes are unavailable.')
    }
    return cryptoImpl.getRandomValues(new Uint8Array(length))
}

export function bytesToBase64Url(value) {
    const bytes = toUint8Array(value)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const base64 = typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(bytes).toString('base64')
    return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function base64UrlToBytes(value, expectedLength) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
        throw new TypeError('Invalid base64url value.')
    }
    const padding = '='.repeat((4 - (value.length % 4)) % 4)
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + padding
    let bytes
    try {
        const binary = typeof atob === 'function'
            ? atob(base64)
            : Buffer.from(base64, 'base64').toString('binary')
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    } catch {
        throw new TypeError('Invalid base64url value.')
    }
    if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
        throw new TypeError(`Expected ${expectedLength} bytes.`)
    }
    if (bytesToBase64Url(bytes) !== value) throw new TypeError('Non-canonical base64url value.')
    return bytes
}

export function toUint8Array(value) {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }
    throw new TypeError('Expected binary data.')
}

export function utf8(value) {
    return textEncoder.encode(String(value))
}

export function decodeUtf8(value) {
    return textDecoder.decode(toUint8Array(value))
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
        )
    }
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    throw new TypeError('Canonical JSON contains an unsupported value.')
}

export function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value))
}

export function wipeBytes(value) {
    if (value instanceof ArrayBuffer) {
        if (value.byteLength === 0) return
        new Uint8Array(value).fill(0)
    } else if (ArrayBuffer.isView(value)) {
        if (value.byteLength === 0) return
        value.fill(0)
    }
}
