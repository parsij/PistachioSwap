import { getApiConfig } from '../config.js'
import { GasAssistError } from './errors.js'

type RpcResponse = {
    result?: unknown
    error?: { code?: number; message?: string }
}

export type PrepaidPolicyScope = 'fee' | 'action'
type SponsorabilityMethod = 'pm_isSponsorable' | 'eth_isSponsorable'

type PaymasterConnection = {
    rpcUrl: string | null
    policyId: string | null
    userAgent: string
    requestTimeoutMs: number
    sponsorabilityMethods: readonly SponsorabilityMethod[]
}

function retryDelay(response: Response | null, attempt: number) {
    const retryAfter = response?.headers.get('retry-after')
    if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1_000
    return 250 * 2 ** attempt
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timeout)
            reject(signal?.reason)
        }
        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', abort)
            resolve()
        }, ms)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
    })
}

function prepaidRequestTimeoutMs(providerTimeoutMs: number) {
    const raw = process.env.MEGAFUEL_REQUEST_TIMEOUT_MS?.trim()
    if (!raw) return Math.max(providerTimeoutMs, 15_000)
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
        throw new Error('MEGAFUEL_REQUEST_TIMEOUT_MS must be an integer between 1000 and 60000.')
    }
    return value
}

function transportReason(error: unknown) {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`.slice(0, 240)
    }
    return String(error ?? 'unknown transport failure').slice(0, 240)
}

function legacyConnection(): PaymasterConnection {
    const config = getApiConfig().gasAssist
    return {
        rpcUrl: config.paymasterRpcUrl,
        policyId: config.paymasterPolicyId,
        userAgent: 'PistachioSwap/1.0',
        requestTimeoutMs: config.requestTimeoutMs,
        sponsorabilityMethods: ['pm_isSponsorable'],
    }
}

function prepaidConnection(scope: PrepaidPolicyScope): PaymasterConnection {
    const config = getApiConfig().sponsorship
    const baseUrl = config.privateRpcBaseUrl.replace(/\/+$/, '')
    return {
        rpcUrl: config.apiKey
            ? `${baseUrl}/${encodeURIComponent(config.apiKey)}/megafuel/56`
            : null,
        policyId: scope === 'fee'
            ? config.feePolicyUuid
            : config.actionPolicyUuid,
        userAgent: config.userAgent,
        requestTimeoutMs: prepaidRequestTimeoutMs(config.requestTimeoutMs),
        sponsorabilityMethods: ['eth_isSponsorable', 'pm_isSponsorable'],
    }
}

function parseSponsorableResult(result: unknown) {
    if (typeof result === 'boolean') return result
    if (result && typeof result === 'object') {
        const record = result as Record<string, unknown>
        for (const key of ['sponsorable', 'isSponsorable', 'sponsored', 'eligible']) {
            if (typeof record[key] === 'boolean') return record[key]
        }
    }
    return false
}

export function createPaymasterClient(
    fetcher: typeof fetch = fetch,
    getConnection: () => PaymasterConnection = legacyConnection,
) {
    async function rpc(method: string, params: unknown[], signal?: AbortSignal) {
        const connection = getConnection()
        if (!connection.rpcUrl || !connection.policyId) {
            throw new GasAssistError('PAYMASTER_NOT_CONFIGURED', 'The Gas Assist paymaster is not configured.', 503)
        }
        let lastStatus = 0
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const controller = new AbortController()
            let timedOut = false
            const timeout = setTimeout(() => {
                timedOut = true
                controller.abort()
            }, connection.requestTimeoutMs)
            const abort = () => controller.abort(signal?.reason)
            signal?.addEventListener('abort', abort, { once: true })
            try {
                const response = await fetcher(connection.rpcUrl, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-megafuel-policy-uuid': connection.policyId,
                        'user-agent': connection.userAgent,
                    },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                    signal: controller.signal,
                })
                lastStatus = response.status
                if (response.status === 429 || response.status >= 500) {
                    if (attempt < 2) {
                        await sleep(retryDelay(response, attempt), signal)
                        continue
                    }
                    throw new GasAssistError(
                        response.status === 429 ? 'PAYMASTER_RATE_LIMITED' : 'PAYMASTER_UNAVAILABLE',
                        response.status === 429
                            ? 'The paymaster rate limit was reached.'
                            : 'The paymaster is temporarily unavailable.',
                        response.status === 429 ? 429 : 502,
                        { rpcMethod: method, providerStatus: response.status, attempts: attempt + 1 },
                    )
                }
                const body = await response.json().catch(() => ({})) as RpcResponse
                if (!response.ok || body.error) {
                    throw new GasAssistError(
                        body.error?.code === -32601 ? 'PAYMASTER_METHOD_UNAVAILABLE' : 'PAYMASTER_REJECTED',
                        'The paymaster rejected the exact sponsored transaction.',
                        502,
                        body.error?.message
                            ? { rpcMethod: method, providerMessage: body.error.message }
                            : { rpcMethod: method },
                    )
                }
                return body.result
            } catch (error) {
                if (error instanceof GasAssistError) throw error
                const externallyAborted = signal?.aborted === true
                if (!externallyAborted && attempt < 2) {
                    await sleep(retryDelay(null, attempt), signal)
                    continue
                }
                throw new GasAssistError(
                    timedOut ? 'PAYMASTER_TIMEOUT' : 'PAYMASTER_UNAVAILABLE',
                    timedOut
                        ? 'The paymaster request timed out.'
                        : 'The paymaster request failed.',
                    timedOut ? 504 : 502,
                    {
                        rpcMethod: method,
                        attempts: attempt + 1,
                        requestTimeoutMs: connection.requestTimeoutMs,
                        transportReason: transportReason(error),
                    },
                )
            } finally {
                clearTimeout(timeout)
                signal?.removeEventListener('abort', abort)
            }
        }
        throw new GasAssistError('PAYMASTER_UNAVAILABLE', `The paymaster is temporarily unavailable (${lastStatus || 502}).`, 502)
    }

    return {
        async isSponsorable(transaction: Record<string, string>, signal?: AbortSignal) {
            const methods = getConnection().sponsorabilityMethods
            let lastMethodError: GasAssistError | null = null

            for (const [index, method] of methods.entries()) {
                try {
                    return parseSponsorableResult(await rpc(method, [transaction], signal))
                } catch (error) {
                    const mayTryNextMethod =
                        error instanceof GasAssistError &&
                        error.code === 'PAYMASTER_METHOD_UNAVAILABLE' &&
                        index < methods.length - 1

                    if (!mayTryNextMethod) throw error

                    lastMethodError = error
                    console.warn('[megafuel-sponsorability-method-fallback]', {
                        unavailableMethod: method,
                        fallbackMethod: methods[index + 1],
                    })
                }
            }

            throw lastMethodError ?? new GasAssistError(
                'PAYMASTER_METHOD_UNAVAILABLE',
                'The paymaster does not expose a supported sponsorability method.',
                502,
            )
        },
        async getNonce(walletAddress: `0x${string}`, signal?: AbortSignal) {
            const result = await rpc('eth_getTransactionCount', [walletAddress, 'pending'], signal)
            if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) {
                throw new GasAssistError('PAYMASTER_INVALID_RESPONSE', 'The paymaster returned an invalid nonce.', 502)
            }
            return BigInt(result)
        },
        async submit(signedTransaction: `0x${string}`, signal?: AbortSignal) {
            const result = await rpc('eth_sendRawTransaction', [signedTransaction], signal)
            if (typeof result !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(result)) {
                throw new GasAssistError('PAYMASTER_INVALID_RESPONSE', 'The paymaster returned an invalid transaction hash.', 502)
            }
            return result.toLowerCase() as `0x${string}`
        },
    }
}

export const paymasterClient = createPaymasterClient()
export const prepaidFeePaymasterClient = createPaymasterClient(
    fetch,
    () => prepaidConnection('fee'),
)
export const prepaidActionPaymasterClient = createPaymasterClient(
    fetch,
    () => prepaidConnection('action'),
)

export const paymasterInternals = {
    legacyConnection,
    prepaidConnection,
    prepaidRequestTimeoutMs,
    parseSponsorableResult,
}
