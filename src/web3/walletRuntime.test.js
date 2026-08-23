import { afterEach, describe, expect, it } from 'vitest'

import {
    BOT_USER_AGENT_NAMES,
    isBotUserAgent,
    shouldServeLandingHtml,
} from './botUserAgent.js'
import {
    API_NO_STORE,
    ASSET_CACHE_CONTROL,
    cacheControlForPath,
    HTML_NO_STORE,
    ICON_CACHE_CONTROL,
} from './originCacheHeaders.js'
import { resolveModulePreloadDependencies } from './walletChunkPreload.js'
import {
    ensureWalletRuntime,
    getWalletRuntimeStatus,
    registerWalletRuntimeLoader,
    resetWalletRuntime,
    warmWalletRuntime,
} from './walletRuntime.js'

describe('crawler detection', () => {
    it('sends Google and assistants to landing HTML at /', () => {
        expect(isBotUserAgent('Mozilla/5.0 Googlebot/2.1')).toBe(true)
        expect(isBotUserAgent('ChatGPT-User/1.0')).toBe(true)
        expect(isBotUserAgent('Mozilla/5.0 Chrome/120')).toBe(false)
        expect(shouldServeLandingHtml({
            userAgent: 'Googlebot',
            pathname: '/',
        })).toBe(true)
        expect(shouldServeLandingHtml({
            userAgent: 'Googlebot',
            pathname: '/landing/',
        })).toBe(false)
        expect(shouldServeLandingHtml({
            userAgent: 'Mozilla/5.0 Chrome/120',
            pathname: '/',
        })).toBe(false)
    })
})

describe('origin cache headers', () => {
    it('caches hashed assets for a year and icons for a week', () => {
        expect(cacheControlForPath('/assets/main-abc123.js')).toBe(ASSET_CACHE_CONTROL)
        expect(cacheControlForPath('/assets/appkit-bbb.js')).toBe(ASSET_CACHE_CONTROL)
        expect(ASSET_CACHE_CONTROL).toContain('max-age=31536000')
        expect(ASSET_CACHE_CONTROL).toContain('immutable')
        expect(cacheControlForPath('/favicon.svg')).toBe(ICON_CACHE_CONTROL)
        expect(cacheControlForPath('/icons/PistachioLogo.svg')).toBe(ICON_CACHE_CONTROL)
        expect(ICON_CACHE_CONTROL).toContain('max-age=604800')
    })

    it('does not cache the app shell or live API', () => {
        expect(cacheControlForPath('/')).toBe(HTML_NO_STORE)
        expect(cacheControlForPath('/index.html')).toBe(HTML_NO_STORE)
        expect(cacheControlForPath('/landing/')).toBe(HTML_NO_STORE)
        expect(cacheControlForPath('/gas-assist/')).toBe(HTML_NO_STORE)
        expect(cacheControlForPath('/api/v1/token-catalog')).toBe(API_NO_STORE)
    })
})

describe('wallet chunk preload', () => {
    it('does not preload AppKit or Wagmi on first visit', () => {
        expect(resolveModulePreloadDependencies('index.html', [
            'assets/main-aaa.js',
            'assets/appkit-bbb.js',
            'assets/wagmi-ccc.js',
            'assets/motion-ddd.js',
        ])).toEqual([
            'assets/main-aaa.js',
            'assets/motion-ddd.js',
        ])
    })
})

describe('wallet runtime loader', () => {
    afterEach(() => {
        resetWalletRuntime()
    })

    it('loads the runtime only when Connect asks for it', async () => {
        let loaded = false
        registerWalletRuntimeLoader(async () => {
            loaded = true
            const { patchWalletRuntime } = await import('./walletRuntime.js')
            patchWalletRuntime({
                ready: true,
                open: async () => 'opened',
            })
        })
        expect(loaded).toBe(false)
        await ensureWalletRuntime()
        expect(loaded).toBe(true)
    })

    it('marks connecting UI while a requested load is in flight', async () => {
        let resolveLoader
        registerWalletRuntimeLoader(() => new Promise((resolve) => {
            resolveLoader = resolve
        }))

        const pending = ensureWalletRuntime({ visible: true })
        expect(getWalletRuntimeStatus()).toMatchObject({ loading: true, visible: true })
        const { patchWalletRuntime } = await import('./walletRuntime.js')
        patchWalletRuntime({ ready: true, open: async () => {} })
        resolveLoader()
        await pending
        expect(getWalletRuntimeStatus()).toMatchObject({ ready: true, loading: false, visible: false })
    })

    it('warms the runtime without a connecting indicator', async () => {
        const { warmWalletRuntime, getWalletRuntimeStatus } = await import('./walletRuntime.js')
        let resolveLoader
        registerWalletRuntimeLoader(() => new Promise((resolve) => {
            resolveLoader = resolve
        }))

        const pending = warmWalletRuntime()
        expect(getWalletRuntimeStatus()).toMatchObject({ loading: true, visible: false })
        const { patchWalletRuntime } = await import('./walletRuntime.js')
        patchWalletRuntime({ ready: true, open: async () => {} })
        resolveLoader()
        await pending
        expect(getWalletRuntimeStatus().ready).toBe(true)
    })
})

describe('edge configs stay aligned', () => {
    it('lists the same crawlers in nginx and the Cloudflare worker', async () => {
        const { readFileSync } = await import('node:fs')
        const nginx = readFileSync('deploy/nginx-origin-cache.conf', 'utf8')
        const worker = readFileSync('deploy/cloudflare-cache-and-crawlers.js', 'utf8')

        for (const name of BOT_USER_AGENT_NAMES) {
            expect(nginx).toContain(name)
            expect(worker).toContain(name)
        }
        expect(nginx).toContain('max-age=31536000')
        expect(nginx).toContain('immutable')
        expect(nginx).toContain('max-age=604800')
        expect(nginx).toContain('no-store')
        expect(worker).toContain('max-age=31536000')
        expect(worker).toContain('/landing/')
        expect(nginx).toContain('/gas-assist/')
        expect(worker).toContain('/gas-assist/')
    })
})
