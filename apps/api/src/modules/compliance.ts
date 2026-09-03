import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import {
    ComplianceError,
    complianceRequestGeo,
    getComplianceService,
} from '../compliance/service.js'
import { normalizeAddress } from '../lib/address.js'

function exactBody(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ComplianceError('COMPLIANCE_INVALID_REQUEST', 'A JSON request body is required.', 400)
    }
    const body = value as Record<string, unknown>
    const allowed = new Set(['walletAddress', 'chainId', 'purpose'])
    if (Object.keys(body).some((key) => !allowed.has(key)) || !('walletAddress' in body)) {
        throw new ComplianceError('COMPLIANCE_INVALID_REQUEST', 'The request contains unsupported or missing fields.', 400)
    }
    const walletAddress = normalizeAddress(body.walletAddress)
    const chainId = body.chainId == null ? null : Number(body.chainId)
    const purpose = body.purpose == null ? 'background' : String(body.purpose)
    if (!['background', 'transaction'].includes(purpose)) {
        throw new ComplianceError('COMPLIANCE_INVALID_REQUEST', 'The compliance purpose is invalid.', 400)
    }
    if (!walletAddress || (chainId != null && (!Number.isSafeInteger(chainId) || chainId <= 0))) {
        throw new ComplianceError('COMPLIANCE_INVALID_REQUEST', 'A valid wallet and optional chain ID are required.', 400)
    }
    return { walletAddress, chainId, purpose }
}

function geo(request: FastifyRequest) {
    return complianceRequestGeo(request.headers as Record<string, unknown>)
}

export const complianceRoutes: FastifyPluginAsync = async (app) => {
    app.post<{ Body: unknown }>(
        '/v1/compliance/screen',
        { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
        async (request, reply) => {
            try {
                const body = exactBody(request.body)
                const location = geo(request)
                const result = await getComplianceService().screen({
                    walletAddress: body.walletAddress,
                    chainId: body.chainId,
                    action: body.purpose === 'transaction' ? 'client-transaction-gate' : 'client-screen',
                    countryCode: location.countryCode,
                    regionCode: location.regionCode,
                    clientIp: request.ip,
                    persist: body.purpose === 'transaction',
                    useExternalProvider: true,
                })
                return reply.send({
                    allowed: result.allowed,
                    decision: result.decision,
                    checkedAt: result.checkedAt,
                    expiresAt: result.expiresAt,
                })
            } catch (error) {
                const status = error instanceof ComplianceError ? error.statusCode : 503
                return reply.code(status).send({
                    error: {
                        code: error instanceof ComplianceError ? error.code : 'COMPLIANCE_UNAVAILABLE',
                        message: status >= 500
                            ? 'Compliance screening is temporarily unavailable. Please try again later.'
                            : error instanceof Error ? error.message : 'The compliance request could not be completed.',
                    },
                })
            }
        },
    )

    app.get('/v1/compliance/status', async (_request, reply) => {
        const status = getComplianceService().status()
        return reply.send({
            enabled: status.enabled,
            ready: !status.enabled || Boolean(status.listVersion),
            refreshedAt: status.refreshedAt,
        })
    })
}
