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
import { gaslessService } from '../gasless-service.js'
import { GasAssistError } from '../errors.js'
import { approveAbi, buildExactApproval, hashPrivateScope, UINT256_MAX } from '../exact-approval.js'
import { prepaidPaymasterClient } from '../paymaster.js'
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
    actualSponsoredGasUsdMicros: string | null
    gasMultiplierBps: number
    approvalSpender: Address
    approvalAmountRaw: string
    expiresAt: Date
    providerQuoteSnapshot: Record<string, unknown>
    minimumOutputRaw: string
    ipHash: string
    providerQuoteId: string | null
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
    paymaster: typeof prepaidPaymasterClient
    getEvidence: typeof getSponsorshipTokenEvidence
}

function defaults(database: Pool): Dependencies {
    return {
        database,
        now: () => new Date(),
        chain: createPrepaidChainClient(),
        paymaster: prepaidPaymasterClient,
        getEvidence: getSponsorshipTokenEvidence,
    }
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
                   actual_sponsored_gas_usd_micros::text AS "actualSponsoredGasUsdMicros",
                   gas_multiplier_bps AS "gasMultiplierBps",approval_spender AS "approvalSpender",
                   approval_amount_raw::text AS "approvalAmountRaw",expires_at AS "expiresAt",
                   provider_quote_snapshot AS "providerQuoteSnapshot",minimum_output_raw::text AS "minimumOutputRaw",
                   ip_hash AS "ipHash",provider_quote_id AS "providerQuoteId"
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
    nonce: bigint
    gasLimit: bigint
}) {
    return {
        from: intent.walletAddress,
        to: intent.transactionTo,
        data: intent.transactionData,
        value: '0x0',
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
    estimate,
    nonce,
}: {
    dependencies: Dependencies
    order: OrderRow
    action: IntentRow['action']
    to: Address
    data: Hex
    estimate: { gasLimit: bigint }
    nonce: bigint
}) {
    const transaction = unsignedTransaction({
        walletAddress: order.walletAddress,
        transactionTo: to,
        transactionData: data,
        gasLimit: estimate.gasLimit,
        nonce,
    })
    if (!await dependencies.paymaster.isSponsorable(transaction)) {
        throw new GasAssistError('PAYMASTER_REJECTED', 'MegaFuel declined the exact sponsored transaction.', 409)
    }
    const expiresAt = new Date(
        dependencies.now().getTime() + getApiConfig().sponsorship.actionIntentTtlSeconds * 1_000,
    )
    const client = await dependencies.database.connect()
    try {
        await client.query('BEGIN')
        const locked = await loadOrder(client, order.id, order.walletAddress, true)
        const expectedStatus = action === 'fee-payment-transfer'
            ? 'quoted'
            : 'payment-confirmed'
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
                     0,56,$7,'legacy',$8,0,$9)
             RETURNING id`,
            [order.id, action, order.walletAddress, to, data, keccak256(data), nonce.toString(), estimate.gasLimit.toString(), expiresAt],
        )
        await client.query(
            `UPDATE sponsorship_orders SET status=$2,updated_at=now() WHERE id=$1`,
            [order.id, action === 'fee-payment-transfer' ? 'payment-prepared' : 'approval-preparing'],
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
        const [paymentEstimate, approvalEstimate] = await Promise.all([
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
        ])
        const recalculated = calculatePrepayment({
            tradeNotionalUsdMicros: BigInt(order.tradeNotionalUsdMicros),
            paymentTransferGasUsdMicros: paymentEstimate.gasUsdMicros,
            approvalGasUsdMicros: approvalEstimate.gasUsdMicros,
            normalSwapGasUsdMicros: 0n,
            flow: 'zero-x-gasless-after-approval',
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
        const nonce = await dependencies.paymaster.getNonce(order.walletAddress)
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
        const nonce = await dependencies.paymaster.getNonce(order.walletAddress)
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
        throw new GasAssistError('NORMAL_SWAP_SPONSORSHIP_DISABLED', 'Generic transaction sponsorship is not supported.', 409)
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
        const sponsorable = await dependencies.paymaster.isSponsorable(unsignedTransaction({
            walletAddress: order.walletAddress,
            transactionTo: intent.transactionTo,
            transactionData: intent.transactionData,
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
                [order.id, intent.action === 'fee-payment-transfer' ? 'payment-submitting' : 'approval-submitted'],
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
                 WHERE id=$1 AND status IN ('payment-submitting','approval-submitted')`,
                [order.id],
            )
            throw new GasAssistError('INTENT_EXPIRED', 'The sponsored intent expired before submission.', 409)
        }
        try {
            providerHash = await dependencies.paymaster.submit(signedRawTransaction)
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
                    updated_at=now() WHERE id=$1`,
            [order.id, intent.action === 'fee-payment-transfer' ? 'payment-submitted' : 'approval-submitted', intent.action, providerHash],
        )
        return { status: 'submitted', transactionHash: providerHash }
    }

    async function actualGasUsd(receipt: { gasUsed: bigint; effectiveGasPrice: bigint }) {
        const bnbPrice = await (async () => {
            const value = await import('../../providers/alchemy/token-prices.js').then(({ getNativeBnbPrice }) => getNativeBnbPrice())
            if (!value) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'BNB price is unavailable for gas settlement.', 503)
            return parseFixed(value)
        })()
        return ceilDiv(receipt.gasUsed * receipt.effectiveGasPrice * bnbPrice, 10n ** 18n)
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
                 VALUES ((now() at time zone 'utc')::date,56,$1,$2,$3,$4,jsonb_build_object($5,1))
                 ON CONFLICT (usage_date,chain_id,scope_type,scope_hash)
                 DO UPDATE SET sponsored_gas_usd_micros=sponsorship_usage.sponsored_gas_usd_micros+EXCLUDED.sponsored_gas_usd_micros,
                               reverted_attempts=sponsorship_usage.reverted_attempts+EXCLUDED.reverted_attempts,
                               token_action_counts=sponsorship_usage.token_action_counts || EXCLUDED.token_action_counts,
                               updated_at=now()`,
                [scopeType, scopeHash, gasUsdMicros.toString(), reverted ? 1 : 0, `${order.paymentToken}:${intent.action}`],
            )
        }
    }

    async function createWalletCredit(client: PoolClient, order: OrderRow, includePlatform: boolean, reason: string) {
        const actualGas = BigInt(order.actualSponsoredGasUsdMicros ?? '0')
        const unusedGas = BigInt(order.gasReserveUsdMicros) > actualGas
            ? BigInt(order.gasReserveUsdMicros) - actualGas
            : 0n
        const creditUsd = unusedGas + (includePlatform ? BigInt(order.platformFeeUsdMicros) : 0n)
        if (creditUsd === 0n) return
        const tokenAmount = proportionalRawFloor(
            BigInt(order.paymentAmountRaw),
            creditUsd,
            BigInt(order.totalPrepaymentUsdMicros),
        )
        await client.query(
            `INSERT INTO sponsorship_wallet_credits
             (wallet_address,chain_id,token_address,available_token_amount_raw,available_usd_micros,source_order_id)
             VALUES ($1,56,$2,$3,$4,$5) ON CONFLICT (source_order_id) DO NOTHING`,
            [order.walletAddress, order.paymentToken, tokenAmount.toString(), creditUsd.toString(), order.id],
        )
        await client.query(
            `INSERT INTO sponsorship_ledger
             (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw,failure_reason)
             VALUES ($1,$2,'walletCredit',$3,$4,$5,$6)`,
            [order.id, order.walletAddress, creditUsd.toString(), order.paymentToken, tokenAmount.toString(), reason],
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
        const gasUsdMicros = await actualGasUsd(receipt)
        const client = await dependencies.database.connect()
        try {
            await client.query('BEGIN')
            const lockedIntent = await loadIntent(client, intent.id, order.walletAddress, true)
            const lockedOrder = await loadOrder(client, order.id, order.walletAddress, true)
            if (!['submitted', 'unknown'].includes(lockedIntent.status)) {
                await client.query('COMMIT')
                return null
            }
            if (receipt.status !== 'success') {
                await chargeGas(client, lockedOrder, lockedIntent, gasUsdMicros, true)
                lockedOrder.actualSponsoredGasUsdMicros = (
                    BigInt(lockedOrder.actualSponsoredGasUsdMicros ?? '0') + gasUsdMicros
                ).toString()
                await client.query(`UPDATE sponsorship_transaction_intents SET status='reverted',failure_code='TRANSACTION_REVERTED',updated_at=now() WHERE id=$1`, [intent.id])
                if (intent.action === 'fee-payment-transfer') {
                    await client.query(`UPDATE sponsorship_orders SET status='failed',rejection_code='PAYMENT_REVERTED',updated_at=now() WHERE id=$1`, [order.id])
                } else {
                    await createWalletCredit(client, lockedOrder, true, 'approval-reverted')
                    await client.query(`UPDATE sponsorship_orders SET status='failed',rejection_code='APPROVAL_REVERTED',updated_at=now() WHERE id=$1`, [order.id])
                }
                await client.query('COMMIT')
                return { status: 'reverted' }
            }
            await chargeGas(client, lockedOrder, lockedIntent, gasUsdMicros, false)
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
                const reserveRaw = proportionalRawFloor(
                    BigInt(order.paymentAmountRaw),
                    BigInt(order.gasReserveUsdMicros),
                    BigInt(order.totalPrepaymentUsdMicros),
                )
                const commercialRaw = BigInt(order.paymentAmountRaw) - reserveRaw
                const serviceRaw = proportionalRawFloor(
                    commercialRaw,
                    BigInt(order.fixedServiceFeeUsdMicros),
                    BigInt(order.commercialFeeUsdMicros),
                )
                await client.query(
                    `INSERT INTO sponsorship_ledger (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw)
                     VALUES ($1,$2,'gasReserve',$3,$4,$5),($1,$2,'commercialFeeReserve',$6,$4,$7),($1,$2,'serviceFeeSettled',$8,$4,$9)`,
                    [order.id, order.walletAddress, order.gasReserveUsdMicros, order.paymentToken, reserveRaw.toString(), order.commercialFeeUsdMicros, commercialRaw.toString(), order.fixedServiceFeeUsdMicros, serviceRaw.toString()],
                )
                await client.query(
                    `UPDATE sponsorship_orders SET status='payment-confirmed',actual_payment_received_raw=$2,
                            payment_transaction_hash=$3,updated_at=now() WHERE id=$1`,
                    [order.id, received.toString(), intent.transactionHash],
                )
            } else if (intent.action === 'token-approval') {
                const allowance = await dependencies.chain.getAllowance(order.sellToken, order.walletAddress, order.approvalSpender)
                if (!isAddressEqual(transaction.from, order.walletAddress) || !transaction.to ||
                    !isAddressEqual(transaction.to, order.sellToken) || allowance < BigInt(order.approvalAmountRaw)) {
                    lockedOrder.actualSponsoredGasUsdMicros = (
                        BigInt(lockedOrder.actualSponsoredGasUsdMicros ?? '0') + gasUsdMicros
                    ).toString()
                    await createWalletCredit(client, lockedOrder, true, 'approval-receipt-invalid')
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
            }
            await client.query(`UPDATE sponsorship_transaction_intents SET status='confirmed',updated_at=now() WHERE id=$1`, [intent.id])
            await client.query('COMMIT')
            return { status: 'confirmed' }
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
    }

    async function prepareContinuation(orderId: string, walletAddress: string, clientIp: string) {
        const client = await dependencies.database.connect()
        let order: OrderRow
        try {
            await client.query('BEGIN')
            order = await loadOrder(client, orderId, walletAddress, true)
            if (order.status !== 'approval-confirmed') throw new GasAssistError('APPROVAL_NOT_CONFIRMED', 'The sponsored approval must confirm first.', 409)
            if (order.expiresAt <= dependencies.now()) throw new GasAssistError('ORDER_EXPIRED', 'The sponsorship order expired.', 409)
            await client.query(`UPDATE sponsorship_orders SET status='swap-preparing',updated_at=now() WHERE id=$1`, [order.id])
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
        let quote
        try {
            quote = await gaslessService().quotePrepaid({
                chainId: 56,
                walletAddress,
                sellToken: order.sellToken,
                buyToken: order.buyToken,
                sellAmount: order.netSwapAmountRaw,
                slippageBps: Number(order.providerQuoteSnapshot.slippageBps),
                clientIp,
            }, order.id)
        } catch (error) {
            await dependencies.database.query(
                `UPDATE sponsorship_orders SET status='approval-confirmed',updated_at=now()
                 WHERE id=$1 AND status='swap-preparing' AND provider_quote_id IS NULL`,
                [order.id],
            )
            throw error
        }
        if (quote.sellAmount !== order.netSwapAmountRaw || BigInt(quote.minBuyAmount) < BigInt(order.minimumOutputRaw)) {
            await dependencies.database.query(
                `UPDATE sponsorship_orders SET status='rejected',rejection_code='FRESH_QUOTE_OUTSIDE_SLIPPAGE',updated_at=now() WHERE id=$1`,
                [order.id],
            )
            throw new GasAssistError('FRESH_QUOTE_OUTSIDE_SLIPPAGE', 'The fresh 0x quote moved beyond the reviewed minimum output.', 409)
        }
        await dependencies.database.query(
            `UPDATE sponsorship_orders SET status='swap-preparing',provider_quote_id=$2,
                    provider_quote_expires_at=$3,provider_fees=$4::jsonb,expected_output_raw=$5,
                    minimum_output_raw=$6,updated_at=now()
             WHERE id=$1 AND status='swap-preparing' AND provider_quote_id IS NULL`,
            [order.id, quote.quoteId, quote.expiresAt, JSON.stringify(quote.fees), quote.buyAmount, quote.minBuyAmount],
        )
        return quote
    }

    async function settleGasless(order: OrderRow) {
        if (!order.providerQuoteId || order.status !== 'swap-preparing') return
        const stored = await gaslessService().load(order.providerQuoteId)
        if (!stored?.tradeHash) return
        const status = await gaslessService().status(stored.tradeHash)
        if (!['confirmed', 'failed'].includes(status.status)) return
        const client = await dependencies.database.connect()
        try {
            await client.query('BEGIN')
            const locked = await loadOrder(client, order.id, order.walletAddress, true)
            if (locked.status !== 'swap-preparing') {
                await client.query('COMMIT')
                return
            }
            if (status.status === 'confirmed') {
                const reserveRaw = proportionalRawFloor(
                    BigInt(locked.paymentAmountRaw),
                    BigInt(locked.gasReserveUsdMicros),
                    BigInt(locked.totalPrepaymentUsdMicros),
                )
                const commercialRaw = BigInt(locked.paymentAmountRaw) - reserveRaw
                const serviceRaw = proportionalRawFloor(
                    commercialRaw,
                    BigInt(locked.fixedServiceFeeUsdMicros),
                    BigInt(locked.commercialFeeUsdMicros),
                )
                const platformRaw = commercialRaw - serviceRaw
                await client.query(
                    `INSERT INTO sponsorship_ledger (order_id,wallet_address,entry_type,usd_micros,token_address,token_amount_raw)
                     VALUES ($1,$2,'platformFeeSettled',$3,$4,$5)`,
                    [locked.id, locked.walletAddress, locked.platformFeeUsdMicros, locked.paymentToken, platformRaw.toString()],
                )
                await createWalletCredit(client, locked, false, 'unused-gas-after-success')
                await client.query(
                    `UPDATE sponsorship_orders SET status='completed',swap_transaction_hash=$2,
                            platform_fee_settled_at=now(),completed_at=now(),updated_at=now() WHERE id=$1`,
                    [locked.id, status.transactionHash],
                )
            } else {
                await createWalletCredit(client, locked, true, 'zero-x-provider-failure')
                await client.query(`UPDATE sponsorship_orders SET status='failed',rejection_code='ZEROX_TRADE_FAILED',updated_at=now() WHERE id=$1`, [locked.id])
            }
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
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
        await settleGasless(order)
        order = await loadOrder(dependencies.database, orderId, walletAddress)
        if (order.expiresAt <= dependencies.now() && !['completed', 'expired', 'rejected', 'failed'].includes(order.status)) {
            const client = await dependencies.database.connect()
            try {
                await client.query('BEGIN')
                const locked = await loadOrder(client, order.id, order.walletAddress, true)
                if (locked.status.includes('confirmed') || ['approval-preparing', 'approval-submitted', 'swap-preparing'].includes(locked.status)) {
                    await createWalletCredit(client, locked, true, 'order-abandoned-or-expired')
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
                'approval-confirmed': 'request-fresh-zero-x-quote',
                'swap-preparing': 'sign-zero-x-typed-data',
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
}
