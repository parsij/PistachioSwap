import { getApiConfig } from '../../config.js'
import { fetchJson } from '../../lib/http.js'

export async function geckoTerminalRequest(
    path: string,
    signal?: AbortSignal,
    retries = 2,
) {
    const config = getApiConfig()
    const url = new URL(`${config.geckoTerminal.baseUrl}${path}`)
    return fetchJson(url, {
        headers: {
            accept: 'application/json;version=20230203',
        },
        signal,
        timeoutMs: config.requestTimeoutMs,
        retries,
        dedupeKey: `geckoterminal:${url.toString()}`,
    })
}
