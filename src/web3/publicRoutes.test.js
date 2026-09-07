import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../deploy/cloudflare-cache-and-crawlers.js'
import { publicRouteRedirect } from './publicRoutes.js'
import { createPublicRoutesMiddleware } from './publicRoutesMiddleware.js'
import { resolvePistachioRpId } from '../features/passkey/services/passkeyCapabilities.js'

const ORIGIN = 'https://pistachioswap.com'
const moved = [
    ['/landing', '/'],
    ['/landing/', '/'],
    ['/landing/index.html', '/'],
    ['/index.html', '/'],
    ['/swap', '/swap/'],
    ['/swap/index.html', '/swap/'],
    ['/landing/?utm_source=profile', '/?utm_source=profile'],
    ['/swap?route=public%2Froute&ref=site', '/swap/?route=public%2Froute&ref=site'],
    ['/?route=public%2Froute&ref=site', '/swap/?route=public%2Froute&ref=site'],
    ['/index.html?route=public-route', '/swap/?route=public-route'],
]
const unchanged = [
    '/', '/?utm_source=profile', '/?route=', '/swap/', '/swap/?route=public-route',
    '/landing/wallet/', '/landing/gas-assist/', '/landing/how-it-works/',
    '/landing/faq/', '/landing/missing/', '/gas-assist/', '/api/v1/quote', '/health',
]
afterEach(() => vi.unstubAllGlobals())

describe('canonical public routes', () => {
    it.each(moved)('%s moves to %s without losing parameters', (from, to) => {
        const target = publicRouteRedirect(new URL(from, ORIGIN))
        expect(target).toBe(to)
        expect(publicRouteRedirect(new URL(target, ORIGIN))).toBeNull()
    })

    it.each(unchanged)('%s stays at its own URL', (path) => {
        expect(publicRouteRedirect(new URL(path, ORIGIN))).toBeNull()
    })

    it('keeps old landing section bookmarks in the browser fallback', () => {
        expect(publicRouteRedirect(new URL('/landing/?ref=site#wallet', ORIGIN)))
            .toBe('/?ref=site#wallet')
    })

    it('cannot redirect to a query-supplied external destination', () => {
        expect(publicRouteRedirect(new URL('/landing/?next=https://example.org', ORIGIN)))
            .toBe('/?next=https://example.org')
    })

    it.each(['GET', 'HEAD'])('Vite sends HTTP 301 for %s, before HTML fallback', (method) => {
        for (const [from, to] of moved) {
            const res = { setHeader: vi.fn(), end: vi.fn() }
            const next = vi.fn()
            createPublicRoutesMiddleware()({ method, url: from }, res, next)
            expect(res.statusCode).toBe(301)
            expect(res.setHeader).toHaveBeenCalledWith('Location', to)
            expect(res.end).toHaveBeenCalledOnce()
            expect(next).not.toHaveBeenCalled()
        }
    })

    it('does not redirect non-navigation methods or API traffic', () => {
        for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
            const next = vi.fn()
            createPublicRoutesMiddleware()({ method, url: '/landing/' }, {}, next)
            expect(next).toHaveBeenCalledOnce()
        }
        const next = vi.fn()
        createPublicRoutesMiddleware()({ method: 'GET', url: '/api/v1/quote' }, {}, next)
        expect(next).toHaveBeenCalledOnce()
    })
})

describe('standalone Worker matches local routing', () => {
    it.each(['Mozilla/5.0', 'Googlebot', 'Google-InspectionTool', 'bingbot'])(
        'uses the same migration redirects for %s', async (userAgent) => {
            const upstream = vi.fn()
            vi.stubGlobal('fetch', upstream)
            for (const [from, to] of moved) {
                for (const method of ['GET', 'HEAD']) {
                    const response = await worker.fetch(new Request(ORIGIN + from, {
                        method, headers: { 'user-agent': userAgent },
                    }))
                    expect(response.status).toBe(301)
                    expect(response.headers.get('location')).toBe(ORIGIN + to)
                    expect(await response.text()).toBe('')
                }
            }
            expect(upstream).not.toHaveBeenCalled()
        },
    )

    it.each(unchanged)('passes %s through without an edge rewrite', async (path) => {
        const request = new Request(ORIGIN + path)
        const upstream = vi.fn(async () => new Response('origin', { status: 200 }))
        vi.stubGlobal('fetch', upstream)
        const response = await worker.fetch(request)
        expect(upstream).toHaveBeenCalledExactlyOnceWith(request)
        expect(await response.text()).toBe('origin')
    })
})

describe('wallet identity during the path-only migration', () => {
    it('keeps the same WebAuthn RP ID on root and /swap/', () => {
        const before = new URL(ORIGIN + '/')
        const after = new URL(ORIGIN + '/swap/')
        expect(after.origin).toBe(before.origin)
        expect(resolvePistachioRpId({ location: before })).toBe('pistachioswap.com')
        expect(resolvePistachioRpId({ location: after })).toBe('pistachioswap.com')
    })
})
