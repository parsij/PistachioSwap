import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { fetchJson } from '../../lib/http.js'
import { requireActiveTokenDiscoveryChain } from '../../token-discovery/registry.js'

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
    chainId = 56,
) {
    const config = getApiConfig()
    const chain = requireActiveTokenDiscoveryChain(chainId)
    if (!chain.capabilities.goPlus || !chain.providers.goPlusChainId) return []
    const unique = [...new Set(addresses
        .map(normalizeAddress)
        .filter((value): value is string => value !== null))]

    if (!config.goPlus.enabled || !config.goPlus.accessToken) return []

    return Promise.all(chunks(unique, config.goPlus.batchSize).map((batch) => {
        const url = new URL(`${config.goPlus.baseUrl}/token_security/${chain.providers.goPlusChainId}`)
        url.searchParams.set('contract_addresses', batch.join(','))
        return fetchJson(url, {
            headers: { authorization: `Bearer ${config.goPlus.accessToken}` },
            signal,
            timeoutMs: config.tokenSecurity.requestTimeoutMs,
            retries: 2,
            dedupeKey: `goplus:${chainId}:${batch.join(',')}`,
        })
    }))
}
