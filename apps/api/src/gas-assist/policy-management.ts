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
        timeoutMs: config.requestTimeoutMs,
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
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), connection.timeoutMs)
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
            const body = await response.json().catch(() => ({})) as RpcResponse
            if (!response.ok || body.error) {
                throw new GasAssistError(
                    'PAYMASTER_POLICY_UPDATE_FAILED',
                    `MegaFuel rejected the ${scope} policy whitelist update.`,
                    response.status === 429 ? 429 : 502,
                )
            }
            return body.result
        } finally {
            clearTimeout(timeout)
            signal?.removeEventListener('abort', abort)
        }
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
}
