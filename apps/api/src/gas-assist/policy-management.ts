import { getApiConfig } from '../config.js'
import { GasAssistError } from './errors.js'
import type { PrepaidPolicyScope } from './paymaster.js'

export type MegaFuelWhitelistType =
    | 'FromAccountWhitelist'
    | 'ToAccountWhitelist'
    | 'BEP20ReceiverWhiteList'
    | 'ContractMethodSigWhitelist'

type RpcResponse = {
    result?: unknown
    error?: { code?: number; message?: string }
}

function policyRequestTimeoutMs(providerTimeoutMs: number) {
    const raw = process.env.MEGAFUEL_REQUEST_TIMEOUT_MS?.trim()
    if (!raw) return Math.max(providerTimeoutMs, 15_000)
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
        throw new Error('MEGAFUEL_REQUEST_TIMEOUT_MS must be an integer between 1000 and 60000.')
    }
    return value
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

function transportReason(error: unknown) {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`.slice(0, 240)
    }
    return String(error ?? 'unknown transport failure').slice(0, 240)
}

function managementConnection(scope: PrepaidPolicyScope) {
    const config = getApiConfig().sponsorship
    const policyUuid = scope === 'fee'
        ? config.feePolicyUuid
        : config.actionPolicyUuid
    if (!config.apiKey || !policyUuid) {
        throw new GasAssistError(
            'PAYMASTER_NOT_CONFIGURED',
            `MegaFuel ${scope} policy management is not configured.`,
            503,
        )
    }
    return {
        url: `${config.privateRpcBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(config.apiKey)}/megafuel`,
        policyUuid,
        userAgent: config.userAgent,
        timeoutMs: policyRequestTimeoutMs(config.requestTimeoutMs),
    }
}

function normalizeValues(values: string[]) {
    const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    if (unique.length === 0) {
        throw new GasAssistError('INVALID_REQUEST', 'At least one whitelist value is required.')
    }
    return unique
}

export function createMegaFuelPolicyManagement(
    scope: PrepaidPolicyScope,
    fetcher: typeof fetch = fetch,
) {
    async function rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal) {
        const connection = managementConnection(scope)

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const controller = new AbortController()
            let timedOut = false
            const timeout = setTimeout(() => {
                timedOut = true
                controller.abort()
            }, connection.timeoutMs)
            const abort = () => controller.abort(signal?.reason)
            signal?.addEventListener('abort', abort, { once: true })

            try {
                const response = await fetcher(connection.url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'user-agent': connection.userAgent,
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method,
                        params: [{
                            policyUuid: connection.policyUuid,
                            ...params,
                        }],
                    }),
                    signal: controller.signal,
                })

                if (response.status === 429 || response.status >= 500) {
                    if (attempt < 2) {
                        await sleep(retryDelay(response, attempt), signal)
                        continue
                    }
                    throw new GasAssistError(
                        response.status === 429
                            ? 'PAYMASTER_POLICY_RATE_LIMITED'
                            : 'PAYMASTER_POLICY_UNAVAILABLE',
                        response.status === 429
                            ? `MegaFuel ${scope} policy management rate limit was reached.`
                            : `MegaFuel ${scope} policy management is temporarily unavailable.`,
                        response.status === 429 ? 429 : 502,
                        {
                            rpcMethod: method,
                            providerStatus: response.status,
                            attempts: attempt + 1,
                        },
                    )
                }

                const body = await response.json().catch(() => ({})) as RpcResponse
                if (!response.ok || body.error) {
                    throw new GasAssistError(
                        'PAYMASTER_POLICY_UPDATE_FAILED',
                        `MegaFuel rejected the ${scope} policy whitelist update.`,
                        502,
                        {
                            rpcMethod: method,
                            ...(body.error?.code !== undefined
                                ? { providerCode: body.error.code }
                                : {}),
                            ...(body.error?.message
                                ? { providerMessage: body.error.message }
                                : {}),
                        },
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
                    timedOut
                        ? 'PAYMASTER_POLICY_TIMEOUT'
                        : 'PAYMASTER_POLICY_UNAVAILABLE',
                    timedOut
                        ? `MegaFuel ${scope} policy management timed out.`
                        : `MegaFuel ${scope} policy management request failed.`,
                    timedOut ? 504 : 502,
                    {
                        rpcMethod: method,
                        attempts: attempt + 1,
                        requestTimeoutMs: connection.timeoutMs,
                        transportReason: transportReason(error),
                    },
                )
            } finally {
                clearTimeout(timeout)
                signal?.removeEventListener('abort', abort)
            }
        }

        throw new GasAssistError(
            'PAYMASTER_POLICY_UNAVAILABLE',
            `MegaFuel ${scope} policy management is temporarily unavailable.`,
            502,
            { rpcMethod: method },
        )
    }

    return {
        scope,
        add(whitelistType: MegaFuelWhitelistType, values: string[], signal?: AbortSignal) {
            return rpc('pm_addToWhitelist', {
                whitelistType,
                values: normalizeValues(values),
            }, signal)
        },
        remove(whitelistType: MegaFuelWhitelistType, values: string[], signal?: AbortSignal) {
            return rpc('pm_rmFromWhitelist', {
                whitelistType,
                values: normalizeValues(values),
            }, signal)
        },
    }
}

export const megaFuelFeePolicyManagement = createMegaFuelPolicyManagement('fee')
export const megaFuelActionPolicyManagement = createMegaFuelPolicyManagement('action')

export const policyManagementInternals = {
    managementConnection,
    policyRequestTimeoutMs,
}
