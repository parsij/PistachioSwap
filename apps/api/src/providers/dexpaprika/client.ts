import { getApiConfig } from '../../config.js'
import { fetchJson } from '../../lib/http.js'

export function dexPaprikaRequest(path: string, params: URLSearchParams, signal?: AbortSignal) {
    const config = getApiConfig().dexPaprika
    const url = new URL(path, `${config.baseUrl}/`)
    url.search = params.toString()
    return fetchJson(url, {
        signal,
        timeoutMs: config.timeoutMs,
        retries: 0,
        dedupeKey: `dexpaprika:${url.pathname}:${url.search}`,
    })
}

export function fetchDexPaprikaNetworks(signal?: AbortSignal) {
    return dexPaprikaRequest('networks', new URLSearchParams(), signal)
}
