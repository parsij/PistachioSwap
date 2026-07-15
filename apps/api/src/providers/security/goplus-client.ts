import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { fetchJson } from '../../lib/http.js'

function chunks<T>(values: T[], size: number) {
    const output: T[][] = []
    for (let index = 0; index < values.length; index += size) {
        output.push(values.slice(index, index + size))
    }
    return output
}

export async function goPlusTokenSecurityRequests(
    addresses: string[],
    signal?: AbortSignal,
) {
    const config = getApiConfig()
    const unique = [...new Set(addresses
        .map(normalizeAddress)
        .filter((value): value is string => value !== null))]

    if (!config.goPlus.enabled || !config.goPlus.accessToken) return []

    return Promise.all(chunks(unique, config.goPlus.batchSize).map((batch) => {
        const url = new URL(`${config.goPlus.baseUrl}/token_security/56`)
        url.searchParams.set('contract_addresses', batch.join(','))
        return fetchJson(url, {
            headers: { authorization: `Bearer ${config.goPlus.accessToken}` },
            signal,
            timeoutMs: config.tokenSecurity.requestTimeoutMs,
            retries: 2,
            dedupeKey: `goplus:56:${batch.join(',')}`,
        })
    }))
}
