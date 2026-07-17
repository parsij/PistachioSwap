import type { FastifyPluginAsync } from 'fastify'

import { normalizeAddress } from '../lib/address.js'
import { getSafeError } from '../lib/errors.js'
import { getCoinGeckoToken } from '../providers/coingecko/token-data.js'
import { getTokenDiscoveryChain } from '../token-discovery/registry.js'

type TokenDetailsQuery = {
    chainId?: string
    address?: string
}

function createCoinGeckoUrl(coinGeckoId: string) {
    return (
        'https://www.coingecko.com/en/coins/' +
        encodeURIComponent(coinGeckoId)
    )
}

export function createTokenDetailsRoutes(
    lookupToken = getCoinGeckoToken,
): FastifyPluginAsync {
    return async (app) => {
    app.get<{ Querystring: TokenDetailsQuery }>(
        '/v1/token-details/coingecko',
        async (request, reply) => {
            if (
                Object.keys(request.query).some(
                    (key) => !['chainId', 'address'].includes(key),
                )
            ) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_QUERY_PARAMETER',
                        message: 'Unsupported query parameter.',
                    },
                })
            }
            const chainId = Number(request.query.chainId)
            const address = normalizeAddress(request.query.address)

            if (!Number.isInteger(chainId) || chainId <= 0) {
                return reply.code(400).send({
                    error: {
                        code: 'INVALID_CHAIN_ID',
                        message: 'A valid chain ID is required.',
                    },
                })
            }

            if (!address) {
                return reply.code(400).send({
                    error: {
                        code: 'INVALID_TOKEN_ADDRESS',
                        message: 'A valid token contract address is required.',
                    },
                })
            }

            if (!getTokenDiscoveryChain(chainId)?.active) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_COINGECKO_NETWORK',
                        message:
                            `CoinGecko network configuration is missing for chain ${chainId}.`,
                    },
                })
            }

            try {
                const token = await lookupToken(
                    address,
                    undefined,
                    chainId,
                )

                if (!token?.coinGeckoId) {
                    return reply.code(404).send({
                        error: {
                            code: 'COINGECKO_TOKEN_NOT_FOUND',
                            message:
                                'This token does not have a CoinGecko listing.',
                        },
                    })
                }

                reply.header('cache-control', 'public, max-age=86400')
                return {
                    chainId,
                    address,
                    coinGeckoId: token.coinGeckoId,
                    url: createCoinGeckoUrl(token.coinGeckoId),
                    cached: false,
                }
            } catch (error) {
                const safe = getSafeError(error)
                return reply.code(safe.statusCode).send(safe.body)
            }
        },
    )
    }
}

export const tokenDetailsRoutes = createTokenDetailsRoutes()
