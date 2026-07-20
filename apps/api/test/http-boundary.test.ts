import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson, readResponseTextLimited } from '../src/lib/http.js'

describe('provider HTTP response boundary', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('rejects declared and streamed bodies over the byte limit', async () => {
        await expect(readResponseTextLimited(new Response('{}', {
            headers: { 'content-length': '100' },
        }), 10)).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })

        await expect(readResponseTextLimited(new Response('x'.repeat(20)), 10))
            .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })
    })

    it('does not retry an oversized successful provider response', async () => {
        const fetcher = vi.fn(async () => new Response('{}', {
            status: 200,
            headers: {
                'content-type': 'application/json',
                'content-length': String(6 * 1024 * 1024),
            },
        }))
        vi.stubGlobal('fetch', fetcher)

        await expect(fetchJson(new URL('https://example.com/data')))
            .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })
        expect(fetcher).toHaveBeenCalledTimes(1)
    })
})
