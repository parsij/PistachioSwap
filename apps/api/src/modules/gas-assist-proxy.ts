import type {
    FastifyPluginAsync,
    FastifyReply,
    FastifyRequest,
} from 'fastify'

const INTERNAL_TOKEN_HEADER = 'x-pistachio-internal-token'
const DEFAULT_SERVICE_URL = 'http://127.0.0.1:3002'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const FORWARDED_RESPONSE_HEADERS = [
    'content-type',
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-request-id',
    'x-correlation-id',
] as const
const SAFE_PATH_SEGMENT = '[A-Za-z0-9_-]{1,160}'
const PUBLIC_PROXY_ROUTES = Object.freeze([
    ['GET', /^\/v1\/gas-assist\/config$/u],
    ['POST', /^\/v1\/gas-assist\/(?:price|quote|submit)$/u],
    ['GET', new RegExp(`^/v1/gas-assist/status/${SAFE_PATH_SEGMENT}$`, 'u')],
    ['GET', /^\/v1\/sponsorship\/config$/u],
    ['POST', /^\/v1\/sponsorship\/preview$/u],
    ['POST', /^\/v1\/sponsorship\/auth\/(?:challenge|verify)$/u],
    ['POST', /^\/v1\/sponsorship\/orders$/u],
    ['GET', new RegExp(`^/v1/sponsorship/orders/${SAFE_PATH_SEGMENT}$`, 'u')],
    ['POST', new RegExp(`^/v1/sponsorship/orders/${SAFE_PATH_SEGMENT}/(?:package/(?:prepare|submit)|payment/prepare|approval/prepare|continuation)$`, 'u')],
    ['POST', new RegExp(`^/v1/sponsorship/intents/${SAFE_PATH_SEGMENT}/submit$`, 'u')],
] as const)

type ProxyConfig = {
    baseUrl: URL
    internalToken: string
    timeoutMs: number
    maximumResponseBytes: number
}

export class PrivateGasAssistError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly statusCode: number,
        readonly details?: Record<string, unknown>,
    ) {
        super(message)
        this.name = 'PrivateGasAssistError'
    }
}

function readBoolean(name: string, fallback: boolean) {
    const value = process.env[name]?.trim().toLowerCase()
    if (!value) return fallback
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error(`${name} must be either true or false.`)
}

function readInteger(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const raw = process.env[name]?.trim()
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`)
    }
    return value
}

function readServiceUrl() {
    const value = process.env.GAS_ASSIST_SERVICE_URL?.trim() || DEFAULT_SERVICE_URL
    const url = new URL(value)
    const local = LOOPBACK_HOSTS.has(url.hostname)

    if (
        url.username ||
        url.password ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    ) {
        throw new Error(
            'GAS_ASSIST_SERVICE_URL must be HTTPS or a localhost HTTP URL without embedded credentials.',
        )
    }

    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.search = ''
    url.hash = ''
    return url
}

export function readGasAssistProxyConfig(): ProxyConfig | null {
    if (!readBoolean('GAS_ASSIST_SERVICE_ENABLED', false)) return null

    const internalToken = process.env.GAS_ASSIST_INTERNAL_TOKEN?.trim() ?? ''
    if (internalToken.length < 32) {
        throw new Error(
            'GAS_ASSIST_INTERNAL_TOKEN must contain at least 32 characters when the private service proxy is enabled.',
        )
    }

    return {
        baseUrl: readServiceUrl(),
        internalToken,
        timeoutMs: readInteger(
            'GAS_ASSIST_SERVICE_TIMEOUT_MS',
            DEFAULT_TIMEOUT_MS,
            1_000,
            60_000,
        ),
        maximumResponseBytes: readInteger(
            'GAS_ASSIST_SERVICE_MAX_RESPONSE_BYTES',
            DEFAULT_MAX_RESPONSE_BYTES,
            1_024,
            8 * 1024 * 1024,
        ),
    }
}

function publicPathname(pathname: string) {
    return pathname.startsWith('/api/v1/')
        ? pathname.slice('/api'.length)
        : pathname
}

export function isPublicGasAssistProxyRoute(method: string, pathname: string) {
    const normalizedMethod = method.toUpperCase()
    const normalizedPath = publicPathname(pathname)
    return PUBLIC_PROXY_ROUTES.some(([allowedMethod, pattern]) =>
        allowedMethod === normalizedMethod && pattern.test(normalizedPath))
}

function disabledResponse(pathname: string) {
    const normalizedPath = publicPathname(pathname)
    if (normalizedPath === '/v1/gas-assist/config') {
        return { enabled: false, mode: 'disabled' }
    }
    if (normalizedPath === '/v1/sponsorship/config') {
        return { enabled: false, chainId: 56 }
    }
    return null
}

function requestBody(request: FastifyRequest) {
    if (request.method === 'GET' || request.method === 'HEAD') return undefined
    if (request.body === undefined) return undefined
    return JSON.stringify(request.body)
}

function targetUrl(request: FastifyRequest, baseUrl: URL) {
    const rawUrl = request.raw.url || request.url
    const parsed = new URL(rawUrl, 'http://pistachio.local')
    const normalizedPath = publicPathname(parsed.pathname)
    const target = new URL(baseUrl)
    const basePath = target.pathname.replace(/\/+$/, '')
    target.pathname = `${basePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
    target.search = parsed.search
    return target
}

function proxyHeaders(request: FastifyRequest, config: ProxyConfig) {
    const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: config.internalToken,
        'x-pistachio-client-ip': request.ip,
        'x-pistachio-client-proto': request.protocol,
    })

    const authorization = request.headers.authorization
    if (typeof authorization === 'string') {
        headers.set('authorization', authorization)
    }

    const idempotencyKey = request.headers['idempotency-key']
    if (typeof idempotencyKey === 'string') {
        headers.set('idempotency-key', idempotencyKey)
    }

    return headers
}

async function readBoundedResponse(response: Response, maximumBytes: number) {
    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error('The private Gas Assist response exceeded the configured limit.')
    }

    if (!response.body) return Buffer.alloc(0)
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let totalBytes = 0

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            totalBytes += value.byteLength
            if (totalBytes > maximumBytes) {
                await reader.cancel().catch(() => undefined)
                throw new Error('The private Gas Assist response exceeded the configured limit.')
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        reader.releaseLock()
    }

    return Buffer.concat(chunks, totalBytes)
}

export async function requestPrivateGasAssist({
    pathname,
    body,
    clientIp,
    idempotencyKey,
}: {
    pathname: string
    body: unknown
    clientIp: string
    idempotencyKey: string
}) {
    if (!/^\/internal\/v1\/[a-z0-9_\-/]+$/u.test(pathname)) {
        throw new Error('Invalid private Gas Assist path.')
    }
    const config = readGasAssistProxyConfig()
    if (!config) {
        throw new PrivateGasAssistError(
            'GAS_ASSIST_DISABLED',
            'Gas Assist is unavailable.',
            503,
        )
    }
    const target = new URL(config.baseUrl)
    const basePath = target.pathname.replace(/\/+$/, '')
    target.pathname = `${basePath}${pathname}`.replace(/\/{2,}/g, '/')
    target.search = ''
    target.hash = ''
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    timeout.unref()
    try {
        const response = await fetch(target, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                [INTERNAL_TOKEN_HEADER]: config.internalToken,
                'x-pistachio-client-ip': clientIp,
                'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify(body),
            redirect: 'error',
            signal: controller.signal,
        })
        const bytes = await readBoundedResponse(
            response,
            config.maximumResponseBytes,
        )
        let payload: unknown = {}
        try {
            payload = bytes.length ? JSON.parse(bytes.toString('utf8')) : {}
        } catch {
            throw new PrivateGasAssistError(
                'GAS_ASSIST_INVALID_RESPONSE',
                'Gas Assist returned an invalid response.',
                502,
            )
        }
        if (!response.ok) {
            const error = payload && typeof payload === 'object' && 'error' in payload
                ? (payload as { error?: unknown }).error
                : null
            const record = error && typeof error === 'object'
                ? error as Record<string, unknown>
                : {}
            throw new PrivateGasAssistError(
                String(record.code ?? 'GAS_ASSIST_FAILED'),
                String(record.message ?? 'Gas Assist could not complete the request.'),
                response.status,
                record.details && typeof record.details === 'object'
                    ? record.details as Record<string, unknown>
                    : undefined,
            )
        }
        return payload
    } catch (error) {
        if (error instanceof PrivateGasAssistError) throw error
        throw new PrivateGasAssistError(
            'GAS_ASSIST_UNAVAILABLE',
            'Gas Assist is temporarily unavailable.',
            503,
        )
    } finally {
        clearTimeout(timeout)
    }
}

function applyResponseHeaders(response: Response, reply: FastifyReply) {
    for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = response.headers.get(name)
        if (value) reply.header(name, value)
    }
    reply.header('cache-control', 'private, no-store, max-age=0')
}

export async function proxyGasAssistRequest(
    request: FastifyRequest,
    reply: FastifyReply,
) {
    const pathname = new URL(
        request.raw.url || request.url,
        'http://pistachio.local',
    ).pathname

    if (!isPublicGasAssistProxyRoute(request.method, pathname)) {
        return reply.code(404).send({
            error: {
                code: 'GAS_ASSIST_ROUTE_NOT_EXPOSED',
                message: 'This Gas Assist route is not publicly exposed.',
            },
        })
    }

    const config = readGasAssistProxyConfig()
    if (!config) {
        const disabled = disabledResponse(pathname)
        if (disabled) return disabled
        return reply.code(503).send({
            error: {
                code: 'GAS_ASSIST_DISABLED',
                message: 'Gas Assist is unavailable.',
            },
        })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    timeout.unref()

    try {
        const response = await fetch(targetUrl(request, config.baseUrl), {
            method: request.method,
            headers: proxyHeaders(request, config),
            body: requestBody(request),
            redirect: 'error',
            signal: controller.signal,
        })
        const body = await readBoundedResponse(
            response,
            config.maximumResponseBytes,
        )
        applyResponseHeaders(response, reply)
        return reply.code(response.status).send(body)
    } catch (error) {
        request.log.error(
            {
                subsystem: 'gas-assist-proxy',
                err: error,
            },
            'Private Gas Assist request failed',
        )
        return reply.code(503).send({
            error: {
                code: 'GAS_ASSIST_UNAVAILABLE',
                message: 'Gas Assist is temporarily unavailable.',
            },
        })
    } finally {
        clearTimeout(timeout)
    }
}

export const gasAssistProxyRoutes: FastifyPluginAsync = async (app) => {
    app.route({
        method: ['GET', 'POST'],
        url: '/v1/gas-assist/*',
        handler: proxyGasAssistRequest,
    })
    app.route({
        method: ['GET', 'POST'],
        url: '/v1/sponsorship/*',
        handler: proxyGasAssistRequest,
    })
}

export const gasAssistProxyInternals = {
    PUBLIC_PROXY_ROUTES,
    publicPathname,
    readBoundedResponse,
}
