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

function providerError(
    status: number,
    payload: unknown,
    operation: 'price' | 'quote' | 'submit' | 'status',
) {
    const reason = isRecord(payload) && typeof payload.reason === 'string'
        ? payload.reason
        : isRecord(payload) && typeof payload.code === 'string'
            ? payload.code
            : null
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
            minimum ? { minimumSellAmount: minimum } : undefined,
        )
    }
    if (reason === 'INSUFFICIENT_BALANCE') {
        throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', 'The wallet token balance is insufficient.', 400)
    }
    if (reason === 'TOKEN_NOT_SUPPORTED') {
        throw new GasAssistError('TOKEN_NOT_ALLOWED', 'This token is not supported by 0x Gasless.', 400)
    }
    const errorByOperation = {
        price: 'ZEROX_QUOTE_FAILED',
        quote: 'ZEROX_QUOTE_FAILED',
        submit: 'ZEROX_SUBMIT_FAILED',
        status: 'STATUS_UNAVAILABLE',
    } as const
    const messageByOperation = {
        price: '0x could not provide a safe Gasless price.',
        quote: '0x could not provide a safe Gasless quote.',
        submit: '0x could not submit the Gas Assist trade.',
        status: '0x trade status is temporarily unavailable.',
    } as const
    throw new GasAssistError(
        errorByOperation[operation],
        status >= 500
            ? '0x Gasless is temporarily unavailable.'
            : messageByOperation[operation],
        status >= 500 ? 502 : 400,
    )
}

function query(request: GaslessRequest) {
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
        operation: 'price' | 'quote' | 'submit' | 'status',
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
                    const payload = await response.json().catch(() => null)
                    if (!response.ok) providerError(response.status, payload, operation)
                    if (!isRecord(payload)) {
                        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an invalid response.', 502)
                    }
                    return payload
                } catch (error) {
                    if (attempt + 1 >= attempts || controller.signal.aborted) throw error
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
            return request(`/gasless/price?${query(input)}`, { method: 'GET' }, true, 'price', signal)
        },
        getGaslessQuote(input: GaslessRequest, signal?: AbortSignal) {
            return request(`/gasless/quote?${query(input)}`, { method: 'GET' }, true, 'quote', signal)
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
