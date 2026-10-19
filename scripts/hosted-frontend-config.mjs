import { Agent } from 'node:https'
import process from 'node:process'

export const HOSTED_ORIGIN = 'https://pistachioswap.com'

export function readPublicFrontendEnvironment(manifest) {
    if (manifest?.schemaVersion !== 1 || manifest?.project !== 'PistachioSwap' ||
        manifest.origin !== HOSTED_ORIGIN || manifest.source?.repository !== 'parsij/PistachioSwap' ||
        !/^[a-f0-9]{40}$/.test(manifest.source?.commit ?? '')) {
        throw new Error('The hosted frontend configuration is not a recognized PistachioSwap manifest.')
    }
    const environment = manifest.build?.publicEnvironment
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
        throw new Error('The hosted frontend configuration is missing browser-safe settings.')
    }
    const values = {}
    for (const [key, value] of Object.entries(environment)) {
        if (!/^VITE_[A-Z0-9_]+$/.test(key)) continue
        if (typeof value !== 'string' || value.length > 16_384 || value.includes('\0')) {
            throw new Error(`Invalid public frontend setting: ${key}`)
        }
        values[key] = value
    }
    if (!/^[a-f0-9]{32}$/i.test(values.VITE_REOWN_PROJECT_ID ?? '')) {
        throw new Error('The hosted frontend configuration is missing its public wallet-connection project ID.')
    }
    return values
}

// The proxy is fixed to the public service; callers cannot select upstream hosts.
export function hostedApiProxy() {
    return {
        target: HOSTED_ORIGIN,
        changeOrigin: true,
        secure: true,
        agent: new Agent({ keepAlive: true, proxyEnv: process.env }),
        timeout: 60_000,
        proxyTimeout: 60_000,
        configure(proxy) {
            proxy.on('proxyReq', (request) => {
                // A server-to-server request has no browser Origin or cookies.
                // Let the upstream edge establish IP/location evidence itself.
                for (const name of request.getHeaderNames()) {
                    if (/^(?:origin|referer|cookie|forwarded|x-real-ip|x-forwarded-.*|cf-.*|true-client-ip)$/i.test(name)) {
                        request.removeHeader(name)
                    }
                }
            })
        },
    }
}
