import { getApiConfig } from '../../config.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson, isRecord } from '../../lib/http.js'

export type JsonRpcRequest = {
    id: string | number
    jsonrpc: '2.0'
    method: string
    params: unknown[]
}

export type JsonRpcResponse = {
    id: string | number | null
    jsonrpc?: string
    result?: unknown
    error?: {
        code?: number
        message?: string
    }
}

function getRpcUrl() {
    const url = getApiConfig().alchemy.rpcUrl

    if (!url) {
        throw new ProviderError({
            code: 'ALCHEMY_NOT_CONFIGURED',
            message: 'Alchemy is not configured.',
            statusCode: 503,
        })
    }

    return new URL(url)
}

function normalizeRpcResponse(
    value: unknown,
): JsonRpcResponse | null {
    if (!isRecord(value)) return null

    const id = value.id
    if (
        id !== null &&
        typeof id !== 'string' &&
        typeof id !== 'number'
    ) {
        return null
    }

    const response: JsonRpcResponse = { id }

    if ('result' in value) response.result = value.result

    if (isRecord(value.error)) {
        response.error = {
            code:
                typeof value.error.code === 'number'
                    ? value.error.code
                    : undefined,
            message:
                typeof value.error.message === 'string'
                    ? value.error.message
                    : undefined,
        }
    }

    return response
}

export async function alchemyRpc(
    request: JsonRpcRequest,
    signal?: AbortSignal,
): Promise<unknown> {
    const payload = await fetchJson(getRpcUrl(), {
        method: 'POST',
        body: request,
        signal,
        timeoutMs: getApiConfig().requestTimeoutMs,
        dedupeKey: `alchemy:${request.method}:${JSON.stringify(request.params)}`,
    })
    const response = normalizeRpcResponse(payload)

    if (!response || response.error || !('result' in response)) {
        throw new ProviderError({
            code: 'ALCHEMY_RPC_ERROR',
            message:
                response?.error?.message ||
                'Alchemy returned an invalid JSON-RPC response.',
        })
    }

    return response.result
}

export async function alchemyRpcBatch(
    requests: JsonRpcRequest[],
    signal?: AbortSignal,
): Promise<Map<string | number, JsonRpcResponse>> {
    const maximum = getApiConfig().alchemy.maxBatchSize

    if (requests.length < 1 || requests.length > maximum) {
        throw new ProviderError({
            code: 'ALCHEMY_BATCH_SIZE_INVALID',
            message: `Alchemy batch size must be between 1 and ${maximum}.`,
        })
    }

    const payload = await fetchJson(getRpcUrl(), {
        method: 'POST',
        body: requests,
        signal,
        timeoutMs: getApiConfig().requestTimeoutMs,
        dedupeKey: `alchemy:batch:${JSON.stringify(requests)}`,
    })

    if (!Array.isArray(payload)) {
        throw new ProviderError({
            code: 'ALCHEMY_BATCH_RESPONSE_INVALID',
            message: 'Alchemy returned an invalid JSON-RPC batch response.',
        })
    }

    const responses = new Map<string | number, JsonRpcResponse>()

    for (const value of payload) {
        const response = normalizeRpcResponse(value)

        if (response && response.id !== null) {
            responses.set(response.id, response)
        }
    }

    return responses
}
