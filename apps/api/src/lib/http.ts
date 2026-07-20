import { ProviderError } from './errors.js'

type FetchJsonOptions = {
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: unknown
    signal?: AbortSignal
    timeoutMs?: number
    retries?: number
    dedupeKey?: string
    notFoundAsNull?: boolean
}

const pendingRequests = new Map<string, Promise<unknown>>()
const MAX_PROVIDER_MESSAGE_LENGTH = 240
const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024

export async function readResponseTextLimited(
    response: Response,
    maximumBytes = MAX_PROVIDER_RESPONSE_BYTES,
) {
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProviderError({
            code: 'PROVIDER_RESPONSE_TOO_LARGE',
            message: 'Provider response exceeded the allowed size.',
        })
    }
    if (!response.body) return ''

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value.byteLength
            if (totalBytes > maximumBytes) {
                await reader.cancel().catch(() => undefined)
                throw new ProviderError({
                    code: 'PROVIDER_RESPONSE_TOO_LARGE',
                    message: 'Provider response exceeded the allowed size.',
                })
            }
            chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }

    const combined = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(combined)
}

async function responseJson(response: Response) {
    const text = await readResponseTextLimited(response)
    return JSON.parse(text)
}

function truncateMessage(value: string) {
    return value.replace(/\s+/g, ' ').trim().slice(0, MAX_PROVIDER_MESSAGE_LENGTH)
}

function providerMessage(value: unknown, status: number) {
    if (!isRecord(value)) {
        return `Provider rejected the request with status ${status}.`
    }

    const base = [value.message, value.reason, value.error]
        .find((item) => typeof item === 'string')
    const details = isRecord(value.data) && Array.isArray(value.data.details)
        ? value.data.details
        : Array.isArray(value.details)
          ? value.details
          : []
    const fields = details
        .filter(isRecord)
        .slice(0, 4)
        .map((detail) => {
            const field = typeof detail.field === 'string'
                ? detail.field.slice(0, 64)
                : 'request'
            const reason = typeof detail.reason === 'string'
                ? detail.reason
                : typeof detail.message === 'string'
                  ? detail.message
                  : ''
            return reason ? `${field}: ${reason}` : ''
        })
        .filter(Boolean)

    return truncateMessage(
        [typeof base === 'string' ? base : '', ...fields]
            .filter(Boolean)
            .join(' - ') ||
            `Provider rejected the request with status ${status}.`,
    )
}

function errorCode(value: unknown, fallback: string) {
    if (!isRecord(value)) return fallback
    const candidate = [value.code, value.reason]
        .find((item) => typeof item === 'string')
    return typeof candidate === 'string'
        ? truncateMessage(candidate).slice(0, 80)
        : fallback
}

function looksLikeNoRoute(value: unknown) {
    if (!isRecord(value)) return false
    const message = [value.code, value.reason, value.message, value.error]
        .filter((item): item is string => typeof item === 'string')
        .join(' ')
        .toLowerCase()
    return /no (quote|route)|insufficient liquidity|liquidity unavailable/.test(message)
}

function sleep(milliseconds: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, milliseconds)

        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout)
                reject(signal.reason)
            },
            { once: true },
        )
    })
}

function createSignal(
    timeoutMs: number,
    signal?: AbortSignal,
) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)

    return signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal
}

async function executeFetchJson(
    url: URL,
    options: FetchJsonOptions,
): Promise<unknown> {
    const retries = options.retries ?? 2
    let lastError: unknown

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetch(url, {
                method: options.method ?? 'GET',
                headers: {
                    accept: 'application/json',
                    ...(options.body === undefined
                        ? {}
                        : { 'content-type': 'application/json' }),
                    ...options.headers,
                },
                body:
                    options.body === undefined
                        ? undefined
                        : JSON.stringify(options.body),
                signal: createSignal(
                    options.timeoutMs ?? 10_000,
                    options.signal,
                ),
            })

            if (response.ok) {
                try {
                    return await responseJson(response)
                } catch (error) {
                    if (error instanceof ProviderError) throw error
                    throw new ProviderError({
                        code: 'PROVIDER_RESPONSE_INVALID',
                        message: 'Provider returned malformed JSON.',
                        cause: error,
                    })
                }
            }

            if (response.status === 404 && options.notFoundAsNull) {
                return null
            }

            const contentType = response.headers.get('content-type') ?? ''
            const payload = contentType.toLowerCase().includes('application/json')
                ? await responseJson(response).catch((error) => {
                      if (error instanceof ProviderError) throw error
                      return null
                  })
                : null

            const retryable =
                response.status === 429 || response.status >= 500

            if (!retryable) {
                const noRoute = looksLikeNoRoute(payload)
                const authentication = response.status === 401 || response.status === 403
                throw new ProviderError({
                    code: errorCode(
                        payload,
                        noRoute
                            ? 'PROVIDER_NO_ROUTE'
                            : authentication
                              ? 'PROVIDER_AUTHENTICATION_FAILED'
                              : 'PROVIDER_VALIDATION_FAILED',
                    ),
                    message: providerMessage(payload, response.status),
                    statusCode: 502,
                    outcome: noRoute
                        ? 'no-route'
                        : authentication
                          ? 'authentication'
                          : 'validation',
                    upstreamStatus: response.status,
                })
            }

            const retryAfterSeconds = Number(response.headers.get('retry-after'))
            const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                ? retryAfterSeconds * 1000
                : 0
            lastError = new ProviderError({
                code:
                    response.status === 429
                        ? 'PROVIDER_RATE_LIMITED'
                        : 'PROVIDER_TEMPORARILY_UNAVAILABLE',
                message:
                    response.status === 429
                        ? 'Provider rate limit was reached.'
                        : providerMessage(payload, response.status),
                retryable: true,
                outcome: response.status === 429 ? 'rate-limit' : 'upstream',
                upstreamStatus: response.status,
                retryAfterMs,
            })

            if (attempt < retries) {
                const delay =
                    retryAfterMs > 0
                        ? Math.min(retryAfterMs, 10_000)
                        : 350 * 2 ** attempt

                await sleep(delay, options.signal)
            }
        } catch (error) {
            if (
                error instanceof ProviderError &&
                !error.retryable
            ) {
                throw error
            }

            if (options.signal?.aborted) {
                throw new ProviderError({
                    code: 'PROVIDER_REQUEST_ABORTED',
                    message: 'Provider request was aborted.',
                    outcome:
                        options.signal.reason?.name === 'TimeoutError'
                            ? 'timeout'
                            : 'upstream',
                    cause: options.signal.reason,
                })
            }

            lastError = error

            if (attempt < retries) {
                await sleep(350 * 2 ** attempt, options.signal)
            }
        }
    }

    throw new ProviderError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Provider request failed after bounded retries.',
        retryable: true,
        outcome:
            lastError instanceof ProviderError
                ? lastError.outcome
                : 'upstream',
        upstreamStatus:
            lastError instanceof ProviderError
                ? lastError.upstreamStatus
                : null,
        cause: lastError,
    })
}

export async function fetchJson(
    url: URL,
    options: FetchJsonOptions = {},
): Promise<unknown> {
    const key = options.dedupeKey

    if (key) {
        const pending = pendingRequests.get(key)

        if (pending) {
            return pending
        }
    }

    const request = executeFetchJson(url, options)

    if (key) {
        pendingRequests.set(key, request)
    }

    try {
        return await request
    } finally {
        if (key && pendingRequests.get(key) === request) {
            pendingRequests.delete(key)
        }
    }
}

export function isRecord(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    )
}

export function toFiniteNumber(value: unknown): number {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : 0
}

export function validateRemoteImageUrl(
    value: unknown,
): string | null {
    if (typeof value !== 'string') {
        return null
    }

    try {
        const url = new URL(value)
        return url.protocol === 'https:' ? url.toString() : null
    } catch {
        return null
    }
}
