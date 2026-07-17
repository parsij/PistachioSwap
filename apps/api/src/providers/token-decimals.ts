import { normalizeAddress } from '../lib/address.js'
import { fetchJson, isRecord } from '../lib/http.js'
import { getServerRpcUrl } from '../token-discovery/context.js'

type RpcResponse = {
    id: number
    result?: unknown
}

function parseResponse(value: unknown): RpcResponse | null {
    if (!isRecord(value) || !Number.isInteger(value.id)) return null
    return { id: Number(value.id), result: value.result }
}

function parseDecimals(value: unknown) {
    if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
        return null
    }

    try {
        const decimals = Number(BigInt(value))
        return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
            ? decimals
            : null
    } catch {
        return null
    }
}

export async function getTokenDecimalsBatch({
    chainId = 56,
    addresses,
    signal,
}: {
    chainId?: number
    addresses: string[]
    signal?: AbortSignal
}): Promise<Map<string, number | null>> {
    const unique = [
        ...new Set(
            addresses
                .map(normalizeAddress)
                .filter((value): value is string => value !== null),
        ),
    ]
    const result = new Map<string, number | null>(
        unique.map((address) => [address, null]),
    )
    const url = getServerRpcUrl(chainId)
    if (!url || unique.length === 0) return result

    const maximumBatchSize = 50
    for (let offset = 0; offset < unique.length; offset += maximumBatchSize) {
        const batch = unique.slice(offset, offset + maximumBatchSize)

        try {
            const payload = await fetchJson(url, {
                method: 'POST',
                body: batch.map((address, index) => ({
                    jsonrpc: '2.0',
                    id: index,
                    method: 'eth_call',
                    params: [
                        { to: address, data: '0x313ce567' },
                        'latest',
                    ],
                })),
                signal,
                timeoutMs: 10_000,
                retries: 1,
                dedupeKey: `token-decimals:${chainId}:${batch.join(',')}`,
            })
            const responses = new Map<number, RpcResponse>()

            for (const value of Array.isArray(payload) ? payload : [payload]) {
                const response = parseResponse(value)
                if (response) responses.set(response.id, response)
            }

            batch.forEach((address, index) => {
                result.set(
                    address,
                    parseDecimals(responses.get(index)?.result),
                )
            })
        } catch {
            // A batch outage leaves only these tokens without decimals.
        }
    }

    return result
}
