import type { FastifyPluginAsync } from 'fastify'

import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../lib/address.js'
import { getServerRpcUrl } from '../token-discovery/context.js'
import {
    canonicalTokenAddress,
    getTokenDiscoveryChain,
} from '../token-discovery/registry.js'

const MAX_KNOWN_TOKENS = 64
const RPC_TIMEOUT_MS = 2_500
const BALANCE_OF_SELECTOR = '0x70a08231'
const RPC_RESULT = /^0x[0-9a-f]{1,64}$/i

type KnownToken = Readonly<{
    chainId: number
    address: string
}>

type KnownBalance = Readonly<{
    chainId: number
    address: string
    rawBalance: string
}>

type RpcRequest = Readonly<{
    jsonrpc: '2.0'
    id: number
    method: 'eth_getBalance' | 'eth_call'
    params: unknown[]
}>

type FetchLike = typeof fetch

type KnownBalanceDependencies = Readonly<{
    fetchImpl?: FetchLike
    rpcUrlForChain?: typeof getServerRpcUrl
}>

function balanceOfData(walletAddress: string) {
    return `${BALANCE_OF_SELECTOR}${walletAddress.slice(2).padStart(64, '0')}`
}

function normalizeKnownTokens(value: unknown) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_KNOWN_TOKENS) {
        return null
    }

    const tokens = new Map<string, KnownToken>()
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return null
        }
        const record = candidate as Record<string, unknown>
        const chainId = Number(record.chainId)
        const address = normalizeAddress(record.address)
        const chain = Number.isSafeInteger(chainId)
            ? getTokenDiscoveryChain(chainId)
            : null
        if (!chain?.active || !address) return null

        const canonicalAddress = canonicalTokenAddress(chainId, address)
        tokens.set(`${chainId}:${canonicalAddress}`, {
            chainId,
            address: canonicalAddress,
        })
    }

    return [...tokens.values()]
}

function createRpcRequests(walletAddress: string, tokens: KnownToken[]) {
    return tokens.map((token, index): RpcRequest => token.address === NATIVE_TOKEN_ADDRESS
        ? {
              jsonrpc: '2.0',
              id: index + 1,
              method: 'eth_getBalance',
              params: [walletAddress, 'latest'],
          }
        : {
              jsonrpc: '2.0',
              id: index + 1,
              method: 'eth_call',
              params: [{
                  to: token.address,
                  data: balanceOfData(walletAddress),
              }, 'latest'],
          })
}

function parseRpcBalances(
    payload: unknown,
    tokens: KnownToken[],
) {
    const rows = Array.isArray(payload) ? payload : [payload]
    const byId = new Map<number, Record<string, unknown>>()
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue
        const record = row as Record<string, unknown>
        const id = Number(record.id)
        if (Number.isSafeInteger(id)) byId.set(id, record)
    }

    const balances: KnownBalance[] = []
    let failures = 0
    for (const [index, token] of tokens.entries()) {
        const result = byId.get(index + 1)?.result
        if (typeof result !== 'string' || !RPC_RESULT.test(result)) {
            failures += 1
            continue
        }
        balances.push({
            chainId: token.chainId,
            address: token.address,
            rawBalance: BigInt(result).toString(),
        })
    }
    return { balances, failures }
}

async function fetchChainBalances({
    fetchImpl,
    rpcUrl,
    walletAddress,
    tokens,
}: {
    fetchImpl: FetchLike
    rpcUrl: URL
    walletAddress: string
    tokens: KnownToken[]
}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
    try {
        const response = await fetchImpl(rpcUrl, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            body: JSON.stringify(createRpcRequests(walletAddress, tokens)),
            signal: controller.signal,
        })
        if (!response.ok) throw new Error('RPC request failed')
        return parseRpcBalances(await response.json(), tokens)
    } finally {
        clearTimeout(timeout)
    }
}

export function createWalletTokenKnownBalanceRoutes(
    dependencies: KnownBalanceDependencies = {},
): FastifyPluginAsync {
    const fetchImpl = dependencies.fetchImpl ?? fetch
    const rpcUrlForChain = dependencies.rpcUrlForChain ?? getServerRpcUrl

    return async (app) => {
        app.post<{ Body: unknown }>(
            '/v1/wallet-tokens/known-balances',
            {
                config: {
                    rateLimit: {
                        max: 30,
                        timeWindow: '1 minute',
                    },
                },
            },
            async (request, reply) => {
                if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
                    return reply.code(400).send({
                        error: {
                            code: 'INVALID_REQUEST',
                            message: 'A wallet and known-token list are required.',
                        },
                    })
                }

                const body = request.body as Record<string, unknown>
                const walletAddress = normalizeAddress(body.address)
                const tokens = normalizeKnownTokens(body.tokens)
                if (!walletAddress || !tokens) {
                    return reply.code(400).send({
                        error: {
                            code: 'INVALID_REQUEST',
                            message: 'A wallet and known-token list are required.',
                        },
                    })
                }

                const grouped = new Map<number, KnownToken[]>()
                for (const token of tokens) {
                    grouped.set(token.chainId, [
                        ...(grouped.get(token.chainId) ?? []),
                        token,
                    ])
                }

                const balances: KnownBalance[] = []
                const successfulChainIds: number[] = []
                const failedChainIds: number[] = []
                const chainErrors: Record<string, string> = {}

                await Promise.all([...grouped.entries()].map(async ([chainId, chainTokens]) => {
                    const rpcUrl = rpcUrlForChain(chainId)
                    if (!rpcUrl) {
                        failedChainIds.push(chainId)
                        chainErrors[String(chainId)] = 'Balance RPC is unavailable.'
                        return
                    }
                    try {
                        const result = await fetchChainBalances({
                            fetchImpl,
                            rpcUrl,
                            walletAddress,
                            tokens: chainTokens,
                        })
                        balances.push(...result.balances)
                        if (result.balances.length > 0) {
                            successfulChainIds.push(chainId)
                        } else {
                            failedChainIds.push(chainId)
                        }
                        if (result.failures > 0) {
                            chainErrors[String(chainId)] = 'Some known balances could not be refreshed.'
                        }
                    } catch {
                        failedChainIds.push(chainId)
                        chainErrors[String(chainId)] = 'Known balances could not be refreshed.'
                    }
                }))

                successfulChainIds.sort((left, right) => left - right)
                failedChainIds.sort((left, right) => left - right)
                balances.sort((left, right) =>
                    left.chainId - right.chainId ||
                    left.address.localeCompare(right.address))

                return {
                    address: walletAddress,
                    balances,
                    successfulChainIds,
                    failedChainIds,
                    chainErrors,
                    partial: failedChainIds.length > 0 || Object.keys(chainErrors).length > 0,
                }
            },
        )
    }
}

export const walletTokenKnownBalanceRoutes =
    createWalletTokenKnownBalanceRoutes()

export const walletTokenKnownBalanceInternals = {
    balanceOfData,
    createRpcRequests,
    normalizeKnownTokens,
    parseRpcBalances,
}
