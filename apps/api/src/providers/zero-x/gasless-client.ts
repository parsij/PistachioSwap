import { getApiConfig } from '../../config.js'
import { GasAssistError } from '../../gas-assist/errors.js'
import { isRecord } from '../../lib/http.js'

export type GaslessRequest = {
    chainId: 56
    sellToken: string
    buyToken: string
    sellAmount: string
    taker: string
    recipient: string
    slippageBps?: number
    swapFeeRecipient?: string
    swapFeeBps?: number
    swapFeeToken?: string
}

type ClientOptions = {
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
}

type GaslessOperation = 'price' | 'quote' | 'submit' | 'status'

const SENSITIVE_FIELD = /(?:api.?key|authorization|headers?|credentials?|database(?:url)?|password|signature)$/i
const WALLET_SIGNATURE = /\b0x[0-9a-f]{130}\b/gi

function sanitizeText(value: string, apiKey: string | null) {
    let sanitized = value.replace(WALLET_SIGNATURE, '[REDACTED]')
    if (apiKey) sanitized = sanitized.replaceAll(apiKey, '[REDACTED]')
    return sanitized
        .replace(/(?:authorization|0x-api-key|x-api-key)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
        .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
}

function sanitizeBody(value: unknown, apiKey: string | null): unknown {
    if (typeof value === 'string') return sanitizeText(value, apiKey)
    if (Array.isArray(value)) return value.map((item) => sanitizeBody(item, apiKey))
    if (!isRecord(value)) return value
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !SENSITIVE_FIELD.test(key))
            .map(([key, item]) => [key, sanitizeBody(item, apiKey)]),
    )
}

function responseField(payload: unknown, field: 'code' | 'reason' | 'message') {
    if (!isRecord(payload)) return null
    const containers = [payload, payload.error, payload.data].filter(isRecord)
    for (const container of containers) {
        const value = container[field]
        if (typeof value === 'string' || typeof value === 'number') return String(value)
        if (field === 'message' && typeof container.error === 'string') return container.error
    }
    return null
}

async function responseBody(response: Response, apiKey: string | null) {
    const text = await response.text()
    if (!text) return null
    try {
        return sanitizeBody(JSON.parse(text), apiKey)
    } catch {
        return sanitizeText(text, apiKey)
    }
}

function providerDetails(status: number, statusText: string, payload: unknown) {
    const providerCode = responseField(payload, 'code')
    const providerReason = responseField(payload, 'reason')
    const providerMessage = typeof payload === 'string'
        ? payload
        : responseField(payload, 'message')
    return {
        httpStatus: status,
        ...(providerCode ? { providerCode } : {}),
        ...(providerReason ? { providerReason } : {}),
        ...(providerMessage || statusText ? { providerMessage: providerMessage || statusText } : {}),
    }
}

function logProviderResponse(
    operation: GaslessOperation,
    response: Response,
    body: unknown,
    failed: boolean,
) {
    if (process.env.NODE_ENV === 'production' || (operation !== 'price' && operation !== 'quote')) return
    if (failed) {
        console.error(`[0x Gasless ${operation} response]`, {
            status: response.status,
            statusText: response.statusText,
            body,
        })
        return
    }
    if (!isRecord(body)) return
    console.log(`[0x Gasless ${operation} success]`, {
        liquidityAvailable: body.liquidityAvailable,
        buyAmount: body.buyAmount,
        minBuyAmount: body.minBuyAmount,
        issues: body.issues,
        approvalAvailable: Boolean(body.approval),
        tradeAvailable: Boolean(body.trade),
        fees: body.fees,
    })
}

function providerError(
    status: number,
    statusText: string,
    payload: unknown,
    operation: GaslessOperation,
) {
    const reason = responseField(payload, 'reason') ?? responseField(payload, 'code')
    const details = isRecord(payload) && isRecord(payload.validationErrors)
        ? payload.validationErrors
        : null
    if (reason === 'SELL_AMOUNT_TOO_SMALL') {
        const minimum = details && typeof details.minimum === 'string'
            ? details.minimum
            : undefined
        throw new GasAssistError(
            'ZEROX_MINIMUM_NOT_MET',
            'The sell amount is below the current 0x Gasless minimum.',
            400,
            { ...providerDetails(status, statusText, payload), ...(minimum ? { minimumSellAmount: minimum } : {}) },
        )
    }
    if (reason === 'INSUFFICIENT_BALANCE') {
        throw new GasAssistError(
            'INSUFFICIENT_TOKEN_BALANCE',
            'The wallet token balance is insufficient.',
            400,
            providerDetails(status, statusText, payload),
        )
    }
    if (reason === 'TOKEN_NOT_SUPPORTED') {
        throw new GasAssistError(
            'TOKEN_NOT_ALLOWED',
            'This token is not supported by 0x Gasless.',
            400,
            providerDetails(status, statusText, payload),
        )
    }
    const errorByOperation = {
        price: 'ZEROX_QUOTE_FAILED',
        quote: 'ZEROX_QUOTE_FAILED',
        submit: 'ZEROX_SUBMIT_FAILED',
        status: 'STATUS_UNAVAILABLE',
    } as const
    const messageByOperation = {
        price: '0x could not provide a Gasless price.',
        quote: '0x could not provide a Gasless quote.',
        submit: '0x could not submit the Gas Assist trade.',
        status: '0x trade status is temporarily unavailable.',
    } as const
    throw new GasAssistError(
        errorByOperation[operation],
        status >= 500
            ? '0x Gasless is temporarily unavailable.'
            : messageByOperation[operation],
        status >= 500 ? 502 : 400,
        providerDetails(status, statusText, payload),
    )
}

function retryableGetError(error: unknown) {
    if (!(error instanceof GasAssistError)) return true
    const upstreamStatus = Number(error.details?.httpStatus)
    return upstreamStatus === 429 || upstreamStatus >= 500
}

export function buildGaslessQuery(request: GaslessRequest) {
    const values: Record<string, string> = {
        chainId: String(request.chainId),
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        sellAmount: request.sellAmount,
        taker: request.taker,
        recipient: request.recipient,
    }
    if (request.slippageBps !== undefined) values.slippageBps = String(request.slippageBps)
    if (request.swapFeeBps !== undefined && request.swapFeeBps > 0) {
        values.swapFeeBps = String(request.swapFeeBps)
        values.swapFeeRecipient = request.swapFeeRecipient!
        values.swapFeeToken = request.swapFeeToken!
    }
    return new URLSearchParams(values)
}

export function createZeroXGaslessClient(options: ClientOptions = {}) {
    const fetcher = options.fetch ?? globalThis.fetch

    async function request(
        path: string,
        init: RequestInit,
        retryGet: boolean,
        operation: GaslessOperation,
        signal?: AbortSignal,
    ) {
        const config = getApiConfig()
        const controller = new AbortController()
        const timeoutId = setTimeout(
            () => controller.abort(),
            options.timeoutMs ?? config.gasAssist.requestTimeoutMs,
        )
        const abort = () => controller.abort()
        signal?.addEventListener('abort', abort, { once: true })
        try {
            const attempts = retryGet ? 2 : 1
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                try {
                    const response = await fetcher(
                        `${config.quotes.zeroX.baseUrl}${path}`,
                        {
                            ...init,
                            headers: {
                                '0x-api-key': config.quotes.zeroX.apiKey!,
                                '0x-version': 'v2',
                                ...(init.body ? { 'content-type': 'application/json' } : {}),
                            },
                            signal: controller.signal,
                        },
                    )
                    const payload = await responseBody(response, config.quotes.zeroX.apiKey)
                    if (!response.ok) {
                        logProviderResponse(operation, response, payload, true)
                        providerError(response.status, response.statusText, payload, operation)
                    }
                    if (!isRecord(payload)) {
                        logProviderResponse(operation, response, payload, true)
                        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an invalid response.', 502)
                    }
                    const providerFailure = payload.liquidityAvailable === false ||
                        payload.validationErrors !== undefined || payload.reason !== undefined || payload.code !== undefined
                    logProviderResponse(operation, response, payload, providerFailure)
                    return payload
                } catch (error) {
                    if (
                        attempt + 1 >= attempts ||
                        controller.signal.aborted ||
                        !retryableGetError(error)
                    ) throw error
                }
            }
            throw new Error('unreachable')
        } catch (error) {
            if (controller.signal.aborted && !signal?.aborted) {
                throw new GasAssistError('STATUS_UNAVAILABLE', 'The 0x request timed out.', 504)
            }
            throw error
        } finally {
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abort)
        }
    }

    return {
        getGaslessPrice(input: GaslessRequest, signal?: AbortSignal) {
            return request(`/gasless/price?${buildGaslessQuery(input)}`, { method: 'GET' }, true, 'price', signal)
        },
        getGaslessQuote(input: GaslessRequest, signal?: AbortSignal) {
            return request(`/gasless/quote?${buildGaslessQuery(input)}`, { method: 'GET' }, true, 'quote', signal)
        },
        submitGaslessTrade(body: unknown, signal?: AbortSignal) {
            return request('/gasless/submit', {
                method: 'POST',
                body: JSON.stringify(body),
            }, false, 'submit', signal)
        },
        getGaslessStatus(tradeHash: string, signal?: AbortSignal) {
            return request(
                `/gasless/status/${encodeURIComponent(tradeHash)}?chainId=56`,
                { method: 'GET' },
                true,
                'status',
                signal,
            )
        },
    }
}

export const zeroXGaslessClient = createZeroXGaslessClient()
