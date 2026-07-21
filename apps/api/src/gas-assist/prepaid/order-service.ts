import type { Pool, PoolClient } from 'pg'
import type { Address, Hex } from 'viem'
import { isAddressEqual, zeroAddress } from 'viem'

import { getApiConfig } from '../../config.js'
import { getPool } from '../../db/client.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import { getNativeBnbPrice, getTokenPrices } from '../../providers/alchemy/token-prices.js'
import { GasAssistError } from '../errors.js'
import { buildExactApproval } from '../exact-approval.js'
import { hashPrivateScope } from '../exact-approval.js'
import { buildPaymentTransfer, createPrepaidChainClient } from './chain-client.js'
import {
    getExactSponsoredQuote,
    quoteGasLimit,
    type ExactSponsoredQuote,
} from './normal-swap.js'
import {
    calculatePrepayment,
    formatFixed,
    parseFixed,
    tokenRawToUsdMicrosFloor,
    usdMicrosToTokenRawCeil,
    type PrepaymentCalculation,
} from './fixed-point.js'
import {
    selectPaymentToken,
    type PaymentTokenCandidate,
} from './payment-token-selection.js'
import { getSponsorshipTokenEvidence } from './token-evidence.js'

export type CreateSponsorshipOrderInput = {
    sellToken: string
    buyToken: string
    grossInputAmount: string
    slippageBps: number
}

type PaymentTokenRow = {
    id: string
    chainId: number
    tokenAddress: string
    symbol: string
    decimals: number
    enabled: boolean
    feePaymentEnabled: boolean
    approvalSponsorshipEnabled: boolean
    normalSwapSponsorshipEnabled: boolean
    isStablecoin: boolean
    paymentPriority: number
    minimumLiquidityUsdMicros: string
    minimumGrossTradeUsdMicros: string
    maximumGrossTradeUsdMicros: string | null
    maximumPriceAgeSeconds: number
    maximumPriceDeviationBps: number
    exactTransferRequired: boolean
    feeOnTransferAllowed: boolean
    rebasingAllowed: boolean
    strictSecurityRequired: boolean
}

type GasEstimate = {
    gasLimit: bigint
    currentGasPrice: bigint
    gasUsdMicros: bigint
    observedAt: Date
}

type Dependencies = {
    database: Pool
    now: () => Date
    getBalance(token: Address, wallet: Address): Promise<bigint>
    getDecimals(token: Address): Promise<number>
    getPrice(token: string): Promise<{ priceUsdMicros: bigint; observedAt: Date }>
    getEvidence: typeof getSponsorshipTokenEvidence
    quoteNormal(input: {
        wallet: Address
        sellToken: Address
        buyToken: string
        sellAmount: bigint
        sellTokenDecimals: number
        buyTokenDecimals: number
        slippageBps: number
    }): Promise<ExactSponsoredQuote>
    estimateAction(input: {
        wallet: Address
        to: Address
        data: Hex
        value?: bigint
        maximumGas: bigint
    }): Promise<GasEstimate>
    priceGasLimit(gasLimit: bigint, maximumGas: bigint): Promise<GasEstimate>
    getAllowance(token: Address, owner: Address, spender: Address): Promise<bigint>
}

function defaultDependencies(database: Pool): Dependencies {
    const chain = createPrepaidChainClient()
    return {
        database,
        now: () => new Date(),
        getBalance: chain.getBalance,
        getDecimals: chain.getTokenDecimals,
        async getPrice(token) {
            const price = token === NATIVE_TOKEN_ADDRESS
                ? await getNativeBnbPrice()
                : (await getTokenPrices({ addresses: [token] })).get(token) ?? null
            if (!price) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'A trusted token price is unavailable.', 503)
            return { priceUsdMicros: parseFixed(price), observedAt: new Date() }
        },
        getEvidence: getSponsorshipTokenEvidence,
        quoteNormal: getExactSponsoredQuote,
        estimateAction: chain.estimateSponsoredAction,
        priceGasLimit: chain.priceGasLimit,
        getAllowance: chain.getAllowance,
    }
}

function positiveRaw(value: unknown) {
    const normalized = String(value ?? '')
    if (!/^[1-9]\d*$/.test(normalized)) {
        throw new GasAssistError('INVALID_AMOUNT', 'grossInputAmount must be a positive raw integer string.')
    }
    return BigInt(normalized)
}

function normalizeInput(input: CreateSponsorshipOrderInput) {
    const sellToken = normalizeAddress(input.sellToken)
    const buyToken = input.buyToken === 'native'
        ? NATIVE_TOKEN_ADDRESS
        : normalizeAddress(input.buyToken)
    if (!sellToken || sellToken === zeroAddress || sellToken === NATIVE_TOKEN_ADDRESS) {
        throw new GasAssistError('INVALID_SELL_TOKEN', 'A valid BEP-20 sell token is required.')
    }
    if (!buyToken || sellToken === buyToken) {
        throw new GasAssistError('INVALID_BUY_TOKEN', 'A different BEP-20 or native buy token is required.')
    }
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 30 || input.slippageBps > 10_000) {
        throw new GasAssistError('INVALID_SLIPPAGE', 'slippageBps must be between 30 and 10000.')
    }
    return {
        sellToken,
        buyToken,
        grossInputAmount: positiveRaw(input.grossInputAmount),
        slippageBps: input.slippageBps,
    }
}

async function loadPaymentTokens(database: Pool | PoolClient) {
    const result = await database.query<PaymentTokenRow>(
        `SELECT id,chain_id AS "chainId",token_address AS "tokenAddress",symbol,decimals,enabled,
                fee_payment_enabled AS "feePaymentEnabled",
                approval_sponsorship_enabled AS "approvalSponsorshipEnabled",
                normal_swap_sponsorship_enabled AS "normalSwapSponsorshipEnabled",
                is_stablecoin AS "isStablecoin",payment_priority AS "paymentPriority",
                minimum_liquidity_usd_micros::text AS "minimumLiquidityUsdMicros",
                minimum_gross_trade_usd_micros::text AS "minimumGrossTradeUsdMicros",
                maximum_gross_trade_usd_micros::text AS "maximumGrossTradeUsdMicros",
                maximum_price_age_seconds AS "maximumPriceAgeSeconds",
                maximum_price_deviation_bps AS "maximumPriceDeviationBps",
                exact_transfer_required AS "exactTransferRequired",
                fee_on_transfer_allowed AS "feeOnTransferAllowed",
                rebasing_allowed AS "rebasingAllowed",
                strict_security_required AS "strictSecurityRequired"
         FROM sponsorship_payment_tokens WHERE chain_id=56 AND enabled=true`,
    )
    return result.rows
}

function assertSafeZeroXSpender(spenderValue: string) {
    const config = getApiConfig().sponsorship
    const spender = normalizeAddress(spenderValue)
    if (!spender || !config.zeroXSafeApprovalTargets.has(spender) ||
        config.zeroXSettlerAddress === spender) {
        throw new GasAssistError('UNSAFE_APPROVAL_TARGET', '0x returned an approval target that is not approved for sponsorship.', 409)
    }
    return spender as Address
}

async function estimateTokenToBnbConversionCost({
    dependencies,
    token,
    tokenDecimals,
    tokenPriceUsdMicros,
    amountRaw,
}: {
    dependencies: Dependencies
    token: Address
    tokenDecimals: number
    tokenPriceUsdMicros: bigint
    amountRaw: bigint
}) {
    const config = getApiConfig()
    const treasury = config.fees.treasuryAddress as Address | null
    if (!treasury) throw new GasAssistError('TREASURY_NOT_CONFIGURED', 'The treasury is not configured.', 503)
    const bnbPrice = await dependencies.getPrice(NATIVE_TOKEN_ADDRESS)
    const quote = await dependencies.quoteNormal({
        wallet: treasury,
        sellToken: token,
        buyToken: NATIVE_TOKEN_ADDRESS,
        sellAmount: amountRaw,
        sellTokenDecimals: tokenDecimals,
        buyTokenDecimals: 18,
        slippageBps: 100,
    })
    const swapGas = await dependencies.priceGasLimit(
        quoteGasLimit(quote),
        BigInt(config.sponsorship.maximumSwapGas),
    )
    const allowance = await dependencies.getAllowance(token, treasury, quote.allowanceTarget)
    const approvalGas = allowance >= amountRaw
        ? null
        : await dependencies.estimateAction({
              wallet: treasury,
              to: token,
              data: buildExactApproval(quote.allowanceTarget, amountRaw),
              maximumGas: BigInt(config.sponsorship.maximumApprovalGas),
          })
    const inputUsd = tokenRawToUsdMicrosFloor({
        amountRaw,
        tokenPriceUsdMicros,
        tokenDecimals,
    })
    const outputUsd = tokenRawToUsdMicrosFloor({
        amountRaw: BigInt(quote.buyAmount),
        tokenPriceUsdMicros: bnbPrice.priceUsdMicros,
        tokenDecimals: 18,
    })
    const routeLossUsdMicros = inputUsd > outputUsd ? inputUsd - outputUsd : 0n
    return {
        costUsdMicros: routeLossUsdMicros + swapGas.gasUsdMicros + (approvalGas?.gasUsdMicros ?? 0n),
        quote,
        swapGas,
        approvalGas,
    }
}

async function publicOrder(database: Pool | PoolClient, orderId: string, walletAddress: string) {
    const result = await database.query<Record<string, unknown>>(
        `SELECT id,status,wallet_address AS "walletAddress",chain_id AS "chainId",sell_token AS "sellToken",
                CASE WHEN buy_token=$3 THEN 'native' ELSE buy_token END AS "buyToken",
                gross_input_amount_raw::text AS "grossInputAmountRaw",net_swap_amount_raw::text AS "netSwapAmountRaw",
                payment_token AS "paymentToken",payment_token_reason AS "paymentTokenReason",
                (SELECT symbol FROM sponsorship_payment_tokens p
                 WHERE p.chain_id=56 AND p.token_address=sponsorship_orders.payment_token) AS "paymentTokenSymbol",
                payment_amount_raw::text AS "paymentAmountRaw",payment_token_decimals AS "paymentTokenDecimals",
                trade_notional_usd_micros::text AS "tradeNotionalUsdMicros",
                fixed_service_fee_usd_micros::text AS "fixedServiceFeeUsdMicros",
                platform_fee_usd_micros::text AS "platformFeeUsdMicros",
                commercial_fee_usd_micros::text AS "commercialFeeUsdMicros",
                gas_reserve_usd_micros::text AS "gasReserveUsdMicros",
                conversion_cost_usd_micros::text AS "conversionCostUsdMicros",
                total_prepayment_usd_micros::text AS "totalPrepaymentUsdMicros",
                estimated_payment_gas_usd_micros::text AS "estimatedPaymentGasUsdMicros",
                estimated_approval_gas_usd_micros::text AS "estimatedApprovalGasUsdMicros",
                estimated_swap_gas_usd_micros::text AS "estimatedSwapGasUsdMicros",
                gas_multiplier_bps AS "gasMultiplierBps",quote_provider AS "quoteProvider",
                provider_fees AS "providerFees",expected_output_raw::text AS "expectedOutputRaw",
                minimum_output_raw::text AS "minimumOutputRaw",requires_approval AS "requiresApproval",
                approval_spender AS "approvalSpender",approval_amount_raw::text AS "approvalAmountRaw",
                sponsored_flow AS "sponsoredFlow",billing_mode AS "billingMode",expires_at AS "expiresAt",
                payment_quote_expires_at AS "paymentQuoteExpiresAt",grant_expires_at AS "grantExpiresAt",
                fee_confirmed_at AS "feeConfirmedAt",
                payment_transaction_hash AS "paymentTransactionHash",
                approval_transaction_hash AS "approvalTransactionHash",swap_transaction_hash AS "swapTransactionHash",
                rejection_code AS "safeErrorCode",created_at AS "createdAt"
         FROM sponsorship_orders WHERE id=$1 AND wallet_address=$2`,
        [orderId, walletAddress, NATIVE_TOKEN_ADDRESS],
    )
    return result.rows[0] ?? null
}

async function reserveAndInsertOrder({
    database,
    walletAddress,
    ipHash,
    idempotencyKey,
    values,
}: {
    database: Pool
    walletAddress: string
    ipHash: string
    idempotencyKey: string
    values: unknown[]
}) {
    const config = getApiConfig().sponsorship
    const client = await database.connect()
    try {
        await client.query('BEGIN')
        const existing = await client.query<{ id: string; walletAddress: string }>(
            `SELECT id,wallet_address AS "walletAddress" FROM sponsorship_orders WHERE idempotency_key=$1 FOR UPDATE`,
            [idempotencyKey],
        )
        if (existing.rows[0]) {
            if (existing.rows[0].walletAddress !== walletAddress) {
                throw new GasAssistError('IDEMPOTENCY_KEY_CONFLICT', 'The idempotency key belongs to another wallet.', 409)
            }
            await client.query('COMMIT')
            return existing.rows[0].id
        }
        for (const scope of ['global', walletAddress, ipHash].sort()) {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope])
        }
        const limits = await client.query<{
            activeOrders: string
            walletOrders: string
            ipOrders: string
            globalOrders: string
            walletGas: string
            globalGas: string
            lastOrderAt: Date | null
            failedPayments: string
            repeatedReverts: string
            repeatedExpiries: string
            signatureMismatches: string
        }>(
            `SELECT
               (SELECT count(*) FROM sponsorship_orders WHERE wallet_address=$1 AND status NOT IN ('completed','expired','rejected','failed'))::text AS "activeOrders",
               COALESCE((SELECT order_count FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "walletOrders",
               COALESCE((SELECT order_count FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='ip' AND scope_hash=$2),0)::text AS "ipOrders",
               COALESCE((SELECT order_count FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='global' AND scope_hash='global'),0)::text AS "globalOrders",
               COALESCE((SELECT sponsored_gas_usd_micros FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "walletGas",
               COALESCE((SELECT sponsored_gas_usd_micros FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='global' AND scope_hash='global'),0)::text AS "globalGas",
               (SELECT max(created_at) FROM sponsorship_orders WHERE wallet_address=$1) AS "lastOrderAt",
               COALESCE((SELECT failed_payment_attempts FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "failedPayments",
               COALESCE((SELECT reverted_attempts FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "repeatedReverts",
               COALESCE((SELECT expired_attempts FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "repeatedExpiries",
               COALESCE((SELECT signature_mismatch_attempts FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "signatureMismatches"`,
            [walletAddress, ipHash],
        )
        const usage = limits.rows[0]!
        if (BigInt(usage.activeOrders) > 0n) throw new GasAssistError('ACTIVE_ORDER_EXISTS', 'This wallet already has an active sponsorship order.', 409)
        if (BigInt(usage.walletOrders) >= BigInt(config.walletDailyOrderLimit)) throw new GasAssistError('WALLET_DAILY_LIMIT', 'The wallet daily sponsorship limit has been reached.', 429)
        if (BigInt(usage.ipOrders) >= BigInt(config.ipDailyOrderLimit)) throw new GasAssistError('IP_DAILY_LIMIT', 'The network daily sponsorship limit has been reached.', 429)
        if (BigInt(usage.globalOrders) >= BigInt(config.globalDailyOrderLimit)) throw new GasAssistError('GLOBAL_DAILY_LIMIT', 'Gas Assist is at its daily order capacity.', 429)
        if (BigInt(usage.walletGas) >= parseFixed(config.walletDailyGasUsd)) throw new GasAssistError('WALLET_GAS_BUDGET', 'The wallet daily sponsored gas budget has been reached.', 429)
        if (BigInt(usage.globalGas) >= parseFixed(config.globalDailyGasUsd)) throw new GasAssistError('GLOBAL_GAS_BUDGET', 'Gas Assist is at its daily gas capacity.', 429)
        if (usage.lastOrderAt && Date.now() - usage.lastOrderAt.getTime() < config.walletCooldownSeconds * 1_000) {
            throw new GasAssistError('WALLET_COOLDOWN', 'Wait before creating another sponsorship order.', 429)
        }
        if (BigInt(usage.failedPayments) >= BigInt(config.maximumUnpaidPaymentAttempts) ||
            BigInt(usage.repeatedReverts) >= BigInt(config.maximumRepeatedReverts) ||
            BigInt(usage.repeatedExpiries) >= BigInt(config.maximumRepeatedExpiries) ||
            BigInt(usage.signatureMismatches) >= BigInt(config.maximumSignatureMismatches)) {
            throw new GasAssistError('SPONSORSHIP_ABUSE_BLOCKED', 'This wallet is temporarily ineligible for sponsorship.', 429)
        }
        const inserted = await client.query<{ id: string }>(
            `INSERT INTO sponsorship_orders
             (status,wallet_address,chain_id,sell_token,buy_token,gross_input_amount_raw,net_swap_amount_raw,
              payment_token,payment_token_reason,payment_amount_raw,payment_token_decimals,
              trade_notional_usd_micros,fixed_service_fee_usd_micros,platform_fee_usd_micros,
              commercial_fee_usd_micros,gas_reserve_usd_micros,conversion_cost_usd_micros,total_prepayment_usd_micros,
              estimated_payment_gas_usd_micros,estimated_approval_gas_usd_micros,estimated_swap_gas_usd_micros,
              gas_multiplier_bps,quote_provider,provider_quote_id,provider_quote_expires_at,provider_quote_snapshot,
              provider_fees,expected_output_raw,minimum_output_raw,requires_approval,approval_spender,
              approval_amount_raw,sponsored_flow,billing_mode,expires_at,idempotency_key,ip_hash)
             VALUES ('quoted',$1,56,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                     $20,$21,$22,$23,$24::jsonb,$25::jsonb,$26,$27,true,$28,$29,
                      'normal-sponsored-swap','prepaid-megafuel',$30,$31,$32)
             RETURNING id`,
            values,
        )
        for (const [scopeType, scopeHash] of [['wallet', walletAddress], ['ip', ipHash], ['global', 'global']]) {
            await client.query(
                `INSERT INTO sponsorship_usage (usage_date,chain_id,scope_type,scope_hash,order_count)
                 VALUES ((now() at time zone 'utc')::date,56,$1,$2,1)
                 ON CONFLICT (usage_date,chain_id,scope_type,scope_hash)
                 DO UPDATE SET order_count=sponsorship_usage.order_count+1,updated_at=now()`,
                [scopeType, scopeHash],
            )
        }
        await client.query('COMMIT')
        return inserted.rows[0]!.id
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

export function createSponsorshipOrderService(overrides: Partial<Dependencies> = {}) {
    const dependencies = {
        ...defaultDependencies(overrides.database ?? getPool()),
        ...overrides,
    }

    async function create({
        input: raw,
        walletAddress: walletValue,
        clientIp,
        idempotencyKey,
    }: {
        input: CreateSponsorshipOrderInput
        walletAddress: string
        clientIp: string
        idempotencyKey: string
    }) {
        const config = getApiConfig()
        if (!config.sponsorship.enabled || config.sponsorship.emergencyDisabled) {
            throw new GasAssistError('SPONSORSHIP_DISABLED', 'Prepaid Gas Assist is disabled.', 503)
        }
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
            throw new GasAssistError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.')
        }
        const walletAddress = normalizeAddress(walletValue) as Address | null
        if (!walletAddress) throw new GasAssistError('INVALID_WALLET', 'The authenticated wallet is invalid.')
        const existingOrder = await dependencies.database.query<{ id: string; walletAddress: string }>(
            `SELECT id,wallet_address AS "walletAddress" FROM sponsorship_orders WHERE idempotency_key=$1`,
            [idempotencyKey],
        )
        if (existingOrder.rows[0]) {
            if (existingOrder.rows[0].walletAddress !== walletAddress) {
                throw new GasAssistError('IDEMPOTENCY_KEY_CONFLICT', 'The idempotency key belongs to another wallet.', 409)
            }
            return publicOrder(dependencies.database, existingOrder.rows[0].id, walletAddress)
        }
        const input = normalizeInput(raw)
        const grossBalance = await dependencies.getBalance(input.sellToken as Address, walletAddress)
        if (grossBalance < input.grossInputAmount) {
            throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', 'The wallet balance cannot cover the gross amount.')
        }

        const [rows, sellDecimals, sellPrice] = await Promise.all([
            loadPaymentTokens(dependencies.database),
            dependencies.getDecimals(input.sellToken as Address),
            dependencies.getPrice(input.sellToken),
        ])
        const sellRule = rows.find((row) => row.tokenAddress === input.sellToken)
        if (!sellRule || !sellRule.approvalSponsorshipEnabled || !sellRule.normalSwapSponsorshipEnabled) {
            throw new GasAssistError('SELL_TOKEN_NOT_WHITELISTED', 'The sell token is not enabled for exact approval and swap sponsorship.', 403)
        }
        if (sellDecimals !== sellRule.decimals) {
            throw new GasAssistError('PAYMENT_TOKEN_DECIMALS_MISMATCH', 'Sell-token decimals do not match the sponsorship whitelist.', 409)
        }
        const tradeNotionalUsdMicros = tokenRawToUsdMicrosFloor({
            amountRaw: input.grossInputAmount,
            tokenPriceUsdMicros: sellPrice.priceUsdMicros,
            tokenDecimals: sellDecimals,
        })
        if (tradeNotionalUsdMicros < parseFixed(config.sponsorship.minimumGrossTradeUsd) ||
            tradeNotionalUsdMicros < BigInt(sellRule.minimumGrossTradeUsdMicros) ||
            sellRule.maximumGrossTradeUsdMicros !== null && tradeNotionalUsdMicros > BigInt(sellRule.maximumGrossTradeUsdMicros)) {
            throw new GasAssistError('GROSS_TRADE_VALUE_UNECONOMIC', 'The gross trade value is outside the sponsored range.')
        }

        if (!config.sponsorship.normalSwapSponsorEnabled) {
            throw new GasAssistError('NORMAL_SWAP_SPONSORSHIP_DISABLED', 'Exact MegaFuel swap sponsorship is disabled.', 503)
        }
        const buyDecimals = input.buyToken === NATIVE_TOKEN_ADDRESS
            ? 18
            : await dependencies.getDecimals(input.buyToken as Address)
        const initialQuote = await dependencies.quoteNormal({
            wallet: walletAddress,
            sellToken: input.sellToken as Address,
            buyToken: input.buyToken,
            sellAmount: input.grossInputAmount,
            sellTokenDecimals: sellDecimals,
            buyTokenDecimals: buyDecimals,
            slippageBps: input.slippageBps,
        })
        const spender = initialQuote.allowanceTarget
        const [approvalEstimate, initialSwapEstimate] = await Promise.all([
            dependencies.estimateAction({
                wallet: walletAddress,
                to: input.sellToken as Address,
                data: buildExactApproval(spender, input.grossInputAmount),
                maximumGas: BigInt(config.sponsorship.maximumApprovalGas),
            }),
            dependencies.priceGasLimit(
                quoteGasLimit(initialQuote),
                BigInt(config.sponsorship.maximumSwapGas),
            ),
        ])

        const evidenceRows = await Promise.all(rows.filter((row) => row.feePaymentEnabled).map(async (row) => {
            const address = row.tokenAddress as Address
            const [onchainDecimals, balanceRaw, evidence] = await Promise.all([
                dependencies.getDecimals(address),
                dependencies.getBalance(address, walletAddress),
                dependencies.getEvidence(address),
            ])
            if (!evidence.priceUsdMicros || evidence.priceDeviationBps === null) return null
            const paymentEstimate = await dependencies.estimateAction({
                wallet: walletAddress,
                to: address,
                data: buildPaymentTransfer(config.fees.treasuryAddress as Address, 1n),
                maximumGas: BigInt(config.sponsorship.maximumPaymentTransferGas),
            }).catch(() => null)
            if (!paymentEstimate) return null
            const calculation = calculatePrepayment({
                tradeNotionalUsdMicros,
                paymentTransferGasUsdMicros: paymentEstimate.gasUsdMicros,
                approvalGasUsdMicros: approvalEstimate.gasUsdMicros,
                normalSwapGasUsdMicros: initialSwapEstimate.gasUsdMicros,
                flow: 'normal-sponsored-swap',
                gasMultiplierBps: config.sponsorship.gasMultiplierBps,
                fixedFeeUsdMicros: parseFixed(config.sponsorship.fixedFeeUsd),
                platformFeeBps: config.sponsorship.platformFeeBps,
                commercialFeeCapUsdMicros: parseFixed(config.sponsorship.commercialFeeCapUsd),
            })
            const requiredPaymentRaw = usdMicrosToTokenRawCeil({
                usdMicros: calculation.totalPrepaymentUsdMicros,
                tokenPriceUsdMicros: evidence.priceUsdMicros,
                tokenDecimals: row.decimals,
            })
            return {
                row,
                evidence,
                onchainDecimals,
                balanceRaw,
                paymentEstimate,
                calculation,
                requiredPaymentRaw,
            }
        }))
        const available = evidenceRows.filter((value): value is NonNullable<typeof value> => value !== null)
        const requiredPaymentRawByToken = new Map(available.map((value) => [value.row.tokenAddress, value.requiredPaymentRaw]))
        const selection = selectPaymentToken({
            candidates: available.map(({ row, evidence, onchainDecimals, balanceRaw }) => ({
                chainId: row.chainId,
                tokenAddress: row.tokenAddress,
                symbol: row.symbol,
                decimals: row.decimals,
                onchainDecimals,
                enabled: row.enabled,
                feePaymentEnabled: row.feePaymentEnabled,
                isStablecoin: row.isStablecoin,
                paymentPriority: row.paymentPriority,
                minimumLiquidityUsdMicros: BigInt(row.minimumLiquidityUsdMicros),
                maximumPriceAgeSeconds: Math.min(row.maximumPriceAgeSeconds, config.sponsorship.maximumPriceAgeSeconds),
                maximumPriceDeviationBps: Math.min(row.maximumPriceDeviationBps, config.sponsorship.maximumPriceDeviationBps),
                exactTransferRequired: row.exactTransferRequired,
                feeOnTransferAllowed: row.feeOnTransferAllowed,
                rebasingAllowed: row.rebasingAllowed,
                strictSecurityRequired: row.strictSecurityRequired,
                priceUsdMicros: evidence.priceUsdMicros!,
                priceObservedAt: evidence.priceObservedAt,
                priceDeviationBps: evidence.priceDeviationBps!,
                liquidityUsdMicros: evidence.liquidityUsdMicros,
                balanceRaw,
                transferBehavior: evidence.transferBehavior,
                securityStatus: evidence.securityStatus,
            } satisfies PaymentTokenCandidate)),
            requiredPaymentRawByToken,
            sellToken: input.sellToken,
            buyToken: input.buyToken,
            now: dependencies.now(),
            configuredMinimumLiquidityUsdMicros: parseFixed(config.sponsorship.minimumPaymentTokenLiquidityUsd),
        })
        if (!selection.selection) {
            throw new GasAssistError('NO_ELIGIBLE_PAYMENT_TOKEN', 'No owned whitelisted token can safely pay the sponsorship charge.', 409)
        }
        const selected = available.find((value) => value.row.tokenAddress === selection.selection!.candidate.tokenAddress)!

        let paymentAmountRaw = selected.requiredPaymentRaw
        let calculation: PrepaymentCalculation = selected.calculation
        let netSwapAmountRaw = input.grossInputAmount
        let finalQuote = initialQuote
        let finalPaymentEstimate = selected.paymentEstimate
        let finalApprovalEstimate = approvalEstimate
        let finalSwapEstimate = initialSwapEstimate
        let finalConversion = await estimateTokenToBnbConversionCost({
            dependencies,
            token: selected.row.tokenAddress as Address,
            tokenDecimals: selected.row.decimals,
            tokenPriceUsdMicros: selected.evidence.priceUsdMicros!,
            amountRaw: paymentAmountRaw,
        })
        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (selected.row.tokenAddress === input.sellToken) {
                if (paymentAmountRaw >= input.grossInputAmount) {
                    throw new GasAssistError('PAYMENT_EXCEEDS_GROSS_INPUT', 'The sponsorship payment leaves no positive swap amount.')
                }
                netSwapAmountRaw = input.grossInputAmount - paymentAmountRaw
            } else {
                netSwapAmountRaw = input.grossInputAmount
            }
            const netTradeUsdMicros = tokenRawToUsdMicrosFloor({
                amountRaw: netSwapAmountRaw,
                tokenPriceUsdMicros: sellPrice.priceUsdMicros,
                tokenDecimals: sellDecimals,
            })
            if (netTradeUsdMicros < parseFixed(config.sponsorship.minimumNetTradeUsd)) {
                throw new GasAssistError('NET_TRADE_VALUE_UNECONOMIC', 'The net trade value is below the sponsored minimum.')
            }
            const nextQuote = await dependencies.quoteNormal({
                wallet: walletAddress,
                sellToken: input.sellToken as Address,
                buyToken: input.buyToken,
                sellAmount: netSwapAmountRaw,
                sellTokenDecimals: sellDecimals,
                buyTokenDecimals: buyDecimals,
                slippageBps: input.slippageBps,
            })
            if (!isAddressEqual(nextQuote.allowanceTarget, spender)) {
                throw new GasAssistError('ROUTE_CHANGED', 'The authoritative 0x approval target changed during calculation.', 409)
            }
            finalQuote = nextQuote
            ;[finalPaymentEstimate, finalApprovalEstimate, finalSwapEstimate] = await Promise.all([
                dependencies.estimateAction({
                    wallet: walletAddress,
                    to: selected.row.tokenAddress as Address,
                    data: buildPaymentTransfer(config.fees.treasuryAddress as Address, paymentAmountRaw),
                    maximumGas: BigInt(config.sponsorship.maximumPaymentTransferGas),
                }),
                dependencies.estimateAction({
                    wallet: walletAddress,
                    to: input.sellToken as Address,
                    data: buildExactApproval(spender, netSwapAmountRaw),
                    maximumGas: BigInt(config.sponsorship.maximumApprovalGas),
                }),
                dependencies.priceGasLimit(
                    quoteGasLimit(nextQuote),
                    BigInt(config.sponsorship.maximumSwapGas),
                ),
            ])
            const withoutConversion = calculatePrepayment({
                tradeNotionalUsdMicros,
                paymentTransferGasUsdMicros: finalPaymentEstimate.gasUsdMicros,
                approvalGasUsdMicros: finalApprovalEstimate.gasUsdMicros,
                normalSwapGasUsdMicros: finalSwapEstimate.gasUsdMicros,
                conversionCostUsdMicros: 0n,
                flow: 'normal-sponsored-swap',
                gasMultiplierBps: config.sponsorship.gasMultiplierBps,
                fixedFeeUsdMicros: parseFixed(config.sponsorship.fixedFeeUsd),
                platformFeeBps: config.sponsorship.platformFeeBps,
                commercialFeeCapUsdMicros: parseFixed(config.sponsorship.commercialFeeCapUsd),
            })
            const preliminaryPayment = usdMicrosToTokenRawCeil({
                usdMicros: withoutConversion.totalPrepaymentUsdMicros,
                tokenPriceUsdMicros: selected.evidence.priceUsdMicros!,
                tokenDecimals: selected.row.decimals,
            })
            finalConversion = await estimateTokenToBnbConversionCost({
                dependencies,
                token: selected.row.tokenAddress as Address,
                tokenDecimals: selected.row.decimals,
                tokenPriceUsdMicros: selected.evidence.priceUsdMicros!,
                amountRaw: preliminaryPayment,
            })
            calculation = calculatePrepayment({
                tradeNotionalUsdMicros,
                paymentTransferGasUsdMicros: finalPaymentEstimate.gasUsdMicros,
                approvalGasUsdMicros: finalApprovalEstimate.gasUsdMicros,
                normalSwapGasUsdMicros: finalSwapEstimate.gasUsdMicros,
                conversionCostUsdMicros: finalConversion.costUsdMicros,
                flow: 'normal-sponsored-swap',
                gasMultiplierBps: config.sponsorship.gasMultiplierBps,
                fixedFeeUsdMicros: parseFixed(config.sponsorship.fixedFeeUsd),
                platformFeeBps: config.sponsorship.platformFeeBps,
                commercialFeeCapUsdMicros: parseFixed(config.sponsorship.commercialFeeCapUsd),
            })
            const recalculatedPayment = usdMicrosToTokenRawCeil({
                usdMicros: calculation.totalPrepaymentUsdMicros,
                tokenPriceUsdMicros: selected.evidence.priceUsdMicros!,
                tokenDecimals: selected.row.decimals,
            })
            if (recalculatedPayment === paymentAmountRaw) break
            paymentAmountRaw = recalculatedPayment
            if (attempt === 2) throw new GasAssistError('PAYMENT_CALCULATION_UNSTABLE', 'The exact sponsorship payment did not converge.', 409)
        }
        if (selected.balanceRaw < paymentAmountRaw) {
            throw new GasAssistError('INSUFFICIENT_PAYMENT_TOKEN_BALANCE', 'The selected payment-token balance is insufficient.')
        }
        if (calculation.commercialFeeUsdMicros <= finalPaymentEstimate.gasUsdMicros + parseFixed(config.sponsorship.minimumCommercialOverPaymentGasUsd)) {
            throw new GasAssistError('PAYMENT_TRANSFER_UNECONOMIC', 'The commercial payment is too small relative to payment gas.')
        }
        const buyPrice = await dependencies.getPrice(input.buyToken)
        const minimumOutputUsdMicros = tokenRawToUsdMicrosFloor({
            amountRaw: BigInt(finalQuote.minimumBuyAmount),
            tokenPriceUsdMicros: buyPrice.priceUsdMicros,
            tokenDecimals: buyDecimals,
        })
        if (minimumOutputUsdMicros < parseFixed(config.sponsorship.minimumOutputUsd)) {
            throw new GasAssistError('OUTPUT_VALUE_UNECONOMIC', 'The minimum output is below the sponsored minimum.')
        }
        const expiresAt = new Date(dependencies.now().getTime() + config.sponsorship.orderTtlSeconds * 1_000)
        const ipHash = hashPrivateScope(config.sponsorship.ipHashSecret!, clientIp)
        const orderId = await reserveAndInsertOrder({
            database: dependencies.database,
            walletAddress,
            ipHash,
            idempotencyKey,
            values: [
                walletAddress,
                input.sellToken,
                input.buyToken,
                input.grossInputAmount.toString(),
                netSwapAmountRaw.toString(),
                selected.row.tokenAddress,
                selection.selection.reason,
                paymentAmountRaw.toString(),
                selected.row.decimals,
                tradeNotionalUsdMicros.toString(),
                calculation.fixedServiceFeeUsdMicros.toString(),
                calculation.platformFeeUsdMicros.toString(),
                calculation.commercialFeeUsdMicros.toString(),
                calculation.gasReserveUsdMicros.toString(),
                calculation.conversionCostUsdMicros.toString(),
                calculation.totalPrepaymentUsdMicros.toString(),
                finalPaymentEstimate.gasUsdMicros.toString(),
                finalApprovalEstimate.gasUsdMicros.toString(),
                finalSwapEstimate.gasUsdMicros.toString(),
                config.sponsorship.gasMultiplierBps,
                finalQuote.provider,
                finalQuote.quoteId,
                finalQuote.expiresAt,
                JSON.stringify({
                    route: `${finalQuote.provider}-normal-sponsored-swap`,
                    slippageBps: input.slippageBps,
                    quote: {
                        provider: finalQuote.provider,
                        quoteId: finalQuote.quoteId,
                        expiresAt: finalQuote.expiresAt,
                        sellToken: finalQuote.sellToken,
                        buyToken: finalQuote.buyToken,
                        sellAmount: finalQuote.sellAmount,
                        buyAmount: finalQuote.buyAmount,
                        minimumBuyAmount: finalQuote.minimumBuyAmount,
                        allowanceTarget: finalQuote.allowanceTarget,
                        transaction: finalQuote.transaction,
                    },
                    paymentPriceUsdMicros: selected.evidence.priceUsdMicros!.toString(),
                    paymentPriceObservedAt: selected.evidence.priceObservedAt.toISOString(),
                    paymentLiquidityUsdMicros: selected.evidence.liquidityUsdMicros.toString(),
                    paymentPriceDeviationBps: selected.evidence.priceDeviationBps,
                    paymentGas: {
                        gasLimit: finalPaymentEstimate.gasLimit.toString(),
                        currentGasPrice: finalPaymentEstimate.currentGasPrice.toString(),
                        gasUsdMicros: finalPaymentEstimate.gasUsdMicros.toString(),
                        observedAt: finalPaymentEstimate.observedAt.toISOString(),
                    },
                    approvalGas: {
                        gasLimit: finalApprovalEstimate.gasLimit.toString(),
                        currentGasPrice: finalApprovalEstimate.currentGasPrice.toString(),
                        gasUsdMicros: finalApprovalEstimate.gasUsdMicros.toString(),
                        observedAt: finalApprovalEstimate.observedAt.toISOString(),
                    },
                    swapGas: {
                        gasLimit: finalSwapEstimate.gasLimit.toString(),
                        currentGasPrice: finalSwapEstimate.currentGasPrice.toString(),
                        gasUsdMicros: finalSwapEstimate.gasUsdMicros.toString(),
                        observedAt: finalSwapEstimate.observedAt.toISOString(),
                    },
                    conversion: {
                        costUsdMicros: finalConversion.costUsdMicros.toString(),
                        provider: finalConversion.quote.provider,
                        quoteId: finalConversion.quote.quoteId,
                        expiresAt: finalConversion.quote.expiresAt,
                        inputAmountRaw: finalConversion.quote.sellAmount,
                        expectedBnbRaw: finalConversion.quote.buyAmount,
                        minimumBnbRaw: finalConversion.quote.minimumBuyAmount,
                        swapGasUsdMicros: finalConversion.swapGas.gasUsdMicros.toString(),
                        approvalGasUsdMicros: finalConversion.approvalGas?.gasUsdMicros.toString() ?? '0',
                    },
                }),
                JSON.stringify({ platformFee: finalQuote.platformFee }),
                finalQuote.buyAmount,
                finalQuote.minimumBuyAmount,
                spender,
                netSwapAmountRaw.toString(),
                expiresAt,
                idempotencyKey,
                ipHash,
            ],
        })
        const order = await publicOrder(dependencies.database, orderId, walletAddress)
        return {
            ...order,
            amountsUsd: {
                tradeNotional: formatFixed(tradeNotionalUsdMicros),
                fixedServiceFee: formatFixed(calculation.fixedServiceFeeUsdMicros),
                platformFee: formatFixed(calculation.platformFeeUsdMicros),
                commercialFee: formatFixed(calculation.commercialFeeUsdMicros),
                gasReserve: formatFixed(calculation.gasReserveUsdMicros),
                conversionCost: formatFixed(calculation.conversionCostUsdMicros),
                totalPrepayment: formatFixed(calculation.totalPrepaymentUsdMicros),
            },
            commercialFeeCapUsd: config.sponsorship.commercialFeeCapUsd,
            currentRequiredAction: 'prepare-payment',
        }
    }

    async function get(orderId: string, walletAddress: string) {
        const order = await publicOrder(dependencies.database, orderId, walletAddress)
        if (!order) throw new GasAssistError('ORDER_NOT_FOUND', 'The sponsorship order was not found.', 404)
        return order
    }

    return { create, get }
}

export const sponsorshipOrderInternals = {
    normalizeInput,
    assertSafeZeroXSpender,
    loadPaymentTokens,
}
