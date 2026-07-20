import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import { getPool } from '../db/client.js'
import { GasAssistError, gasAssistErrorBody } from '../gas-assist/errors.js'

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/i

function configuredAdminToken() {
    const token = process.env.SPONSORSHIP_ADMIN_TOKEN?.trim()
    if (!token || token.length < 32) {
        throw new GasAssistError('ADMIN_NOT_CONFIGURED', 'The sponsorship admin API is not configured.', 503)
    }
    return token
}

function constantTimeEqual(left: string, right: string) {
    const leftBytes = Buffer.from(left)
    const rightBytes = Buffer.from(right)
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function requireLocalAdmin(request: FastifyRequest) {
    const remote = request.socket.remoteAddress ?? request.ip
    if (!LOCAL_ADDRESSES.has(request.ip) || !LOCAL_ADDRESSES.has(remote)) {
        throw new GasAssistError('ADMIN_LOCALHOST_ONLY', 'This endpoint is available only from localhost.', 403)
    }
    const authorization = request.headers.authorization ?? ''
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    if (!supplied || !constantTimeEqual(supplied, configuredAdminToken())) {
        throw new GasAssistError('ADMIN_UNAUTHORIZED', 'Invalid sponsorship admin credentials.', 401)
    }
}

async function safe<T>(handler: () => Promise<T>, reply: FastifyReply) {
    try {
        return await handler()
    } catch (error) {
        const response = gasAssistErrorBody(error)
        return reply.code(response.statusCode).send(response.body)
    }
}

function status(value: unknown) {
    const normalized = String(value ?? 'pending').trim().toLowerCase()
    if (!['pending', 'sent', 'cancelled', 'needs-review'].includes(normalized)) {
        throw new GasAssistError('INVALID_REQUEST', 'Refund status is invalid.')
    }
    return normalized
}

export const sponsorshipRefundAdminRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', async (request) => requireLocalAdmin(request))

    app.get<{ Querystring: { status?: string } }>(
        '/admin/sponsorship/refunds',
        (request, reply) => safe(async () => {
            const selectedStatus = status(request.query.status)
            const result = await getPool().query(
                `SELECT id,order_id AS "orderId",wallet_address AS "walletAddress",chain_id AS "chainId",
                        token_address AS "tokenAddress",gross_payment_raw::text AS "grossPaymentRaw",
                        actual_sponsored_gas_usd_micros::text AS "actualSponsoredGasUsdMicros",
                        estimated_refund_gas_usd_micros::text AS "estimatedRefundGasUsdMicros",
                        refundable_token_amount_raw::text AS "refundableTokenAmountRaw",status,reason,
                        refund_transaction_hash AS "refundTransactionHash",created_at AS "createdAt",updated_at AS "updatedAt"
                 FROM sponsorship_refunds WHERE status=$1 ORDER BY created_at ASC`,
                [selectedStatus],
            )
            return { refunds: result.rows }
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/admin/sponsorship/refunds/:orderId/mark-sent',
        (request, reply) => safe(async () => {
            if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
                throw new GasAssistError('INVALID_REQUEST', 'A JSON request body is required.')
            }
            const body = request.body as Record<string, unknown>
            if (Object.keys(body).length !== 1 || !('transactionHash' in body)) {
                throw new GasAssistError('INVALID_REQUEST', 'Only transactionHash is supported.')
            }
            const transactionHash = String(body.transactionHash ?? '').trim().toLowerCase()
            if (!TRANSACTION_HASH.test(transactionHash)) {
                throw new GasAssistError('INVALID_REQUEST', 'A valid refund transaction hash is required.')
            }
            const result = await getPool().query(
                `UPDATE sponsorship_refunds
                 SET status='sent',refund_transaction_hash=$2,updated_at=now()
                 WHERE order_id=$1 AND status IN ('pending','needs-review')
                 RETURNING id,order_id AS "orderId",wallet_address AS "walletAddress",
                           token_address AS "tokenAddress",refundable_token_amount_raw::text AS "refundableTokenAmountRaw",
                           status,refund_transaction_hash AS "refundTransactionHash",updated_at AS "updatedAt"`,
                [request.params.orderId, transactionHash],
            )
            if (!result.rows[0]) {
                throw new GasAssistError('REFUND_NOT_PENDING', 'No pending refund exists for this order.', 404)
            }
            request.log.info({
                subsystem: 'sponsorship-admin',
                action: 'refund-mark-sent',
                orderId: request.params.orderId,
                transactionHash,
            }, 'Sponsorship refund marked as sent')
            return { refund: result.rows[0] }
        }, reply),
    )

    app.post<{ Params: { orderId: string }; Body: unknown }>(
        '/admin/sponsorship/refunds/:orderId/mark-needs-review',
        (request, reply) => safe(async () => {
            const reason = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
                ? String((request.body as Record<string, unknown>).reason ?? '').trim().slice(0, 240)
                : ''
            const result = await getPool().query(
                `UPDATE sponsorship_refunds
                 SET status='needs-review',reason=CASE WHEN $2='' THEN reason ELSE $2 END,updated_at=now()
                 WHERE order_id=$1 AND status='pending'
                 RETURNING id,order_id AS "orderId",status,reason,updated_at AS "updatedAt"`,
                [request.params.orderId, reason],
            )
            if (!result.rows[0]) {
                throw new GasAssistError('REFUND_NOT_PENDING', 'No pending refund exists for this order.', 404)
            }
            return { refund: result.rows[0] }
        }, reply),
    )
}
