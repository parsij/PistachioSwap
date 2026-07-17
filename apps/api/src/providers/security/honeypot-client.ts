import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { ProviderError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'
import { getTokenDiscoveryChain } from '../../token-discovery/registry.js'

const pending = new Map<string, Promise<unknown>>()
let activeRequests = 0
const waiters: Array<() => void> = []

async function acquire(limit: number, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason
    if (activeRequests < limit) {
        activeRequests += 1
        return
    }

    await new Promise<void>((resolve, reject) => {
        const start = () => {
            signal?.removeEventListener('abort', abort)
            activeRequests += 1
            resolve()
        }
        const abort = () => {
            const index = waiters.indexOf(start)
            if (index >= 0) waiters.splice(index, 1)
            reject(signal?.reason)
        }
        waiters.push(start)
        signal?.addEventListener('abort', abort, { once: true })
    })
}

function release() {
    activeRequests -= 1
    waiters.shift()?.()
}

export async function honeypotRequest({
    chainId,
    address,
    signal,
}: {
    chainId: number
    address: string
    signal?: AbortSignal
}) {
    const normalized = normalizeAddress(address)
    const config = getApiConfig()
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active || !chain.capabilities.honeypot) {
        throw new ProviderError({
            code: 'HONEYPOT_UNSUPPORTED_CHAIN',
            message: 'Honeypot analysis is unavailable for this chain.',
            statusCode: 400,
            outcome: 'validation',
        })
    }
    if (!normalized) {
        throw new ProviderError({
            code: 'HONEYPOT_INVALID_ADDRESS',
            message: 'A valid token contract address is required.',
            statusCode: 400,
            outcome: 'validation',
        })
    }
    if (!config.honeypot.enabled) return null

    const key = `${chainId}:${normalized}`
    const existing = pending.get(key)
    if (existing) return existing

    const request = (async () => {
        await acquire(config.tokenSecurity.concurrency, signal)
        try {
            const url = new URL('/v2/IsHoneypot', config.honeypot.baseUrl)
            url.searchParams.set('address', normalized)
            url.searchParams.set('chainID', String(chainId))
            return await fetchJson(url, {
                headers: config.honeypot.apiKey
                    ? { 'X-API-KEY': config.honeypot.apiKey }
                    : undefined,
                signal,
                timeoutMs: config.tokenSecurity.requestTimeoutMs,
                retries: 2,
            })
        } finally {
            release()
        }
    })()
    pending.set(key, request)
    try {
        return await request
    } finally {
        if (pending.get(key) === request) pending.delete(key)
    }
}

export function getActiveHoneypotRequestCountForTest() {
    return activeRequests
}
