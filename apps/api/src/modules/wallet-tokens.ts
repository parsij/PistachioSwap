import type { FastifyPluginAsync } from 'fastify'

import { getApiConfig } from '../config.js'
import { normalizeAddress } from '../lib/address.js'
import { getSafeError } from '../lib/errors.js'
import {
    getWalletTokens,
    WALLET_TOKEN_CLASSIFICATION_VERSION,
} from '../providers/alchemy/wallet-tokens.js'

type WalletTokenQuery = {
    chainId?: string
    address?: string
    includeZero?: string
}

export const walletTokenRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: WalletTokenQuery }>(
        '/v1/wallet-tokens',
        async (request, reply) => {
            const config = getApiConfig()
            const chainId = Number(
                request.query.chainId ?? config.chainId,
            )
            const address = normalizeAddress(request.query.address)

            if (!config.allowedChains.has(chainId)) {
                return reply.code(400).send({
                    error: {
                        code: 'UNSUPPORTED_CHAIN',
                        message: 'Only BNB Chain (56) is supported.',
                    },
                })
            }

            if (!address) {
                return reply.code(400).send({
                    error: {
                        code: 'INVALID_WALLET_ADDRESS',
                        message: 'A valid wallet address is required.',
                    },
                })
            }

            const controller = new AbortController()
            const abort = () => controller.abort()
            request.raw.once('aborted', abort)
            try {
                const tokens = await getWalletTokens({
                    chainId,
                    walletAddress: address,
                    includeZero: request.query.includeZero === 'true',
                    signal: controller.signal,
                })
                if (process.env.NODE_ENV !== 'production') {
                    request.log.debug({
                        classification: {
                            total: tokens.length,
                            primary: tokens.filter((token) => token.visibility === 'primary').length,
                            hidden: tokens.filter((token) => token.visibility === 'hidden').length,
                            unverifiedVisibility: tokens.filter((token) => token.visibility === 'unverified').length,
                            established: tokens.filter((token) => token.recognitionStatus === 'established').length,
                            recognized: tokens.filter((token) => token.recognitionStatus === 'recognized').length,
                            unverified: tokens.filter((token) => token.recognitionStatus === 'unverified').length,
                            high: tokens.filter((token) => token.securityStatus === 'high').length,
                            blocked: tokens.filter((token) => token.securityStatus === 'blocked').length,
                        },
                    }, 'Wallet token classification')
                }
                reply.header('cache-control', 'private, no-store')
                return {
                    classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                    chainId,
                    address,
                    tokens,
                }
            } catch (error) {
                const safe = getSafeError(error)
                return reply.code(safe.statusCode).send(safe.body)
            } finally {
                request.raw.off('aborted', abort)
            }
        },
    )
}
