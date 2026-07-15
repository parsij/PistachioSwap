import { getApiConfig } from '../../config.js'
import { createTokenId, normalizeAddress } from '../../lib/address.js'
import {
    isRecord,
    validateRemoteImageUrl,
} from '../../lib/http.js'
import { alchemyRpcBatch } from './alchemy-client.js'

export type TokenMetadata = {
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string | null
}

type CacheEntry = {
    expiresAt: number
    metadata: TokenMetadata | null
}

const metadataCache = new Map<string, CacheEntry>()
const pendingMetadata = new Map<string, Promise<TokenMetadata | null>>()

export function normalizeAlchemyMetadata({
    chainId,
    address,
    value,
}: {
    chainId: number
    address: string
    value: unknown
}): TokenMetadata | null {
    if (!isRecord(value)) return null

    const normalizedAddress = normalizeAddress(address)
    const decimals = Number(value.decimals)
    const name =
        typeof value.name === 'string' ? value.name.trim() : ''
    const symbol =
        typeof value.symbol === 'string' ? value.symbol.trim() : ''

    if (
        !normalizedAddress ||
        !name ||
        !symbol ||
        name.length > 120 ||
        symbol.length > 32 ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255
    ) {
        return null
    }

    return {
        chainId,
        address: normalizedAddress,
        name,
        symbol,
        decimals,
        logoURI: validateRemoteImageUrl(value.logo),
    }
}

function setCache(
    key: string,
    metadata: TokenMetadata | null,
) {
    const config = getApiConfig().alchemy
    metadataCache.set(key, {
        metadata,
        expiresAt:
            Date.now() +
            (metadata
                ? config.metadataTtlMs
                : config.negativeMetadataTtlMs),
    })
}

function readCache(key: string) {
    const cached = metadataCache.get(key)

    if (!cached || cached.expiresAt <= Date.now()) {
        metadataCache.delete(key)
        return undefined
    }

    return cached.metadata
}

function chunks<T>(values: T[], size: number) {
    const output: T[][] = []
    for (let index = 0; index < values.length; index += size) {
        output.push(values.slice(index, index + size))
    }
    return output
}

export async function getTokenMetadataBatch({
    chainId,
    addresses,
    signal,
}: {
    chainId: number
    addresses: string[]
    signal?: AbortSignal
}): Promise<Map<string, TokenMetadata | null>> {
    const unique = [
        ...new Set(
            addresses
                .map(normalizeAddress)
                .filter((value): value is string => value !== null),
        ),
    ]
    const result = new Map<string, TokenMetadata | null>()
    const missing: string[] = []

    for (const address of unique) {
        const key = createTokenId(chainId, address)
        const cached = readCache(key)

        if (cached !== undefined) {
            result.set(address, cached)
        } else {
            missing.push(address)
        }
    }

    for (const batch of chunks(
        missing,
        getApiConfig().alchemy.maxBatchSize,
    )) {
        let responses: Awaited<ReturnType<typeof alchemyRpcBatch>>

        try {
            responses = await alchemyRpcBatch(
                batch.map((address, index) => ({
                    id: index,
                    jsonrpc: '2.0' as const,
                    method: 'alchemy_getTokenMetadata',
                    params: [address],
                })),
                signal,
            )
        } catch {
            for (const address of batch) result.set(address, null)
            continue
        }

        for (let index = 0; index < batch.length; index += 1) {
            const address = batch[index]
            const response = responses.get(index)
            const metadata =
                response && !response.error
                    ? normalizeAlchemyMetadata({
                          chainId,
                          address,
                          value: response.result,
                      })
                    : null

            setCache(createTokenId(chainId, address), metadata)
            result.set(address, metadata)
        }
    }

    return result
}

export function getTokenMetadata(
    chainId: number,
    address: string,
    signal?: AbortSignal,
) {
    const normalized = normalizeAddress(address)

    if (!normalized) return Promise.resolve(null)

    const key = createTokenId(chainId, normalized)
    const cached = readCache(key)
    if (cached !== undefined) return Promise.resolve(cached)

    const pending = pendingMetadata.get(key)
    if (pending) return pending

    const request = getTokenMetadataBatch({
        chainId,
        addresses: [normalized],
        signal,
    })
        .then((values) => values.get(normalized) ?? null)
        .finally(() => pendingMetadata.delete(key))

    pendingMetadata.set(key, request)
    return request
}
