import { GasAssistError } from './errors.js'

type TraceDetails = Record<string, unknown>

type ErrorLike = {
    name?: unknown
    message?: unknown
    code?: unknown
    constraint?: unknown
    detail?: unknown
    table?: unknown
    column?: unknown
    schema?: unknown
    stack?: unknown
}

const REDACTED_KEYS = new Set([
    'authorization',
    'apikey',
    'apiKey',
    'privateKey',
    'sessionToken',
    'signature',
    'signedRawTransaction',
    'signedTransactions',
    'rawTransaction',
])

function traceEnabled() {
    return process.env.DEBUG_SPONSORSHIP_TRACE === 'true'
}

function safeValue(value: unknown, depth = 0): unknown {
    if (depth > 3) return '[truncated]'
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1))
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`
        return value
    }
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        result[key] = REDACTED_KEYS.has(key) ? '[redacted]' : safeValue(item, depth + 1)
    }
    return result
}

export function sponsorshipErrorDetails(error: unknown) {
    const value = (error && typeof error === 'object' ? error : {}) as ErrorLike
    return {
        name: error instanceof Error ? error.name : String(value.name ?? typeof error),
        message: error instanceof Error ? error.message : String(value.message ?? error),
        ...(error instanceof GasAssistError ? {
            gasAssistCode: error.code,
            statusCode: error.statusCode,
            details: safeValue(error.details),
        } : {}),
        ...(typeof value.code === 'string' ? { postgresCode: value.code } : {}),
        ...(typeof value.constraint === 'string' ? { constraint: value.constraint } : {}),
        ...(typeof value.table === 'string' ? { table: value.table } : {}),
        ...(typeof value.column === 'string' ? { column: value.column } : {}),
        ...(typeof value.schema === 'string' ? { schema: value.schema } : {}),
        ...(typeof value.detail === 'string' ? { databaseDetail: value.detail.slice(0, 500) } : {}),
        ...(traceEnabled() && error instanceof Error && error.stack
            ? { stack: error.stack.split('\n').slice(0, 12).join('\n') }
            : {}),
    }
}

export function sponsorshipTrace(event: string, details: TraceDetails = {}) {
    if (!traceEnabled()) return
    console.error('[sponsorship-trace]', {
        timestamp: new Date().toISOString(),
        event,
        ...safeValue(details) as TraceDetails,
    })
}

export function sponsorshipTraceError(
    event: string,
    error: unknown,
    details: TraceDetails = {},
) {
    if (!traceEnabled()) return
    console.error('[sponsorship-trace-error]', {
        timestamp: new Date().toISOString(),
        event,
        ...safeValue(details) as TraceDetails,
        error: sponsorshipErrorDetails(error),
    })
}

export async function sponsorshipTraceStep<T>(
    event: string,
    details: TraceDetails,
    operation: () => Promise<T>,
): Promise<T> {
    const startedAt = Date.now()
    sponsorshipTrace(`${event}.start`, details)
    try {
        const result = await operation()
        sponsorshipTrace(`${event}.success`, {
            ...details,
            elapsedMs: Date.now() - startedAt,
        })
        return result
    } catch (error) {
        sponsorshipTraceError(`${event}.error`, error, {
            ...details,
            elapsedMs: Date.now() - startedAt,
        })
        throw error
    }
}

export const sponsorshipTraceInternals = {
    safeValue,
    traceEnabled,
}
