// Default hosted-service compliance response for browser integration tests.
//
// Production intentionally fails closed when sanctions screening cannot be
// reached. Browser integration tests are not network tests, so let them use a
// deterministic allowed response unless a test explicitly replaces `fetch`
// to exercise restricted or unavailable behavior.
if (typeof window !== 'undefined') {
    const nativeFetch = typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null

    globalThis.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' || input instanceof URL
            ? String(input)
            : input?.url
        let pathname = ''
        try {
            pathname = new URL(rawUrl, window.location.origin).pathname
        } catch {
            // Preserve the underlying fetch behavior for malformed/unrelated requests.
        }

        if (pathname.endsWith('/v1/compliance/screen')) {
            return new Response(JSON.stringify({
                allowed: true,
                decision: 'allow',
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        }

        if (!nativeFetch) {
            throw new Error(`Unexpected fetch in browser test: ${String(rawUrl)}`)
        }
        return nativeFetch(input, init)
    }
}
