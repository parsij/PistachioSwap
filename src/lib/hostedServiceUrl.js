/** Keep official API RPC traffic on the local hosted-mode proxy. */
export function hostedServiceUrl(value, {
    enabled = import.meta.env?.VITE_PISTACHIO_HOSTED_FRONTEND === 'true',
    origin = globalThis.location?.origin,
} = {}) {
    if (!enabled || !origin) return value
    const url = new URL(value)
    const local = new URL(origin)
    if (local.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) return value
    if (url.origin !== 'https://pistachioswap.com' || !url.pathname.startsWith('/api/')) return value
    return new URL(url.pathname + url.search + url.hash, local.origin).href
}
