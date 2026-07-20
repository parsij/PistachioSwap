import type { LogoSource, TokenLogoEntry } from './token-logos.js'
import { setBoundedCacheEntry } from '../lib/bounded-cache.js'

const TRUSTED_IMAGE_HOSTS = new Set([
    'assets.coingecko.com',
    'cdn.dexscreener.com',
    'coin-images.coingecko.com',
    'images.coingecko.com',
    'raw.githubusercontent.com',
    'static.alchemyapi.io',
])
const TRUSTED_LOCAL_IMAGES = new Set([
    '/icons/bnb.svg',
    '/icons/tether-gold.png',
])
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 2
const MAX_CONCURRENCY = 4

type ValidationCacheEntry = {
    expiresAt: number
    valid: boolean
}

const validationCache = new Map<string, ValidationCacheEntry>()
const pendingValidations = new Map<string, Promise<boolean>>()
const waiters: Array<() => void> = []
let activeValidations = 0

async function acquireSlot() {
    if (activeValidations < MAX_CONCURRENCY) {
        activeValidations += 1
        return
    }

    await new Promise<void>((resolve) => waiters.push(resolve))
    activeValidations += 1
}

function releaseSlot() {
    activeValidations -= 1
    waiters.shift()?.()
}

function trustedRemoteUrl(value: string) {
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && TRUSTED_IMAGE_HOSTS.has(url.hostname)
            ? url
            : null
    } catch {
        return null
    }
}

function imageHeadersAreValid(response: Response) {
    const contentType = response.headers.get('content-type') ?? ''
    const contentLength = Number(response.headers.get('content-length'))

    return (
        response.ok &&
        contentType.toLowerCase().startsWith('image/') &&
        (!Number.isFinite(contentLength) ||
            contentLength <= MAX_RESPONSE_BYTES)
    )
}

async function requestWithRedirects(
    initialUrl: URL,
    method: 'HEAD' | 'GET',
    signal?: AbortSignal,
) {
    let url = initialUrl

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        const response = await fetch(url, {
            method,
            headers:
                method === 'GET'
                    ? { range: `bytes=0-${MAX_RESPONSE_BYTES - 1}` }
                    : undefined,
            redirect: 'manual',
            signal: signal
                ? AbortSignal.any([signal, timeoutSignal])
                : timeoutSignal,
        })

        if (response.status < 300 || response.status >= 400) {
            return response
        }

        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === MAX_REDIRECTS) return response

        const redirected = trustedRemoteUrl(new URL(location, url).toString())
        if (!redirected) return response
        url = redirected
    }

    throw new Error('Image redirect limit exceeded.')
}

async function validateRemoteImage(url: URL, signal?: AbortSignal) {
    const head = await requestWithRedirects(url, 'HEAD', signal)
    const headUnsupported = [400, 403, 405, 501].includes(head.status)

    if (!headUnsupported) {
        const valid = imageHeadersAreValid(head)
        await head.body?.cancel()
        return valid
    }

    await head.body?.cancel()
    const get = await requestWithRedirects(url, 'GET', signal)
    const valid = imageHeadersAreValid(get)
    await get.body?.cancel()
    return valid
}

export function validateRemoteLogoUrl(
    value: string,
    signal?: AbortSignal,
) {
    const url = trustedRemoteUrl(value)
    if (!url) return Promise.resolve(false)

    const cached = validationCache.get(url.toString())
    if (cached && cached.expiresAt > Date.now()) {
        return Promise.resolve(cached.valid)
    }

    const pending = pendingValidations.get(url.toString())
    if (pending) return pending

    const request = (async () => {
        await acquireSlot()
        try {
            let valid = false
            try {
                valid = await validateRemoteImage(url, signal)
            } catch {
                valid = false
            }
            setBoundedCacheEntry(validationCache, url.toString(), {
                valid,
                expiresAt:
                    Date.now() +
                    (valid ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
            }, 5_000)
            return valid
        } finally {
            releaseSlot()
        }
    })().finally(() => pendingValidations.delete(url.toString()))

    pendingValidations.set(url.toString(), request)
    return request
}

export async function validateTokenLogoEntries(
    entries: TokenLogoEntry[],
    signal?: AbortSignal,
): Promise<{
    logoURI: string
    logoCandidates: string[]
    logoSource: LogoSource
} | null> {
    for (const entry of entries) {
        const valid = entry.url.startsWith('/')
            ? ['curated', 'local'].includes(entry.source) &&
                TRUSTED_LOCAL_IMAGES.has(entry.url)
            : await validateRemoteLogoUrl(entry.url, signal)
        if (valid) {
            return {
                logoURI: entry.url,
                logoCandidates: [entry.url],
                logoSource: entry.source,
            }
        }
    }
    return null
}
