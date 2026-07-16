import { getApiConfig } from '../config.js'
import { GasAssistError } from './errors.js'

type RpcResponse = {
    result?: unknown
    error?: { code?: number; message?: string }
}

type PrivatePolicyConnection = {
    rpcUrl: string | null
    policyId: string | null
    userAgent: string
    requestTimeoutMs: number
}

function retryDelay(response: Response, attempt: number) {
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1_000
    return 250 * 2 ** attempt
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, ms)
        signal?.addEventListener('abort', () => {
            clearTimeout(timeout)
            reject(signal.reason)
        }, { once: true })
    })
}

function legacyConnection(): PrivatePolicyConnection {
    const config = getApiConfig().gasAssist
    return {
        rpcUrl: config.paymasterRpcUrl,
        policyId: config.paymasterPolicyId,
        userAgent: 'PistachioSwap/1.0',
        requestTimeoutMs: config.requestTimeoutMs,
    }
}

function prepaidConnection(): PrivatePolicyConnection {
    const config = getApiConfig().sponsorship
    return {
        rpcUrl: config.apiKey
            ? `${config.privateRpcBaseUrl}/${encodeURIComponent(config.apiKey)}/bsc-mainnet/megafuel`
            : null,
        policyId: config.privatePolicyUuid,
        userAgent: config.userAgent,
        requestTimeoutMs: config.requestTimeoutMs,
    }
}

export function createPaymasterClient(
    fetcher: typeof fetch = fetch,
    getConnection: () => PrivatePolicyConnection = legacyConnection,
) {
    async function rpc(method: string, params: unknown[], signal?: AbortSignal) {
        const connection = getConnection()
        if (!connection.rpcUrl || !connection.policyId) {
            throw new GasAssistError('PAYMASTER_NOT_CONFIGURED', 'The Gas Assist paymaster is not configured.', 503)
        }
        let lastStatus = 0
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), connection.requestTimeoutMs)
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
                if ((response.status === 429 || response.status >= 500) && attempt < 2) {
                    await sleep(retryDelay(response, attempt), signal)
                    continue
                }
                const body = await response.json().catch(() => ({})) as RpcResponse
                if (!response.ok || body.error) {
                    throw new GasAssistError(
                        body.error?.code === -32601 ? 'PAYMASTER_METHOD_UNAVAILABLE' : 'PAYMASTER_REJECTED',
                        'The paymaster rejected the exact sponsored approval.',
                        response.status === 429 ? 429 : 502,
                    )
                }
                return body.result
            } finally {
                clearTimeout(timeout)
                signal?.removeEventListener('abort', abort)
            }
        }
        throw new GasAssistError('PAYMASTER_UNAVAILABLE', `The paymaster is temporarily unavailable (${lastStatus || 502}).`, 502)
    }

    return {
        async isSponsorable(transaction: Record<string, string>, signal?: AbortSignal) {
            const result = await rpc('pm_isSponsorable', [transaction], signal)
            if (typeof result === 'boolean') return result
            if (result && typeof result === 'object') {
                const record = result as Record<string, unknown>
                for (const key of ['sponsorable', 'isSponsorable', 'sponsored', 'eligible']) {
                    if (typeof record[key] === 'boolean') return record[key]
                }
            }
            return false
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
export const prepaidPaymasterClient = createPaymasterClient(fetch, prepaidConnection)

export const paymasterInternals = {
    prepaidConnection,
}
