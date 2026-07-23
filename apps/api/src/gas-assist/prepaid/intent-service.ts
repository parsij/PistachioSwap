import type { Pool, PoolClient } from 'pg'
import {
    decodeFunctionData,
    isAddressEqual,
    keccak256,
    toHex,
    type Address,
    type Hex,
} from 'viem'

import { getApiConfig } from '../../config.js'
import { getPool } from '../../db/client.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import { GasAssistError } from '../errors.js'
import { approveAbi, buildExactApproval, hashPrivateScope, UINT256_MAX } from '../exact-approval.js'
import {
    prepaidActionPaymasterClient,
    prepaidFeePaymasterClient,
    type PrepaidPolicyScope,
} from '../paymaster.js'
import { megaFuelActionPolicyManagement } from '../policy-management.js'
import {
    buildPaymentTransfer,
    createPrepaidChainClient,
    transferAbi,
    validateSignedIntent,
    verifyExactTransferReceipt,
    type StoredIntentTemplate,
} from './chain-client.js'
import {
    calculatePrepayment,
    ceilDiv,
    parseFixed,
    usdMicrosToTokenRawCeil,
} from './fixed-point.js'
import { getSponsorshipTokenEvidence } from './token-evidence.js'
import { getExactSponsoredQuote, quoteGasLimit, quoteSelector } from './normal-swap.js'

type OrderRow = {
    id: string
    status: string
    walletAddress: Address
    sellToken: Address
    buyToken: string
    grossInputAmountRaw: string
    netSwapAmountRaw: string
    paymentToken: Address
    paymentAmountRaw: string
    paymentTokenDecimals: number
    tradeNotionalUsdMicros: string
    fixedServiceFeeUsdMicros: string
    platformFeeUsdMicros: string
    commercialFeeUsdMicros: string
    gasReserveUsdMicros: string
    totalPrepaymentUsdMicros: string
    estimatedPaymentGasUsdMicros: string
    estimatedApprovalGasUsdMicros: string
    estimatedSwapGasUsdMicros: string
    conversionCostUsdMicros: string
    actualSponsoredGasUsdMicros: string | null
    gasMultiplierBps: number
    approvalSpender: Address
    approvalAmountRaw: string
    expiresAt: Date
    paymentQuoteExpiresAt: Date
    grantExpiresAt: Date | null
    feeConfirmedAt: Date | null
    providerQuoteSnapshot: Record<string, unknown>
    expectedOutputRaw: string
    minimumOutputRaw: string
    ipHash: string
    providerQuoteId: string | null
    providerQuoteExpiresAt: Date | null
}

type IntentRow = StoredIntentTemplate & {
    id: string
    orderId: string
    action: 'fee-payment-transfer' | 'token-approval' | 'normal-swap'
    status: string
    expiresAt: Date
    signedRawTransactionHash: Hex | null
    transactionHash: Hex | null
    submissionAttempts: number
}

type Dependencies = {
    database: Pool
    now: () => Date
    chain: ReturnType<typeof createPrepaidChainClient>
    feePaymaster: typeof prepaidFeePaymasterClient
    actionPaymaster: typeof prepaidActionPaymasterClient
    getEvidence: typeof getSponsorshipTokenEvidence
    quoteNormal: typeof getExactSponsoredQuote
}

function defaults(database: Pool): Dependencies {
    return {
        database,
        now: () => new Date(),
        chain: createPrepaidChainClient(),
        feePaymaster: prepaidFeePaymasterClient,
        actionPaymaster: prepaidActionPaymasterClient,
        getEvidence: getSponsorshipTokenEvidence,
        quoteNormal: getExactSponsoredQuote,
    }
}


function policyScopeForAction(action: IntentRow['action']): PrepaidPolicyScope {
    return action === 'fee-payment-transfer' ? 'fee' : 'action'
}

function paymasterForAction(dependencies: Dependencies, action: IntentRow['action']) {
    return policyScopeForAction(action) === 'fee'
        ? dependencies.feePaymaster
        : dependencies.actionPaymaster
}

function orderQuery(lock = false) {
    return `SELECT id,status,wallet_address AS "walletAddress",sell_token AS "sellToken",buy_token AS "buyToken",
                   gross_input_amount_raw::text AS "grossInputAmountRaw",net_swap_amount_raw::text AS "netSwapAmountRaw",
                   payment_token AS "paymentToken",payment_amount_raw::text AS "paymentAmountRaw",
                   payment_token_decimals AS "paymentTokenDecimals",trade_notional_usd_micros::text AS "tradeNotionalUsdMicros",
                   fixed_service_fee_usd_micros::text AS "fixedServiceFeeUsdMicros",
                   platform_fee_usd_micros::text AS "platformFeeUsdMicros",
                   commercial_fee_usd_micros::text AS "commercialFeeUsdMicros",
                   gas_reserve_usd_micros::text AS "gasReserveUsdMicros",
                   total_prepayment_usd_micros::text AS "totalPrepaymentUsdMicros",
                   estimated_payment_gas_usd_micros::text AS "estimatedPaymentGasUsdMicros",
                   estimated_approval_gas_usd_micros::text AS "estimatedApprovalGasUsdMicros",
                   estimated_swap_gas_usd_micros::text AS "estimatedSwapGasUsdMicros",
                   conversion_cost_usd_micros::text AS "conversionCostUsdMicros",
                   actual_sponsored_gas_usd_micros::text AS "actualSponsoredGasUsdMicros",
                   gas_multiplier_bps AS "gasMultiplierBps",approval_spender AS "approvalSpender",
                   approval_amount_raw::text AS "approvalAmountRaw",expires_at AS "expiresAt",
                   payment_quote_expires_at AS "paymentQuoteExpiresAt",grant_expires_at AS "grantExpiresAt",
                   fee_confirmed_at AS "feeConfirmedAt",provider_quote_snapshot AS "providerQuoteSnapshot",
                   expected_output_raw::text AS "expectedOutputRaw",minimum_output_raw::text AS "minimumOutputRaw",
                   ip_hash AS "ipHash",provider_quote_id AS "providerQuoteId",
                   provider_quote_expires_at AS "providerQuoteExpiresAt"
            FROM sponsorship_orders WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`
}

async function loadOrder(database: Pool | PoolClient, orderId: string, wallet: string, lock = false) {
    const result = await database.query<OrderRow>(orderQuery(lock), [orderId, wallet])
    const order = result.rows[0]
    if (!order) throw new GasAssistError('ORDER_NOT_FOUND', 'The sponsorship order was not found.', 404)
    return order
}

async function loadIntent(database: Pool | PoolClient, intentId: string, wallet: string, lock = false) {
    const result = await database.query<IntentRow>(
        `SELECT id,order_id AS "orderId",action,status,wallet_address AS "walletAddress",
                transaction_to AS "transactionTo",transaction_data AS "transactionData",
                transaction_data_hash AS "transactionDataHash",native_value::text AS "nativeValue",
                chain_id AS "chainId",nonce::text,transaction_type AS "transactionType",
                gas_limit::text AS "gasLimit",gas_price::text AS "gasPrice",
                max_fee_per_gas::text AS "maxFeePerGas",max_priority_fee_per_gas::text AS "maxPriorityFeePerGas",
                expires_at AS "expiresAt",signed_raw_transaction_hash AS "signedRawTransactionHash",
                transaction_hash AS "transactionHash",submission_attempts AS "submissionAttempts"
         FROM sponsorship_transaction_intents WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`,
        [intentId, wallet],
    )
    const intent = result.rows[0]
    if (!intent) throw new GasAssistError('INTENT_NOT_FOUND', 'The sponsorship intent was not found.', 404)
    return intent
}

function unsignedTransaction(intent: {
    walletAddress: Address
    transactionTo: Address
    transactionData: Hex
    nativeValue?: bigint
    nonce: bigint
    gasLimit: bigint
}) {
    return {
        from: intent.walletAddress,
        to: intent.transactionTo,
        data: intent.transactionData,
        value: toHex(intent.nativeValue ?? 0n),
        chainId: toHex(56),
        nonce: toHex(intent.nonce),
        gas: toHex(intent.gasLimit),
        gasPrice: '0x0',
        type: '0x0',
    }
}

function proportionalRawFloor(totalRaw: bigint, partUsd: bigint, totalUsd: bigint) {
    if (totalRaw < 0n || partUsd < 0n || totalUsd <= 0n) return 0n
    return totalRaw * partUsd / totalUsd
}

async function assertPaymentTokenCurrent(order: OrderRow, dependencies: Dependencies) {
    const result = await dependencies.database.query<{
        decimals: number
        enabled: boolean
        feePaymentEnabled: boolean
        maximumPriceAgeSeconds: number
        maximumPriceDeviationBps: number
        minimumLiquidityUsdMicros: string
    }>(
        `SELECT decimals,enabled,fee_payment_enabled AS "feePaymentEnabled",
                maximum_price_age_seconds AS "maximumPriceAgeSeconds",
                maximum_price_deviation_bps AS "maximumPriceDeviationBps",
                minimum_liquidity_usd_micros::text AS "minimumLiquidityUsdMicros"
         FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1`,
        [order.paymentToken],
    )
    const rule = result.rows[0]
    if (!rule?.enabled || !rule.feePaymentEnabled || rule.decimals !== order.paymentTokenDecimals) {
        throw new GasAssistError('PAYMENT_TOKEN_DISABLED', 'The sponsorship payment token is no longer enabled.', 409)
    }
    const [onchainDecimals, evidence, balance] = await Promise.all([
        dependencies.chain.getTokenDecimals(order.paymentToken),
        dependencies.getEvidence(order.paymentToken),
        dependencies.chain.getBalance(order.paymentToken, order.walletAddress),
    ])
    if (onchainDecimals !== rule.decimals || !evidence.priceUsdMicros || evidence.priceDeviationBps === null ||
        dependencies.now().getTime() - evidence.priceObservedAt.getTime() > rule.maximumPriceAgeSeconds * 1_000 ||
        evidence.priceDeviationBps > rule.maximumPriceDeviationBps ||
        evidence.liquidityUsdMicros < BigInt(rule.minimumLiquidityUsdMicros) ||
        evidence.transferBehavior !== 'exact' || !['trusted', 'low'].includes(evidence.securityStatus)) {
        throw new GasAssistError('PAYMENT_TOKEN_EVIDENCE_STALE', 'Payment-token price, liquidity, or transfer evidence is no longer valid.', 409)
    }
    if (balance < BigInt(order.paymentAmountRaw)) {
        throw new GasAssistError('INSUFFICIENT_PAYMENT_TOKEN_BALANCE', 'The payment-token balance is insufficient.')
    }
    return evidence
}

async function persistPreparedIntent({
    dependencies,
    order,
    action,
    to,
    data,
    nativeValue = 0n,
    estimate,
    nonce,
}: {
    dependencies: Dependencies
    order: OrderRow
    action: IntentRow['action']
    to: Address
    data: Hex
    nativeValue?: bigint
    estimate: { gasLimit: bigint }
    nonce: bigint
}) {
    const transaction = unsignedTransaction({
        walletAddress: order.walletAddress,
        transactionTo: to,
        transactionData: data,
        nativeValue,
        gasLimit: estimate.gasLimit,
        nonce,
    })
    const paymaster = paymasterForAction(dependencies, action)
    if (!await paymaster.isSponsorable(transaction)) {
        throw new GasAssistError('PAYMASTER_REJECTED', 'MegaFuel declined the exact sponsored transaction.', 409)
    }
    const configuredExpiry = dependencies.now().getTime() +
        getApiConfig().sponsorship.actionIntentTtlSeconds * 1_000
    const expiresAt = new Date(Math.min(configuredExpiry, order.expiresAt.getTime()))
    if (expiresAt <= dependencies.now()) {
        throw new GasAssistError('ORDER_EXPIRED', 'The sponsorship grant expired.', 409)
    }
    const expectedStatus = {
        'fee-payment-transfer': 'quoted',
        'token-approval': 'payment-confirmed',
        'normal-swap': 'approval-confirmed',
    }[action]
    const preparedStatus = {
        'fee-payment-transfer': 'payment-prepared',
        'token-approval': 'approval-preparing',
        'normal-swap': 'swap-preparing',
    }[action]
    const client = await dependencies.database.connect()
    try {
        await client.query('BEGIN')
        const locked = await loadOrder(client, order.id, order.walletAddress, true)
        if (locked.status !== expectedStatus) {
            throw new GasAssistError('ORDER_STATE_CONFLICT', 'The order is not ready for this sponsored action.', 409)
        }
        if (locked.expiresAt <= dependencies.now()) {
            await client.query(`UPDATE sponsorship_orders SET status='expired',updated_at=now() WHERE id=$1`, [locked.id])
            throw new GasAssistError('ORDER_EXPIRED', 'The sponsorship order expired.', 409)
        }
        const inserted = await client.query<{ id: string }>(
            `INSERT INTO sponsorship_transaction_intents
             (order_id,action,status,wallet_address,transaction_to,transaction_data,transaction_data_hash,
              native_value,chain_id,nonce,transaction_type,gas_limit,gas_price,expires_at)
             VALUES ($1,$2,'prepared',$3,$4,$5,$6,
                     $7,56,$8,'legacy',$9,0,$10)
             RETURNING id`,
            [
                order.id,
                action,
                order.walletAddress,
                to,
                data,
                keccak256(data),
                nativeValue.toString(),
                nonce.toString(),
                estimate.gasLimit.toString(),
                expiresAt,
            ],
        )
        await client.query(
            `UPDATE sponsorship_orders SET status=$2,updated_at=now() WHERE id=$1`,
            [order.id, preparedStatus],
        )
        await client.query('COMMIT')
        return {
            intentId: inserted.rows[0]!.id,
            orderId: order.id,
            action,
            expiresAt: expiresAt.toISOString(),
            rawTransactionSigning: {
                required: true,
                method: 'eth_signTransaction',
            },
            transaction,
        }
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

export function createSponsorshipIntentService(overrides: Partial<Dependencies> = {}) {
    const dependencies = {
        ...defaults(overrides.database ?? getPool()),
        ...overrides,
    }

    async function preparePayment(orderId: string, walletAddress: string) {
        const config = getApiConfig().sponsorship
        if (!config.enabled || config.emergencyDisabled) throw new GasAssistError('SPONSORSHIP_DISABLED', 'Prepaid Gas Assist is disabled.', 503)
        const order = await loadOrder(dependencies.database, orderId, walletAddress)
        if (order.status !== 'quoted') throw new GasAssistError('ORDER_STATE_CONFLICT', 'The order is not ready to prepare payment.', 409)
        if (order.expiresAt <= dependencies.now()) throw new GasAssistError('ORDER_EXPIRED', 'The sponsorship order expired.', 409)
        const evidence = await assertPaymentTokenCurrent(order, dependencies)
        const paymentData = buildPaymentTransfer(
            getApiConfig().fees.treasuryAddress as Address,
            BigInt(order.paymentAmountRaw),
        )
        const approvalData = buildExactApproval(order.approvalSpender, BigInt(order.approvalAmountRaw))
        const [sellDecimals, buyDecimals] = await Promise.all([
            dependencies.chain.getTokenDecimals(order.sellToken),
            order.buyToken === NATIVE_TOKEN_ADDRESS
                ? Promise.resolve(18)
                : dependencies.chain.getTokenDecimals(order.buyToken as Address),
        ])
        const currentQuote = await dependencies.quoteNormal({
            wallet: order.walletAddress,
            sellToken: order.sellToken,
            buyToken: order.buyToken,
            sellAmount: BigInt(order.netSwapAmountRaw),
            sellTokenDecimals: sellDecimals,
            buyTokenDecimals: buyDecimals,
            slippageBps: Number(order.providerQuoteSnapshot.slippageBps),
        })
        const reviewedQuote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
        if (currentQuote.provider !== String(reviewedQuote?.provider ?? '') ||
            !isAddressEqual(currentQuote.allowanceTarget, order.approvalSpender) ||
            BigInt(currentQuote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError('ORDER_REQUOTE_REQUIRED', 'The sponsored route changed; review a fresh sponsorship order.', 409)
        }
        const [paymentEstimate, approvalEstimate, swapEstimate] = await Promise.all([
            dependencies.chain.estimateSponsoredAction({
                wallet: order.walletAddress,
                to: order.paymentToken,
                data: paymentData,
                maximumGas: BigInt(config.maximumPaymentTransferGas),
            }),
            dependencies.chain.estimateSponsoredAction({
                wallet: order.walletAddress,
                to: order.sellToken,
                data: approvalData,
                maximumGas: BigInt(config.maximumApprovalGas),
            }),
            dependencies.chain.priceGasLimit(
                quoteGasLimit(currentQuote),
                BigInt(config.maximumSwapGas),
            ),
        ])
        const recalculated = calculatePrepayment({
            tradeNotionalUsdMicros: BigInt(order.tradeNotionalUsdMicros),
            paymentTransferGasUsdMicros: paymentEstimate.gasUsdMicros,
            approvalGasUsdMicros: approvalEstimate.gasUsdMicros,
            normalSwapGasUsdMicros: swapEstimate.gasUsdMicros,
            conversionCostUsdMicros: BigInt(order.conversionCostUsdMicros),
            flow: 'normal-sponsored-swap',
            gasMultiplierBps: order.gasMultiplierBps,
            fixedFeeUsdMicros: BigInt(order.fixedServiceFeeUsdMicros),
            platformFeeBps: config.platformFeeBps,
            commercialFeeCapUsdMicros: parseFixed(config.commercialFeeCapUsd),
        })
        const recalculatedRaw = usdMicrosToTokenRawCeil({
            usdMicros: recalculated.totalPrepaymentUsdMicros,
            tokenPriceUsdMicros: evidence.priceUsdMicros!,
            tokenDecimals: order.paymentTokenDecimals,
        })
        if (recalculatedRaw !== BigInt(order.paymentAmountRaw) ||
            recalculated.totalPrepaymentUsdMicros !== BigInt(order.totalPrepaymentUsdMicros)) {
            throw new GasAssistError('ORDER_REQUOTE_REQUIRED', 'Price or gas changed; review a fresh sponsorship order.', 409)
        }
        const nonce = await dependencies.feePaymaster.getNonce(order.walletAddress)
        return persistPreparedIntent({
            dependencies,
            order,
            action: 'fee-payment-transfer',
            to: order.paymentToken,
            data: paymentData,
            estimate: paymentEstimate,
            nonce,
        })
    }

    async function prepareApproval(orderId: string, walletAddress: string, reusableApproval = false) {
        const config = getApiConfig().sponsorship
        if (!config.approvalSponsorEnabled || config.emergencyDisabled) {
            throw new GasAssistError('APPROVAL_SPONSORSHIP_DISABLED', 'Approval sponsorship is disabled.', 503)
        }
        if (reusableApproval || config.approvalMode !== 'exact') {
            throw new GasAssistError('REUSABLE_APPROVAL_UNSUPPORTED', 'This deployment supports exact approval only.', 409)
        }
        const order = await loadOrder(dependencies.database, orderId, walletAddress)
        if (order.status !== 'payment-confirmed') throw new GasAssistError('PAYMENT_NOT_CONFIRMED', 'The sponsorship payment must confirm first.', 409)
        if (order.expiresAt <= dependencies.now()) throw new GasAssistError('ORDER_EXPIRED', 'The sponsorship order expired.', 409)
        const rule = await dependencies.database.query<{ enabled: boolean; approvalEnabled: boolean }>(
            `SELECT enabled,approval_sponsorship_enabled AS "approvalEnabled"
             FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1`,
            [order.sellToken],
        )
        if (!rule.rows[0]?.enabled || !rule.rows[0].approvalEnabled) {
            throw new GasAssistError('SELL_TOKEN_NOT_WHITELISTED', 'The sell token is no longer enabled for approval sponsorship.', 409)
        }
        const allowance = await dependencies.chain.getAllowance(order.sellToken, order.walletAddress, order.approvalSpender)
        if (allowance >= BigInt(order.approvalAmountRaw)) {
            throw new GasAssistError('ALLOWANCE_ALREADY_SUFFICIENT', 'The exact sponsored approval is no longer required.', 409)
        }
        const data = buildExactApproval(order.approvalSpender, BigInt(order.approvalAmountRaw))
        const estimate = await dependencies.chain.estimateSponsoredAction({
            wallet: order.walletAddress,
            to: order.sellToken,
            data,
            maximumGas: BigInt(config.maximumApprovalGas),
        })
        const nonce = await dependencies.actionPaymaster.getNonce(order.walletAddress)
        return persistPreparedIntent({
            dependencies,
            order,
            action: 'token-approval',
            to: order.sellToken,
            data,
            estimate,
            nonce,
        })
    }

    async function assertBusinessAction(intent: IntentRow, order: OrderRow) {
        if (intent.action === 'fee-payment-transfer') {
            const decoded = decodeFunctionData({ abi: transferAbi, data: intent.transactionData })
            const [recipient, amount] = decoded.args
            if (decoded.functionName !== 'transfer' ||
                !isAddressEqual(recipient, getApiConfig().fees.treasuryAddress as Address) ||
                amount !== BigInt(order.paymentAmountRaw) ||
                !isAddressEqual(intent.transactionTo, order.paymentToken)) {
                throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed payment does not match the order.')
            }
            await assertPaymentTokenCurrent(order, dependencies)
            return
        }
        if (intent.action === 'token-approval') {
            const decoded = decodeFunctionData({ abi: approveAbi, data: intent.transactionData })
            const [spender, amount] = decoded.args
            if (decoded.functionName !== 'approve' || !isAddressEqual(spender, order.approvalSpender) ||
                amount !== BigInt(order.approvalAmountRaw) || amount === UINT256_MAX ||
                !isAddressEqual(intent.transactionTo, order.sellToken)) {
                throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed approval does not match the order.')
            }
            const [allowance, balance] = await Promise.all([
                dependencies.chain.getAllowance(order.sellToken, order.walletAddress, order.approvalSpender),
                dependencies.chain.getBalance(order.sellToken, order.walletAddress),
            ])
            if (allowance >= amount) throw new GasAssistError('ALLOWANCE_ALREADY_SUFFICIENT', 'The approval is already sufficient.', 409)
            if (balance < amount) throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', 'The sell-token balance no longer covers the exact approval.', 409)
            return
        }
        if (intent.action === 'normal-swap') {
            const quote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
            const transaction = quote?.transaction as Record<string, unknown> | undefined
            const transactionTo = String(transaction?.to ?? '')
            const transactionData = String(transaction?.data ?? '')
            const transactionValue = String(transaction?.value ?? '')
            if (!transactionTo || !transactionData || !/^\d+$/.test(transactionValue) ||
                !isAddressEqual(intent.transactionTo, transactionTo as Address) ||
                intent.transactionData.toLowerCase() !== transactionData.toLowerCase() ||
                BigInt(intent.nativeValue) !== BigInt(transactionValue) ||
                String(quote?.sellAmount ?? '') !== order.netSwapAmountRaw ||
                String(quote?.allowanceTarget ?? '').toLowerCase() !== order.approvalSpender.toLowerCase() ||
                Date.parse(String(quote?.expiresAt ?? '')) <= dependencies.now().getTime()) {
                throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed swap does not match the fresh authorized sponsored quote.', 409)
            }
            if (!['uniswap', '0x'].includes(String(quote?.provider ?? ''))) {
                throw new GasAssistError('SPONSORED_PROVIDER_UNSUPPORTED', 'The stored sponsored provider is unsupported.', 409)
            }
            const [allowance, balance] = await Promise.all([
                dependencies.chain.getAllowance(order.sellToken, order.walletAddress, order.approvalSpender),
                dependencies.chain.getBalance(order.sellToken, order.walletAddress),
            ])
            if (allowance < BigInt(order.approvalAmountRaw)) {
                throw new GasAssistError('ALLOWANCE_NOT_CONFIRMED', 'The exact approval is no longer sufficient.', 409)
            }
            if (balance < BigInt(order.netSwapAmountRaw)) {
                throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', 'The sell-token balance no longer covers the exact swap.', 409)
            }
            return
        }
        throw new GasAssistError('UNSUPPORTED_SPONSORED_ACTION', 'The sponsored transaction action is unsupported.', 409)
    }

    async function reestimateSubmission(order: OrderRow, intent: IntentRow) {
        const config = getApiConfig().sponsorship
        const maximumGas = intent.action === 'fee-payment-transfer'
            ? BigInt(config.maximumPaymentTransferGas)
            : intent.action === 'token-approval'
                ? BigInt(config.maximumApprovalGas)
                : BigInt(config.maximumSwapGas)
        const estimate = await dependencies.chain.estimateSponsoredAction({
            wallet: order.walletAddress,
            to: intent.transactionTo,
            data: intent.transactionData,
            value: BigInt(intent.nativeValue),
            maximumGas,
        })
        const reservedGas = BigInt(order.gasReserveUsdMicros)
        const consumedGas = BigInt(order.actualSponsoredGasUsdMicros ?? '0')
        if (consumedGas + estimate.gasUsdMicros > reservedGas) {
            throw new GasAssistError('GAS_RESERVE_EXCEEDED', 'Current gas exceeds the funded sponsorship reserve.', 409)
        }
        return estimate
    }

    async function recheckSubmissionLimits(order: OrderRow, clientIp: string) {
        const config = getApiConfig().sponsorship
        const ipHash = hashPrivateScope(config.ipHashSecret!, clientIp)
        const result = await dependencies.database.query<{
            walletGas: string
            globalGas: string
            walletOrders: string
            ipOrders: string
            globalOrders: string
        }>(
            `SELECT
               COALESCE((SELECT sponsored_gas_usd_micros FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "walletGas",
               COALESCE((SELECT sponsored_gas_usd_micros FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='global' AND scope_hash='global'),0)::text AS "globalGas",
               COALESCE((SELECT order_count FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1),0)::text AS "walletOrders",
               COALESCE((SELECT order_count FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='ip' AND scope_hash=$2),0)::text AS "ipOrders",
               COALESCE((SELECT order_count FROM sponsorship_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='global' AND scope_hash='global'),0)::text AS "globalOrders"`,
            [order.walletAddress, ipHash],
        )
        const usage = result.rows[0]!
        if (BigInt(usage.walletGas) >= parseFixed(config.walletDailyGasUsd)) throw new GasAssistError('WALLET_GAS_BUDGET', 'The wallet sponsored gas budget is exhausted.', 429)
        if (BigInt(usage.globalGas) >= parseFixed(config.globalDailyGasUsd)) throw new GasAssistError('GLOBAL_GAS_BUDGET', 'The global sponsored gas budget is exhausted.', 429)
        if (BigInt(usage.walletOrders) > BigInt(config.walletDailyOrderLimit)) throw new GasAssistError('WALLET_DAILY_LIMIT', 'The wallet daily sponsorship limit is exhausted.', 429)
        if (BigInt(usage.ipOrders) > BigInt(config.ipDailyOrderLimit)) throw new GasAssistError('IP_DAILY_LIMIT', 'The network daily sponsorship limit is exhausted.', 429)
        if (BigInt(usage.globalOrders) > BigInt(config.globalDailyOrderLimit)) throw new GasAssistError('GLOBAL_DAILY_LIMIT', 'The global daily sponsorship limit is exhausted.', 429)
    }

    async function submit({
        intentId,
        signedRawTransaction,
        walletAddress,
        clientIp,
    }: {
        intentId: string
        signedRawTransaction: Hex
        walletAddress: string
        clientIp: string
    }) {
        if (!/^0x[0-9a-f]+$/i.test(signedRawTransaction)) {
            throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed transaction is malformed.')
        }
        const intent = await loadIntent(dependencies.database, intentId, walletAddress)
        const order = await loadOrder(dependencies.database, intent.orderId, walletAddress)
        if (!['prepared', 'signing'].includes(intent.status) || intent.submissionAttempts !== 0) {
            throw new GasAssistError('INTENT_ALREADY_USED', 'This sponsored intent cannot be submitted again.', 409)
        }
        if (intent.expiresAt <= dependencies.now() || order.expiresAt <= dependencies.now()) {
            throw new GasAssistError('INTENT_EXPIRED', 'The sponsored intent expired.', 409)
        }
        const verification = await validateSignedIntent(signedRawTransaction, intent)
        await assertBusinessAction(intent, order)
        await reestimateSubmission(order, intent)
        await recheckSubmissionLimits(order, clientIp)
        const paymaster = paymasterForAction(dependencies, intent.action)
        const sponsorable = await paymaster.isSponsorable(unsignedTransaction({
            walletAddress: order.walletAddress,
            transactionTo: intent.transactionTo,
            transactionData: intent.transactionData,
            nativeValue: BigInt(intent.nativeValue),
            nonce: BigInt(intent.nonce),
            gasLimit: BigInt(intent.gasLimit),
        }))
        if (!sponsorable) throw new GasAssistError('PAYMASTER_REJECTED', 'MegaFuel no longer accepts this exact transaction.', 409)

        const client = await dependencies.database.connect()
        try {
            await client.query('BEGIN')
            const lockedIntent = await loadIntent(client, intent.id, walletAddress, true)
            await loadOrder(client, order.id, walletAddress, true)
            if (!['prepared', 'signing'].includes(lockedIntent.status) || lockedIntent.submissionAttempts !== 0 ||
                lockedIntent.expiresAt <= dependencies.now()) {
                throw new GasAssistError('INTENT_ALREADY_USED', 'This sponsored intent cannot be submitted again.', 409)
            }
            await client.query(
                `UPDATE sponsorship_transaction_intents
                 SET status='submitting',submission_attempts=1,signed_raw_transaction_hash=$2,updated_at=now()
                 WHERE id=$1`,
                [intent.id, verification.transactionHash],
            )
            await client.query(
                `UPDATE sponsorship_orders SET status=$2,updated_at=now() WHERE id=$1`,
                [order.id, {
                    'fee-payment-transfer': 'payment-submitting',
                    'token-approval': 'approval-submitted',
                    'normal-swap': 'swap-submitted',
                }[intent.action]],
            )
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }

        let providerHash: Hex
        if (intent.expiresAt <= dependencies.now() || order.expiresAt <= dependencies.now()) {
            await dependencies.database.query(
                `UPDATE sponsorship_transaction_intents SET status='expired',failure_code='INTENT_EXPIRED',updated_at=now()
                 WHERE id=$1 AND status='submitting'`,
                [intent.id],
            )
            await dependencies.database.query(
                `UPDATE sponsorship_orders SET status='expired',rejection_code='ORDER_EXPIRED',updated_at=now()
                 WHERE id=$1 AND status IN ('payment-submitting','approval-submitted','swap-submitted')`,
                [order.id],
            )
            throw new GasAssistError('INTENT_EXPIRED', 'The sponsored intent expired before submission.', 409)
        }
        try {
            providerHash = await paymaster.submit(signedRawTransaction)
        } catch {
            await dependencies.database.query(
                `UPDATE sponsorship_transaction_intents SET status='unknown',transaction_hash=$2,failure_code='SUBMISSION_RESULT_UNKNOWN',updated_at=now()
                 WHERE id=$1 AND status='submitting'`,
                [intent.id, verification.transactionHash],
            )
            await dependencies.database.query(
                `UPDATE sponsorship_orders SET status='unknown',rejection_code='SUBMISSION_RESULT_UNKNOWN',updated_at=now()
                 WHERE id=$1`,
                [order.id],
            )
            throw new GasAssistError('SUBMISSION_RESULT_UNKNOWN', 'Submission result is unknown; the transaction will not be resent.', 502)
        }
        if (providerHash.toLowerCase() !== verification.transactionHash.toLowerCase()) {
            await dependencies.database.query(
                `UPDATE sponsorship_transaction_intents SET status='unknown',transaction_hash=$2,failure_code='PAYMASTER_HASH_MISMATCH',updated_at=now()
                 WHERE id=$1`,
                [intent.id, verification.transactionHash],
            )
            await dependencies.database.query(
                `UPDATE sponsorship_orders SET status='unknown',rejection_code='PAYMASTER_HASH_MISMATCH',updated_at=now()
                 WHERE id=$1`,
                [order.id],
            )
            throw new GasAssistError('PAYMASTER_HASH_MISMATCH', 'MegaFuel returned a different transaction hash.', 502)
        }
        await dependencies.database.query(
            `UPDATE sponsorship_transaction_intents SET status='submitted',transaction_hash=$2,updated_at=now()
             WHERE id=$1 AND status='submitting'`,
            [intent.id, providerHash],
        )
        await dependencies.database.query(
            `UPDATE sponsorship_orders SET status=$2,
                    payment_transaction_hash=CASE WHEN $3='fee-payment-transfer' THEN $4 ELSE payment_transaction_hash END,
                    approval_transaction_hash=CASE WHEN $3='token-approval' THEN $4 ELSE approval_transaction_hash END,
                    swap_transaction_hash=CASE WHEN $3='normal-swap' THEN $4 ELSE swap_transaction_hash END,
                    updated_at=now() WHERE id=$1`,
            [order.id, {
                'fee-payment-transfer': 'payment-submitted',
                'token-approval': 'approval-submitted',
                'normal-swap': 'swap-submitted',
            }[intent.action], intent.action, providerHash],
        )
        return { status: 'submitted', transactionHash: providerHash }
    }

    async function actualGasUsd(
        receipt: { gasUsed: bigint; effectiveGasPrice: bigint },
        order: OrderRow,
        intent: IntentRow,
    ) {
        const bnbPrice = await (async () => {
            const value = await import('../../providers/alchemy/token-prices.js').then(({ getNativeBnbPrice }) => getNativeBnbPrice())
            if (!value) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'BNB price is unavailable for gas settlement.', 503)
            return parseFixed(value)
        })()
        const snapshotKey = {
            'fee-payment-transfer': 'paymentGas',
            'token-approval': 'approvalGas',
            'normal-swap': 'swapGas',
        }[intent.action]
        const snapshot = order.providerQuoteSnapshot[snapshotKey] as Record<string, unknown> | undefined
        const fallbackGasPrice = /^\d+$/.test(String(snapshot?.currentGasPrice ?? ''))
            ? BigInt(String(snapshot?.currentGasPrice))
            : 0n
        const effectiveGasPrice = receipt.effectiveGasPrice > 0n
            ? receipt.effectiveGasPrice
            : fallbackGasPrice
        if (effectiveGasPrice <= 0n) {
            throw new GasAssistError('SPONSORED_GAS_COST_UNKNOWN', 'The sponsored gas cost cannot be reconciled safely yet.', 503)
        }
        return ceilDiv(receipt.gasUsed * effectiveGasPrice * bnbPrice, 10n ** 18n)
    }

    async function chargeGas(client: PoolClient, order: OrderRow, intent: IntentRow, gasUsdMicros: bigint, reverted: boolean) {
        const snapshotPrice = BigInt(String(order.providerQuoteSnapshot.paymentPriceUsdMicros))
        const tokenAmountRaw = usdMicrosToTokenRawCeil({
            usdMicros: gasUsdMicros,
            tokenPriceUsdMicros: snapshotPrice,
            tokenDecimals: order.paymentTokenDecimals,
        })
        await client.query(
            `INSERT INTO sponsorship_ledger
             (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw,action,failure_reason)
             VALUES ($1,$2,'actualGasConsumed',$3,$4,$5,$6,$7)`,
            [order.id, order.walletAddress, gasUsdMicros.toString(), order.paymentToken, tokenAmountRaw.toString(), intent.action, reverted ? 'transaction-reverted' : null],
        )
        await client.query(
            `UPDATE sponsorship_orders SET actual_sponsored_gas_usd_micros=COALESCE(actual_sponsored_gas_usd_micros,0)+$2,updated_at=now()
             WHERE id=$1`,
            [order.id, gasUsdMicros.toString()],
        )
        for (const [scopeType, scopeHash] of [['wallet', order.walletAddress], ['ip', order.ipHash], ['global', 'global']]) {
            await client.query(
                `INSERT INTO sponsorship_usage
                 (usage_date,chain_id,scope_type,scope_hash,sponsored_gas_usd_micros,reverted_attempts,token_action_counts)
                 VALUES ((now() at time zone 'utc')::date,56,$1,$2,$3,$4,jsonb_build_object($5::text,1))
                 ON CONFLICT (usage_date,chain_id,scope_type,scope_hash)
                 DO UPDATE SET sponsored_gas_usd_micros=sponsorship_usage.sponsored_gas_usd_micros+EXCLUDED.sponsored_gas_usd_micros,
                               reverted_attempts=sponsorship_usage.reverted_attempts+EXCLUDED.reverted_attempts,
                               token_action_counts=jsonb_set(
                                   sponsorship_usage.token_action_counts,
                                   ARRAY[$5::text],
                                   to_jsonb(
                                       COALESCE(
                                           (sponsorship_usage.token_action_counts ->> $5::text)::integer,
                                           0
                                       )+1
                                   ),
                                   true
                               ),
                               updated_at=now()`,
                [scopeType, scopeHash, gasUsdMicros.toString(), reverted ? 1 : 0, `${order.paymentToken}:${intent.action}`],
            )
        }
    }

    async function createPendingRefund(
        client: PoolClient,
        order: OrderRow,
        reason: string,
        actualGasUsdMicros = BigInt(order.actualSponsoredGasUsdMicros ?? '0'),
    ) {
        const refundGasUsdMicros = BigInt(order.estimatedPaymentGasUsdMicros)
        const paymentPriceUsdMicros = BigInt(String(order.providerQuoteSnapshot.paymentPriceUsdMicros))
        const nonrefundableRaw = usdMicrosToTokenRawCeil({
            usdMicros: actualGasUsdMicros + refundGasUsdMicros,
            tokenPriceUsdMicros: paymentPriceUsdMicros,
            tokenDecimals: order.paymentTokenDecimals,
        })
        const paidRaw = BigInt(order.paymentAmountRaw)
        const refundableRaw = paidRaw > nonrefundableRaw ? paidRaw - nonrefundableRaw : 0n
        await client.query(
            `INSERT INTO sponsorship_refunds
             (order_id,wallet_address,chain_id,token_address,gross_payment_raw,
              actual_sponsored_gas_usd_micros,estimated_refund_gas_usd_micros,
              refundable_token_amount_raw,status,reason)
             VALUES ($1,$2,56,$3,$4,$5,$6,$7,'pending',$8)
             ON CONFLICT (order_id) DO NOTHING`,
            [
                order.id,
                order.walletAddress,
                order.paymentToken,
                order.paymentAmountRaw,
                actualGasUsdMicros.toString(),
                refundGasUsdMicros.toString(),
                refundableRaw.toString(),
                reason,
            ],
        )
        await client.query(
            `INSERT INTO sponsorship_ledger
             (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw,failure_reason)
             VALUES ($1,$2,'refundPending',0,$3,$4,$5)`,
            [order.id, order.walletAddress, order.paymentToken, refundableRaw.toString(), reason],
        )
    }

    async function refreshIntent(intent: IntentRow, order: OrderRow) {
        if (!intent.transactionHash || !['submitted', 'unknown'].includes(intent.status)) return null
        let receipt
        try {
            receipt = await dependencies.chain.getReceipt(intent.transactionHash)
        } catch {
            return null
        }
        const transaction = await dependencies.chain.getTransaction(intent.transactionHash)
        const gasUsdMicros = await actualGasUsd(receipt, order, intent)
        const client = await dependencies.database.connect()
        try {
            await client.query('BEGIN')
            const lockedIntent = await loadIntent(client, intent.id, order.walletAddress, true)
            const lockedOrder = await loadOrder(client, order.id, order.walletAddress, true)
            if (!['submitted', 'unknown'].includes(lockedIntent.status)) {
                await client.query('COMMIT')
                return null
            }
            const actualGasAfter = BigInt(lockedOrder.actualSponsoredGasUsdMicros ?? '0') + gasUsdMicros
            await chargeGas(client, lockedOrder, lockedIntent, gasUsdMicros, receipt.status !== 'success')
            lockedOrder.actualSponsoredGasUsdMicros = actualGasAfter.toString()

            if (receipt.status !== 'success') {
                await client.query(
                    `UPDATE sponsorship_transaction_intents
                     SET status='reverted',failure_code='TRANSACTION_REVERTED',updated_at=now() WHERE id=$1`,
                    [intent.id],
                )
                if (intent.action === 'fee-payment-transfer') {
                    await client.query(
                        `UPDATE sponsorship_orders SET status='failed',rejection_code='PAYMENT_REVERTED',updated_at=now() WHERE id=$1`,
                        [order.id],
                    )
                } else {
                    await createPendingRefund(
                        client,
                        lockedOrder,
                        intent.action === 'token-approval' ? 'approval-reverted' : 'swap-reverted',
                        actualGasAfter,
                    )
                    await client.query(
                        `UPDATE sponsorship_orders SET status='failed',rejection_code=$2,updated_at=now() WHERE id=$1`,
                        [order.id, intent.action === 'token-approval' ? 'APPROVAL_REVERTED' : 'SWAP_REVERTED'],
                    )
                }
                await client.query('COMMIT')
                return { status: 'reverted' }
            }

            if (intent.action === 'fee-payment-transfer') {
                let received: bigint
                try {
                    received = verifyExactTransferReceipt({
                        receipt,
                        transactionFrom: transaction.from,
                        transactionTo: transaction.to,
                        wallet: order.walletAddress,
                        token: order.paymentToken,
                        treasury: getApiConfig().fees.treasuryAddress as Address,
                        requiredAmount: BigInt(order.paymentAmountRaw),
                    })
                } catch {
                    await client.query(
                        `UPDATE sponsorship_transaction_intents SET status='rejected',failure_code='PAYMENT_RECEIPT_INVALID',updated_at=now() WHERE id=$1`,
                        [intent.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_orders SET status='failed',rejection_code='PAYMENT_RECEIPT_INVALID',updated_at=now() WHERE id=$1`,
                        [order.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_usage SET failed_payment_attempts=failed_payment_attempts+1,updated_at=now()
                         WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1`,
                        [order.walletAddress],
                    )
                    await client.query('COMMIT')
                    return { status: 'rejected' }
                }
                const reserveAndConversionUsd = BigInt(order.gasReserveUsdMicros) + BigInt(order.conversionCostUsdMicros)
                const reserveRaw = proportionalRawFloor(
                    BigInt(order.paymentAmountRaw),
                    reserveAndConversionUsd,
                    BigInt(order.totalPrepaymentUsdMicros),
                )
                const commercialRaw = BigInt(order.paymentAmountRaw) - reserveRaw
                const serviceRaw = proportionalRawFloor(
                    commercialRaw,
                    BigInt(order.fixedServiceFeeUsdMicros),
                    BigInt(order.commercialFeeUsdMicros),
                )
                const grantExpiresAt = new Date(
                    dependencies.now().getTime() + 5 * 60 * 1_000,
                )
                await client.query(
                    `INSERT INTO sponsorship_ledger (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw)
                     VALUES ($1,$2,'gasAndConversionReserve',$3,$4,$5),
                            ($1,$2,'commercialFeeReserve',$6,$4,$7),
                            ($1,$2,'serviceFeeReserved',$8,$4,$9)`,
                    [
                        order.id,
                        order.walletAddress,
                        reserveAndConversionUsd.toString(),
                        order.paymentToken,
                        reserveRaw.toString(),
                        order.commercialFeeUsdMicros,
                        commercialRaw.toString(),
                        order.fixedServiceFeeUsdMicros,
                        serviceRaw.toString(),
                    ],
                )
                await client.query(
                    `UPDATE sponsorship_orders SET status='payment-confirmed',actual_payment_received_raw=$2,
                            payment_transaction_hash=$3,fee_confirmed_at=now(),grant_expires_at=$4,
                            expires_at=$4,updated_at=now() WHERE id=$1`,
                    [order.id, received.toString(), intent.transactionHash, grantExpiresAt],
                )
            } else if (intent.action === 'token-approval') {
                const allowance = await dependencies.chain.getAllowance(order.sellToken, order.walletAddress, order.approvalSpender)
                if (!isAddressEqual(transaction.from, order.walletAddress) || !transaction.to ||
                    !isAddressEqual(transaction.to, order.sellToken) || allowance < BigInt(order.approvalAmountRaw)) {
                    await createPendingRefund(client, lockedOrder, 'approval-receipt-invalid', actualGasAfter)
                    await client.query(
                        `UPDATE sponsorship_transaction_intents SET status='rejected',failure_code='APPROVAL_RECEIPT_INVALID',updated_at=now() WHERE id=$1`,
                        [intent.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_orders SET status='failed',rejection_code='APPROVAL_RECEIPT_INVALID',updated_at=now() WHERE id=$1`,
                        [order.id],
                    )
                    await client.query('COMMIT')
                    return { status: 'rejected' }
                }
                await client.query(
                    `UPDATE sponsorship_orders SET status='approval-confirmed',approval_transaction_hash=$2,
                            provider_quote_id=NULL,provider_quote_expires_at=NULL,updated_at=now() WHERE id=$1`,
                    [order.id, intent.transactionHash],
                )
            } else {
                const quote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
                const expectedTransaction = quote?.transaction as Record<string, unknown> | undefined
                const expectedTarget = String(expectedTransaction?.to ?? '')
                if (!isAddressEqual(transaction.from, order.walletAddress) || !transaction.to ||
                    !normalizeAddress(expectedTarget) || !isAddressEqual(transaction.to, expectedTarget as Address)) {
                    await client.query(
                        `UPDATE sponsorship_transaction_intents SET status='unknown',failure_code='SWAP_RECEIPT_INVALID',updated_at=now() WHERE id=$1`,
                        [intent.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_orders SET status='unknown',rejection_code='SWAP_RECEIPT_INVALID',updated_at=now() WHERE id=$1`,
                        [order.id],
                    )
                    await client.query('COMMIT')
                    return { status: 'unknown' }
                }
                const reserveRaw = proportionalRawFloor(
                    BigInt(order.paymentAmountRaw),
                    BigInt(order.gasReserveUsdMicros) + BigInt(order.conversionCostUsdMicros),
                    BigInt(order.totalPrepaymentUsdMicros),
                )
                const commercialRaw = BigInt(order.paymentAmountRaw) - reserveRaw
                const serviceRaw = proportionalRawFloor(
                    commercialRaw,
                    BigInt(order.fixedServiceFeeUsdMicros),
                    BigInt(order.commercialFeeUsdMicros),
                )
                const platformRaw = commercialRaw - serviceRaw
                await client.query(
                    `INSERT INTO sponsorship_ledger (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw)
                     VALUES ($1,$2,'serviceFeeSettled',$3,$4,$5),
                            ($1,$2,'platformFeeSettled',$6,$4,$7)`,
                    [
                        order.id,
                        order.walletAddress,
                        order.fixedServiceFeeUsdMicros,
                        order.paymentToken,
                        serviceRaw.toString(),
                        order.platformFeeUsdMicros,
                        platformRaw.toString(),
                    ],
                )
                await client.query(
                    `UPDATE sponsorship_orders SET status='completed',swap_transaction_hash=$2,
                            platform_fee_settled_at=now(),completed_at=now(),updated_at=now() WHERE id=$1`,
                    [order.id, intent.transactionHash],
                )
            }
            await client.query(
                `UPDATE sponsorship_transaction_intents SET status='confirmed',updated_at=now() WHERE id=$1`,
                [intent.id],
            )
            await client.query('COMMIT')
            return { status: 'confirmed' }
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
    }

    async function prepareContinuation(orderId: string, walletAddress: string, _clientIp: string) {
        const config = getApiConfig().sponsorship
        if (!config.normalSwapSponsorEnabled || config.emergencyDisabled) {
            throw new GasAssistError('NORMAL_SWAP_SPONSORSHIP_DISABLED', 'Exact MegaFuel swap sponsorship is disabled.', 503)
        }
        let order = await loadOrder(dependencies.database, orderId, walletAddress)
        if (order.status !== 'approval-confirmed') {
            throw new GasAssistError('APPROVAL_NOT_CONFIRMED', 'The exact sponsored approval must confirm first.', 409)
        }
        if (order.expiresAt <= dependencies.now()) {
            throw new GasAssistError('ORDER_EXPIRED', 'The five-minute sponsorship grant expired.', 409)
        }
        const rule = await dependencies.database.query<{ enabled: boolean; swapEnabled: boolean }>(
            `SELECT enabled,normal_swap_sponsorship_enabled AS "swapEnabled"
             FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1`,
            [order.sellToken],
        )
        if (!rule.rows[0]?.enabled || !rule.rows[0].swapEnabled) {
            throw new GasAssistError('SELL_TOKEN_NOT_WHITELISTED', 'The sell token is no longer enabled for exact swap sponsorship.', 409)
        }
        const [sellDecimals, buyDecimals, allowance] = await Promise.all([
            dependencies.chain.getTokenDecimals(order.sellToken),
            order.buyToken === NATIVE_TOKEN_ADDRESS
                ? Promise.resolve(18)
                : dependencies.chain.getTokenDecimals(order.buyToken as Address),
            dependencies.chain.getAllowance(order.sellToken, order.walletAddress, order.approvalSpender),
        ])
        if (allowance < BigInt(order.approvalAmountRaw)) {
            throw new GasAssistError('ALLOWANCE_NOT_CONFIRMED', 'The exact approval is no longer sufficient.', 409)
        }
        const quote = await dependencies.quoteNormal({
            wallet: order.walletAddress,
            sellToken: order.sellToken,
            buyToken: order.buyToken,
            sellAmount: BigInt(order.netSwapAmountRaw),
            sellTokenDecimals: sellDecimals,
            buyTokenDecimals: buyDecimals,
            slippageBps: Number(order.providerQuoteSnapshot.slippageBps),
        })
        const reviewedQuote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
        if (quote.provider !== String(reviewedQuote?.provider ?? '') ||
            !isAddressEqual(quote.allowanceTarget, order.approvalSpender) ||
            BigInt(quote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError('FRESH_QUOTE_OUTSIDE_SLIPPAGE', 'The fresh sponsored quote moved beyond the reviewed route or minimum output.', 409)
        }
        const estimate = await dependencies.chain.estimateSponsoredAction({
            wallet: order.walletAddress,
            to: quote.transaction.to,
            data: quote.transaction.data,
            value: BigInt(quote.transaction.value),
            maximumGas: BigInt(config.maximumSwapGas),
        })
        const consumedGas = BigInt(order.actualSponsoredGasUsdMicros ?? '0')
        if (consumedGas + estimate.gasUsdMicros > BigInt(order.gasReserveUsdMicros)) {
            throw new GasAssistError('GAS_RESERVE_EXCEEDED', 'The fresh swap gas exceeds the funded sponsorship reserve.', 409)
        }
        await megaFuelActionPolicyManagement.add('ToAccountWhitelist', [quote.transaction.to])
        await megaFuelActionPolicyManagement.add('ContractMethodSigWhitelist', [quoteSelector(quote)])
        const refreshedSnapshot = {
            ...order.providerQuoteSnapshot,
            quote: {
                provider: quote.provider,
                quoteId: quote.quoteId,
                expiresAt: quote.expiresAt,
                sellToken: quote.sellToken,
                buyToken: quote.buyToken,
                sellAmount: quote.sellAmount,
                buyAmount: quote.buyAmount,
                minimumBuyAmount: quote.minimumBuyAmount,
                allowanceTarget: quote.allowanceTarget,
                transaction: quote.transaction,
            },
            swapGas: {
                gasLimit: estimate.gasLimit.toString(),
                currentGasPrice: estimate.currentGasPrice.toString(),
                gasUsdMicros: estimate.gasUsdMicros.toString(),
                observedAt: estimate.observedAt.toISOString(),
            },
        }
        await dependencies.database.query(
            `UPDATE sponsorship_orders SET provider_quote_id=$2,provider_quote_expires_at=$3,
                    provider_quote_snapshot=$4::jsonb,provider_fees=$5::jsonb,
                    expected_output_raw=$6,minimum_output_raw=$7,
                    estimated_swap_gas_usd_micros=$8,updated_at=now()
             WHERE id=$1 AND wallet_address=$9 AND status='approval-confirmed'`,
            [
                order.id,
                quote.quoteId,
                quote.expiresAt,
                JSON.stringify(refreshedSnapshot),
                JSON.stringify({ platformFee: quote.platformFee }),
                quote.buyAmount,
                quote.minimumBuyAmount,
                estimate.gasUsdMicros.toString(),
                order.walletAddress,
            ],
        )
        order = await loadOrder(dependencies.database, order.id, order.walletAddress)
        const nonce = await dependencies.actionPaymaster.getNonce(order.walletAddress)
        return persistPreparedIntent({
            dependencies,
            order,
            action: 'normal-swap',
            to: quote.transaction.to,
            data: quote.transaction.data,
            nativeValue: BigInt(quote.transaction.value),
            estimate,
            nonce,
        })
    }

    async function refreshOrder(orderId: string, walletAddress: string) {
        let order = await loadOrder(dependencies.database, orderId, walletAddress)
        const intents = await dependencies.database.query<IntentRow>(
            `SELECT id,order_id AS "orderId",action,status,wallet_address AS "walletAddress",
                    transaction_to AS "transactionTo",transaction_data AS "transactionData",
                    transaction_data_hash AS "transactionDataHash",native_value::text AS "nativeValue",chain_id AS "chainId",
                    nonce::text,transaction_type AS "transactionType",gas_limit::text AS "gasLimit",gas_price::text AS "gasPrice",
                    max_fee_per_gas::text AS "maxFeePerGas",max_priority_fee_per_gas::text AS "maxPriorityFeePerGas",
                    expires_at AS "expiresAt",signed_raw_transaction_hash AS "signedRawTransactionHash",
                    transaction_hash AS "transactionHash",submission_attempts AS "submissionAttempts"
             FROM sponsorship_transaction_intents WHERE order_id=$1 ORDER BY created_at`,
            [order.id],
        )
        for (const intent of intents.rows) await refreshIntent(intent, order)
        order = await loadOrder(dependencies.database, orderId, walletAddress)
        if (order.expiresAt <= dependencies.now() && !['completed', 'expired', 'rejected', 'failed'].includes(order.status)) {
            const client = await dependencies.database.connect()
            try {
                await client.query('BEGIN')
                const locked = await loadOrder(client, order.id, order.walletAddress, true)
                if ([
                    'payment-confirmed',
                    'approval-preparing',
                    'approval-submitted',
                    'approval-confirmed',
                    'swap-preparing',
                    'swap-submitted',
                ].includes(locked.status)) {
                    await createPendingRefund(client, locked, 'order-abandoned-or-expired')
                }
                await client.query(`UPDATE sponsorship_orders SET status='expired',rejection_code='ORDER_EXPIRED',updated_at=now() WHERE id=$1`, [locked.id])
                await client.query(
                    `UPDATE sponsorship_usage SET expired_attempts=expired_attempts+1,updated_at=now()
                     WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND scope_type='wallet' AND scope_hash=$1`,
                    [locked.walletAddress],
                )
                await client.query('COMMIT')
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined)
                throw error
            } finally {
                client.release()
            }
        }
        const blockNumber = await dependencies.chain.getBlockNumber().catch(() => null)
        const hashes = intents.rows.filter((intent) => intent.transactionHash)
        const confirmations = await Promise.all(hashes.map(async (intent) => {
            try {
                const receipt = await dependencies.chain.getReceipt(intent.transactionHash!)
                return blockNumber === null ? 0 : Number(blockNumber - receipt.blockNumber + 1n)
            } catch {
                return 0
            }
        }))
        const updated = await loadOrder(dependencies.database, orderId, walletAddress)
        return {
            order: updated,
            currentRequiredAction: {
                quoted: 'prepare-payment',
                'payment-prepared': 'sign-payment',
                'payment-submitted': 'wait-payment-confirmation',
                'payment-confirmed': 'prepare-approval',
                'approval-preparing': 'sign-approval',
                'approval-submitted': 'wait-approval-confirmation',
                'approval-confirmed': 'prepare-sponsored-swap',
                'swap-preparing': 'sign-sponsored-swap',
                'swap-submitted': 'wait-swap-confirmation',
            }[updated.status] ?? null,
            confirmationCount: confirmations.length ? Math.min(...confirmations) : 0,
        }
    }

    return {
        preparePayment,
        prepareApproval,
        submit,
        prepareContinuation,
        refreshOrder,
    }
}

export const sponsorshipIntentInternals = {
    unsignedTransaction,
    policyScopeForAction,
}
