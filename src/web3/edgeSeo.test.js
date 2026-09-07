import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../deploy/cloudflare-cache-and-crawlers.js'

afterEach(() => vi.unstubAllGlobals())

describe('edge SEO response parity', () => {
    it.each(['Mozilla/5.0', 'Googlebot', 'bingbot', 'OAI-SearchBot'])(
        'passes through the same URL and document for %s', async (userAgent) => {
            const request = new Request('https://pistachioswap.com/?test=seo', {
                headers: { 'user-agent': userAgent },
            })
            const upstream = vi.fn(async () => new Response('<h1>Pistachio Swap</h1>', {
                headers: { 'content-type': 'text/html', 'x-content-type-options': 'nosniff' },
            }))
            vi.stubGlobal('fetch', upstream)
            const result = await worker.fetch(request)
            expect(upstream).toHaveBeenCalledExactlyOnceWith(request)
            expect(await result.text()).toBe('<h1>Pistachio Swap</h1>')
            expect(result.headers.get('x-content-type-options')).toBe('nosniff')
            expect(result.headers.get('cache-control')).toContain('no-store')
        },
    )

    it.each([['/wallet/', 200], ['/how-it-works/', 200], ['/faq/', 200], ['/landing/missing/', 404]])(
        'preserves the response status for %s', async (path, status) => {
            vi.stubGlobal('fetch', vi.fn(async () => new Response('origin', { status })))
            const response = await worker.fetch(new Request(`https://pistachioswap.com${path}`))
            expect(response.status).toBe(status)
            expect(response.headers.get('cache-control')).toContain('no-store')
        },
    )

    it('does not change API request methods or cache wallet responses', async () => {
        const request = new Request('https://pistachioswap.com/api/v1/quote', { method: 'POST', body: '{}' })
        const upstream = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))
        vi.stubGlobal('fetch', upstream)
        const result = await worker.fetch(request)
        expect(upstream).toHaveBeenCalledExactlyOnceWith(request)
        expect(result.headers.get('cache-control')).toBe('no-store')
        expect(result.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
    })
})
