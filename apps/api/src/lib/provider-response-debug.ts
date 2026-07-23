const MAX_DEPTH = 8
const MAX_ARRAY_ITEMS = 100
const MAX_STRING_LENGTH = 8_000
const MAX_SERIALIZED_LENGTH = 60_000

const SENSITIVE_KEY = /(?:api[_-]?key|authorization|cookie|access[_-]?token|private[_-]?key|secret|password|mnemonic|recovery[_-]?phrase|signature|signed[_-]?raw[_-]?transaction)/i

function sanitizeProviderString(value: string) {
    const redacted = value
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/([?&](?:api[_-]?key|key|token|secret|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/(\/prices\/v1\/)[^/\s]+/gi, '$1[REDACTED]')
        .replace(/(open-platform[^/\s]*\/)[^/\s]+(\/megafuel\/)/gi, '$1[REDACTED]$2')

    return redacted.length > MAX_STRING_LENGTH
        ? `${redacted.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
        : redacted
}

function sanitizeProviderValue(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return '[MAX_DEPTH_REACHED]'
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
        return value
    }
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'string') return sanitizeProviderString(value)
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeProviderValue(item, depth + 1))
        if (value.length > MAX_ARRAY_ITEMS) {
            items.push(`[TRUNCATED ${value.length - MAX_ARRAY_ITEMS} ITEMS]`)
        }
        return items
    }
    if (value instanceof Date) return value.toISOString()
    if (value instanceof Error) {
        return {
            name: value.name,
            message: sanitizeProviderString(value.message),
            stack: value.stack ? sanitizeProviderString(value.stack) : undefined,
            cause: sanitizeProviderValue(value.cause, depth + 1),
        }
    }
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            result[key] = SENSITIVE_KEY.test(key)
                ? '[REDACTED]'
                : sanitizeProviderValue(item, depth + 1)
        }
        return result
    }
    return sanitizeProviderString(String(value))
}

type SponsorshipProvider = 'alchemy' | 'coingecko' | 'honeypot' | 'moralis'

export function logProviderResponse(
    provider: SponsorshipProvider,
    operation: string,
    response: unknown,
) {
    if (process.env.DEBUG_SPONSORSHIP_PROVIDER_RESPONSES !== 'true') return

    const record = {
        provider,
        operation,
        receivedAt: new Date().toISOString(),
        response: sanitizeProviderValue(response),
    }
    const serialized = JSON.stringify(record, null, 2)
    const printable = serialized.length > MAX_SERIALIZED_LENGTH
        ? `${serialized.slice(0, MAX_SERIALIZED_LENGTH)}\n...[TRUNCATED]`
        : serialized

    console.log(`[sponsorship-provider-response:${provider}]\n${printable}`)
}

export const providerResponseDebugInternals = {
    sanitizeProviderString,
    sanitizeProviderValue,
}
