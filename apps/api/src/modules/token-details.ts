import type { FastifyPluginAsync } from 'fastify'

import { normalizeAddress } from '../lib/address.js'
import { getSafeError } from '../lib/errors.js'
import { getCoinGeckoToken } from '../providers/coingecko/token-data.js'

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

export const tokenDetailsRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: TokenDetailsQuery }>(
        '/v1/token-details/coingecko',
        async (request, reply) => {
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

            if (chainId !== 56) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_COINGECKO_NETWORK',
                        message:
                            `CoinGecko network configuration is missing for chain ${chainId}.`,
                    },
                })
            }

            try {
                const token = await getCoinGeckoToken(address)

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
