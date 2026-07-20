import { getApiConfig } from '../config.js'
import { GasAssistError } from './errors.js'

type WhitelistType =
    | 'FromAccountWhitelist'
    | 'ToAccountWhitelist'
    | 'BEP20ReceiverWhiteList'
    | 'ContractMethodSigWhitelist'

type RpcResponse = {
    result?: unknown
    error?: { code?: number; message?: string }
}

function managementUrl() {
    const config = getApiConfig().sponsorship
    if (!config.apiKey || !config.privatePolicyUuid) {
        throw new GasAssistError(
            'PAYMASTER_NOT_CONFIGURED',
            'MegaFuel policy management is not configured.',
            503,
        )
    }
    return {
        url: `${config.privateRpcBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(config.apiKey)}/megafuel`,
        policyUuid: config.privatePolicyUuid,
        userAgent: config.userAgent,
        timeoutMs: config.requestTimeoutMs,
    }
}

async function rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal) {
    const connection = managementUrl()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), connection.timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
        const response = await fetch(connection.url, {
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
                'MegaFuel rejected the policy whitelist update.',
                response.status === 429 ? 429 : 502,
            )
        }
        return body.result
    } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
    }
}

function normalizeValues(values: string[]) {
    const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    if (unique.length === 0) {
        throw new GasAssistError('INVALID_REQUEST', 'At least one whitelist value is required.')
    }
    return unique
}

export const megaFuelPolicyManagement = {
    add(whitelistType: WhitelistType, values: string[], signal?: AbortSignal) {
        return rpc('pm_addToWhitelist', {
            whitelistType,
            values: normalizeValues(values),
        }, signal)
    },
    remove(whitelistType: WhitelistType, values: string[], signal?: AbortSignal) {
        return rpc('pm_rmFromWhitelist', {
            whitelistType,
            values: normalizeValues(values),
        }, signal)
    },
}
