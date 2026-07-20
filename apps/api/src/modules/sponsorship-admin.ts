import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { Address } from 'viem'

import { getApiConfig } from '../config.js'
import { getPool } from '../db/client.js'
import { GasAssistError, gasAssistErrorBody } from '../gas-assist/errors.js'
import { megaFuelPolicyManagement } from '../gas-assist/policy-management.js'
import { createPrepaidChainClient } from '../gas-assist/prepaid/chain-client.js'
import { parseFixed } from '../gas-assist/prepaid/fixed-point.js'
import { normalizeAddress } from '../lib/address.js'

const TRANSFER_SELECTOR = '0xa9059cbb'
const APPROVE_SELECTOR = '0x095ea7b3'
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function exactObject(value: unknown, allowed: string[], required: string[] = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new GasAssistError('INVALID_REQUEST', 'A JSON request body is required.')
    }
    const record = value as Record<string, unknown>
    const supported = new Set(allowed)
    if (Object.keys(record).some((key) => !supported.has(key)) || required.some((key) => !(key in record))) {
        throw new GasAssistError('INVALID_REQUEST', 'The request contains unsupported or missing fields.')
    }
    return record
}

function address(value: unknown) {
    const normalized = normalizeAddress(String(value ?? ''))
    if (!normalized) throw new GasAssistError('INVALID_REQUEST', 'A valid token address is required.')
    return normalized as Address
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new GasAssistError('INVALID_REQUEST', `${name} must be an integer between ${minimum} and ${maximum}.`)
    }
    return parsed
}

function boolean(value: unknown, name: string) {
    if (typeof value !== 'boolean') throw new GasAssistError('INVALID_REQUEST', `${name} must be boolean.`)
    return value
}

function adminToken() {
    const token = process.env.SPONSORSHIP_ADMIN_TOKEN?.trim()
    if (!token || token.length < 32) {
        throw new GasAssistError('ADMIN_NOT_CONFIGURED', 'The sponsorship admin API is not configured.', 503)
    }
    return token
}

function equalSecret(left: string, right: string) {
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
    if (!supplied || !equalSecret(supplied, adminToken())) {
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

async function verifyContract(token: Address, expectedDecimals: number) {
    const chain = createPrepaidChainClient()
    const [code, decimals] = await Promise.all([
        chain.getCode(token),
        chain.getTokenDecimals(token),
    ])
    if (!code || code === '0x') {
        throw new GasAssistError('TOKEN_CONTRACT_REQUIRED', 'The token address has no deployed bytecode.', 409)
    }
    if (decimals !== expectedDecimals) {
        throw new GasAssistError('TOKEN_DECIMALS_MISMATCH', 'Stored decimals do not match the token contract.', 409)
    }
}

async function syncBasePolicy() {
    const treasury = getApiConfig().fees.treasuryAddress
    if (!treasury) throw new GasAssistError('TREASURY_NOT_CONFIGURED', 'TREASURY_ADDRESS is required.', 503)
    await megaFuelPolicyManagement.add('ContractMethodSigWhitelist', [TRANSFER_SELECTOR, APPROVE_SELECTOR])
    await megaFuelPolicyManagement.add('BEP20ReceiverWhiteList', [treasury])
}

async function syncToken(token: Address) {
    await syncBasePolicy()
    await megaFuelPolicyManagement.add('ToAccountWhitelist', [token])
}

const tokenSelect = `SELECT chain_id AS "chainId",token_address AS "tokenAddress",symbol,decimals,enabled,
    fee_payment_enabled AS "feePaymentEnabled",approval_sponsorship_enabled AS "approvalSponsorshipEnabled",
    normal_swap_sponsorship_enabled AS "normalSwapSponsorshipEnabled",is_stablecoin AS "isStablecoin",
    payment_priority AS "paymentPriority",minimum_liquidity_usd_micros::text AS "minimumLiquidityUsdMicros",
    minimum_gross_trade_usd_micros::text AS "minimumGrossTradeUsdMicros",
    maximum_gross_trade_usd_micros::text AS "maximumGrossTradeUsdMicros",
    maximum_price_age_seconds AS "maximumPriceAgeSeconds",
    maximum_price_deviation_bps AS "maximumPriceDeviationBps",created_at AS "createdAt",updated_at AS "updatedAt"
    FROM sponsorship_payment_tokens`

export const sponsorshipAdminRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', async (request) => requireLocalAdmin(request))

    app.get('/admin/sponsorship/tokens', (request, reply) => safe(async () => {
        const result = await getPool().query(`${tokenSelect} ORDER BY payment_priority DESC,token_address`)
        return { tokens: result.rows }
    }, reply))

    app.post<{ Body: unknown }>('/admin/sponsorship/tokens', (request, reply) => safe(async () => {
        const body = exactObject(request.body, [
            'address', 'symbol', 'decimals', 'enabled', 'feePaymentEnabled',
            'approvalSponsorshipEnabled', 'normalSwapSponsorshipEnabled',
            'isStablecoin', 'priority', 'minimumLiquidityUsd', 'minimumGrossTradeUsd',
            'maximumGrossTradeUsd', 'maximumPriceAgeSeconds', 'maximumPriceDeviationBps',
        ], ['address', 'symbol', 'decimals'])
        const token = address(body.address)
        const symbol = String(body.symbol ?? '').trim().toUpperCase()
        if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) {
            throw new GasAssistError('INVALID_REQUEST', 'Token symbol is invalid.')
        }
        const decimals = integer(body.decimals, 'decimals', 0, 36)
        const config = getApiConfig().sponsorship
        const enabled = body.enabled === undefined ? true : boolean(body.enabled, 'enabled')
        await verifyContract(token, decimals)
        await getPool().query(
            `INSERT INTO sponsorship_payment_tokens
             (chain_id,token_address,symbol,decimals,enabled,fee_payment_enabled,
              approval_sponsorship_enabled,normal_swap_sponsorship_enabled,is_stablecoin,
              payment_priority,minimum_liquidity_usd_micros,minimum_gross_trade_usd_micros,
              maximum_gross_trade_usd_micros,maximum_price_age_seconds,maximum_price_deviation_bps,
              exact_transfer_required,fee_on_transfer_allowed,rebasing_allowed,strict_security_required)
             VALUES (56,$1,$2,$3,false,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,false,false,false)
             ON CONFLICT (chain_id,token_address) DO NOTHING`,
            [
                token,
                symbol,
                decimals,
                body.feePaymentEnabled === undefined ? true : boolean(body.feePaymentEnabled, 'feePaymentEnabled'),
                body.approvalSponsorshipEnabled === undefined ? true : boolean(body.approvalSponsorshipEnabled, 'approvalSponsorshipEnabled'),
                body.normalSwapSponsorshipEnabled === undefined ? false : boolean(body.normalSwapSponsorshipEnabled, 'normalSwapSponsorshipEnabled'),
                body.isStablecoin === undefined ? false : boolean(body.isStablecoin, 'isStablecoin'),
                body.priority === undefined ? 0 : integer(body.priority, 'priority', -10_000, 10_000),
                parseFixed(String(body.minimumLiquidityUsd ?? config.minimumPaymentTokenLiquidityUsd)).toString(),
                parseFixed(String(body.minimumGrossTradeUsd ?? config.minimumGrossTradeUsd)).toString(),
                body.maximumGrossTradeUsd === undefined || body.maximumGrossTradeUsd === null
                    ? null
                    : parseFixed(String(body.maximumGrossTradeUsd)).toString(),
                body.maximumPriceAgeSeconds === undefined
                    ? config.maximumPriceAgeSeconds
                    : integer(body.maximumPriceAgeSeconds, 'maximumPriceAgeSeconds', 1, 3_600),
                body.maximumPriceDeviationBps === undefined
                    ? config.maximumPriceDeviationBps
                    : integer(body.maximumPriceDeviationBps, 'maximumPriceDeviationBps', 0, 10_000),
            ],
        )
        if (enabled) {
            await syncToken(token)
            await getPool().query(
                `UPDATE sponsorship_payment_tokens SET enabled=true,updated_at=now()
                 WHERE chain_id=56 AND token_address=$1`,
                [token],
            )
        }
        request.log.info({ subsystem: 'sponsorship-admin', action: 'token-add', token }, 'Sponsorship token added')
        const result = await getPool().query(`${tokenSelect} WHERE chain_id=56 AND token_address=$1`, [token])
        return reply.code(201).send({ token: result.rows[0] })
    }, reply))

    app.patch<{ Params: { address: string }; Body: unknown }>(
        '/admin/sponsorship/tokens/:address',
        (request, reply) => safe(async () => {
            const token = address(request.params.address)
            const body = exactObject(request.body, [
                'enabled', 'feePaymentEnabled', 'approvalSponsorshipEnabled',
                'normalSwapSponsorshipEnabled', 'isStablecoin', 'priority',
                'minimumLiquidityUsd', 'minimumGrossTradeUsd', 'maximumGrossTradeUsd',
                'maximumPriceAgeSeconds', 'maximumPriceDeviationBps',
            ])
            const current = await getPool().query<{ decimals: number; enabled: boolean }>(
                `SELECT decimals,enabled FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1`,
                [token],
            )
            if (!current.rows[0]) throw new GasAssistError('TOKEN_NOT_FOUND', 'Sponsorship token was not found.', 404)
            if (body.enabled === true && !current.rows[0].enabled) {
                await verifyContract(token, current.rows[0].decimals)
                await syncToken(token)
            }
            const updates: string[] = []
            const values: unknown[] = [token]
            const set = (column: string, value: unknown) => {
                values.push(value)
                updates.push(`${column}=$${values.length}`)
            }
            if (body.enabled !== undefined) set('enabled', boolean(body.enabled, 'enabled'))
            if (body.feePaymentEnabled !== undefined) set('fee_payment_enabled', boolean(body.feePaymentEnabled, 'feePaymentEnabled'))
            if (body.approvalSponsorshipEnabled !== undefined) set('approval_sponsorship_enabled', boolean(body.approvalSponsorshipEnabled, 'approvalSponsorshipEnabled'))
            if (body.normalSwapSponsorshipEnabled !== undefined) set('normal_swap_sponsorship_enabled', boolean(body.normalSwapSponsorshipEnabled, 'normalSwapSponsorshipEnabled'))
            if (body.isStablecoin !== undefined) set('is_stablecoin', boolean(body.isStablecoin, 'isStablecoin'))
            if (body.priority !== undefined) set('payment_priority', integer(body.priority, 'priority', -10_000, 10_000))
            if (body.minimumLiquidityUsd !== undefined) set('minimum_liquidity_usd_micros', parseFixed(String(body.minimumLiquidityUsd)).toString())
            if (body.minimumGrossTradeUsd !== undefined) set('minimum_gross_trade_usd_micros', parseFixed(String(body.minimumGrossTradeUsd)).toString())
            if (body.maximumGrossTradeUsd !== undefined) set('maximum_gross_trade_usd_micros', body.maximumGrossTradeUsd === null ? null : parseFixed(String(body.maximumGrossTradeUsd)).toString())
            if (body.maximumPriceAgeSeconds !== undefined) set('maximum_price_age_seconds', integer(body.maximumPriceAgeSeconds, 'maximumPriceAgeSeconds', 1, 3_600))
            if (body.maximumPriceDeviationBps !== undefined) set('maximum_price_deviation_bps', integer(body.maximumPriceDeviationBps, 'maximumPriceDeviationBps', 0, 10_000))
            if (updates.length === 0) throw new GasAssistError('INVALID_REQUEST', 'No supported update fields were supplied.')
            const result = await getPool().query(
                `UPDATE sponsorship_payment_tokens SET ${updates.join(',')},updated_at=now()
                 WHERE chain_id=56 AND token_address=$1`,
                values,
            )
            if (!result.rowCount) throw new GasAssistError('TOKEN_NOT_FOUND', 'Sponsorship token was not found.', 404)
            request.log.info({ subsystem: 'sponsorship-admin', action: 'token-update', token }, 'Sponsorship token updated')
            const refreshed = await getPool().query(`${tokenSelect} WHERE chain_id=56 AND token_address=$1`, [token])
            return { token: refreshed.rows[0] }
        }, reply),
    )

    app.delete<{ Params: { address: string } }>(
        '/admin/sponsorship/tokens/:address',
        (request, reply) => safe(async () => {
            const token = address(request.params.address)
            const row = await getPool().query<{ enabled: boolean }>(
                `SELECT enabled FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1`,
                [token],
            )
            if (!row.rows[0]) throw new GasAssistError('TOKEN_NOT_FOUND', 'Sponsorship token was not found.', 404)
            if (row.rows[0].enabled) {
                throw new GasAssistError('TOKEN_MUST_BE_DISABLED', 'Disable the token before removing it.', 409)
            }
            await megaFuelPolicyManagement.remove('ToAccountWhitelist', [token])
            await getPool().query(
                `DELETE FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1 AND enabled=false`,
                [token],
            )
            request.log.info({ subsystem: 'sponsorship-admin', action: 'token-remove', token }, 'Sponsorship token removed')
            return reply.code(204).send()
        }, reply),
    )

    app.post('/admin/sponsorship/tokens/sync', (request, reply) => safe(async () => {
        const result = await getPool().query<{ tokenAddress: Address }>(
            `SELECT token_address AS "tokenAddress" FROM sponsorship_payment_tokens
             WHERE chain_id=56 AND enabled=true ORDER BY token_address`,
        )
        await syncBasePolicy()
        if (result.rows.length > 0) {
            await megaFuelPolicyManagement.add(
                'ToAccountWhitelist',
                result.rows.map((row) => row.tokenAddress),
            )
        }
        request.log.info({ subsystem: 'sponsorship-admin', action: 'policy-sync', tokenCount: result.rows.length }, 'MegaFuel policy synchronized')
        return { synchronized: true, tokenCount: result.rows.length }
    }, reply))
}
