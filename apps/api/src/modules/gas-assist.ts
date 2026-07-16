import type { FastifyPluginAsync } from 'fastify'

import { getApiConfig } from '../config.js'
import { GasAssistError, gasAssistErrorBody } from '../gas-assist/errors.js'
import { gaslessService, type GaslessInput } from '../gas-assist/gasless-service.js'

function service() {
    if (getApiConfig().gasAssist.mode !== 'zero-x-gasless') {
        throw new GasAssistError('GAS_ASSIST_DISABLED', '0x Gas Assist is disabled.', 503)
    }
    return gaslessService()
}

function exactObject(value: unknown, allowed: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new GasAssistError('INVALID_AMOUNT', 'A JSON request body is required.')
    }
    const record = value as Record<string, unknown>
    const fields = new Set(allowed)
    if (Object.keys(record).some((key) => !fields.has(key))) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', 'The request contains unsupported fields.')
    }
    return record
}

function tradeInput(value: unknown, clientIp: string, includeSlippage: boolean): GaslessInput {
    const allowed = ['chainId', 'walletAddress', 'sellToken', 'sellAmount']
    if (includeSlippage) allowed.push('slippageBps')
    const body = exactObject(value, allowed)
    return {
        chainId: Number(body.chainId),
        walletAddress: String(body.walletAddress ?? ''),
        sellToken: String(body.sellToken ?? ''),
        sellAmount: String(body.sellAmount ?? ''),
        ...(includeSlippage ? { slippageBps: Number(body.slippageBps ?? 50) } : {}),
        clientIp,
    }
}

async function safe<T>(handler: () => Promise<T>, reply: { code(status: number): { send(body: unknown): unknown } }) {
    try {
        return await handler()
    } catch (error) {
        const response = gasAssistErrorBody(error)
        return reply.code(response.statusCode).send(response.body)
    }
}

export const gasAssistRoutes: FastifyPluginAsync = async (app) => {
    app.get('/v1/gas-assist/config', async () => {
        const config = getApiConfig()
        const enabled = config.gasAssist.mode === 'zero-x-gasless'
        return {
            enabled,
            mode: enabled ? 'zero-x-gasless' : config.gasAssist.mode,
            chainId: 56,
            buyToken: 'native',
            minimumSellUsd: config.gasAssist.minimumSellUsd,
            minimumUserOutputUsd: config.gasAssist.minimumUserOutputUsd,
            feeBps: config.fees.platformFeeBps,
            rejectUnlimitedPermits: config.gasAssist.rejectUnlimitedPermits,
            quoteTtlSeconds: config.gasAssist.quoteTtlSeconds,
            statusPollIntervalMs: config.gasAssist.statusPollIntervalMs,
            statusTimeoutMs: config.gasAssist.statusTimeoutMs,
        }
    })

    app.post<{ Body: unknown }>(
        '/v1/gas-assist/price',
        { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
        (request, reply) => safe(
            () => service().price(tradeInput(request.body, request.ip, false)),
            reply,
        ),
    )

    app.post<{ Body: unknown }>(
        '/v1/gas-assist/quote',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(
            () => service().quote(tradeInput(request.body, request.ip, true)),
            reply,
        ),
    )

    app.post<{ Body: unknown }>(
        '/v1/gas-assist/submit',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        (request, reply) => safe(async () => {
            const body = exactObject(request.body, ['quoteId', 'approvalSignature', 'tradeSignature'])
            const quoteId = String(body.quoteId ?? '')
            if (!/^[0-9a-f-]{36}$/i.test(quoteId)) {
                throw new GasAssistError('QUOTE_NOT_FOUND', 'The Gas Assist quote was not found.', 404)
            }
            return service().submit({
                quoteId,
                approvalSignature: body.approvalSignature === null || body.approvalSignature === undefined
                    ? null
                    : String(body.approvalSignature),
                tradeSignature: String(body.tradeSignature ?? ''),
            })
        }, reply),
    )

    app.get<{ Params: { tradeHash: string } }>(
        '/v1/gas-assist/status/:tradeHash',
        { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
        (request, reply) => safe(
            () => service().status(request.params.tradeHash),
            reply,
        ),
    )
}
