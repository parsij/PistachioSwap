import { getApiConfig } from '../config.js'
import { ProviderError } from '../lib/errors.js'
import {
    type TokenDiscoveryChain,
    requireActiveTokenDiscoveryChain,
} from './registry.js'

export type TokenDiscoveryContext = Readonly<{
    chain: TokenDiscoveryChain
    chainId: number
}>

export function tokenDiscoveryContext(chainId: number): TokenDiscoveryContext {
    return Object.freeze({
        chain: requireActiveTokenDiscoveryChain(chainId),
        chainId,
    })
}

function validatedRpcUrl(name: string, raw: string) {
    const url = new URL(raw)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (
        url.username ||
        url.password ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    ) {
        throw new Error(`${name} must be an HTTPS RPC URL.`)
    }
    return url
}

export function getServerRpcUrl(chainId: number): URL | null {
    const { chain } = tokenDiscoveryContext(chainId)
    const envName = chain.providers.rpcEnv
    const explicit = envName ? process.env[envName]?.trim() : null
    if (explicit && envName) return validatedRpcUrl(envName, explicit)

    const config = getApiConfig().alchemy
    if (!chain.capabilities.alchemy || !chain.providers.alchemyNetwork) return null
    if (chainId === 56 && config.rpcUrl) return new URL(config.rpcUrl)
    if (!config.apiKey) return null
    return new URL(
        `https://${chain.providers.alchemyNetwork}.g.alchemy.com/v2/${encodeURIComponent(config.apiKey)}`,
    )
}

export function requireServerRpcUrl(chainId: number) {
    const url = getServerRpcUrl(chainId)
    if (!url) {
        throw new ProviderError({
            code: 'CHAIN_RPC_UNAVAILABLE',
            message: 'Token RPC coverage is unavailable for this chain.',
            statusCode: 503,
        })
    }
    return url
}
