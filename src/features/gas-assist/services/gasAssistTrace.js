const REDACTED_KEYS = new Set([
    'authorization',
    'privateKey',
    'sessionToken',
    'signature',
    'signedRawTransaction',
    'signedTransactions',
    'rawTransaction',
])

function traceEnabled() {
    const viteEnabled = import.meta.env?.VITE_DEBUG_SPONSORSHIP_TRACE === 'true'
    const development = import.meta.env?.DEV === true
    let browserEnabled = false
    try {
        browserEnabled = globalThis.localStorage?.getItem('pistachio:debug-gas-assist') === 'true'
    } catch {
        browserEnabled = false
    }
    return viteEnabled || development || browserEnabled
}

function safeValue(value, depth = 0) {
    if (depth > 4) return '[truncated]'
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1))
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`
        return value
    }
    const result = {}
    for (const [key, item] of Object.entries(value)) {
        result[key] = REDACTED_KEYS.has(key) ? '[redacted]' : safeValue(item, depth + 1)
    }
    return result
}

export function gasAssistErrorDetails(error) {
    return {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        ...(error?.code ? { code: String(error.code) } : {}),
        ...(error?.status ? { status: Number(error.status) } : {}),
        ...(error?.requestId ? { requestId: String(error.requestId) } : {}),
        ...(error?.stage ? { stage: String(error.stage) } : {}),
        ...(error?.details ? { details: safeValue(error.details) } : {}),
        ...(traceEnabled() && error instanceof Error && error.stack
            ? { stack: error.stack.split('\n').slice(0, 12).join('\n') }
            : {}),
    }
}

export function gasAssistTrace(event, details = {}) {
    if (!traceEnabled()) return
    console.info('[gas-assist-trace]', {
        timestamp: new Date().toISOString(),
        event,
        ...safeValue(details),
    })
}

export function gasAssistTraceError(event, error, details = {}) {
    if (!traceEnabled()) return
    console.error('[gas-assist-trace-error]', {
        timestamp: new Date().toISOString(),
        event,
        ...safeValue(details),
        error: gasAssistErrorDetails(error),
    })
}

export async function gasAssistTraceStep(event, details, operation) {
    const startedAt = Date.now()
    gasAssistTrace(`${event}.start`, details)
    try {
        const result = await operation()
        gasAssistTrace(`${event}.success`, {
            ...details,
            elapsedMs: Date.now() - startedAt,
        })
        return result
    } catch (error) {
        gasAssistTraceError(`${event}.error`, error, {
            ...details,
            elapsedMs: Date.now() - startedAt,
        })
        throw error
    }
}

export const gasAssistTraceInternals = {
    safeValue,
    traceEnabled,
}
