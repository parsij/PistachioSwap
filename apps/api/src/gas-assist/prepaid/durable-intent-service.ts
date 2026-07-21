import type { Pool, PoolClient } from 'pg'
import {
    isAddressEqual,
    type Address,
    type Hex,
} from 'viem'

import { getApiConfig } from '../../config.js'
import { getPool } from '../../db/client.js'
import { normalizeAddress } from '../../lib/address.js'
import { getNativeBnbPrice } from '../../providers/alchemy/token-prices.js'
import { GasAssistError } from '../errors.js'
import {
    prepaidActionPaymasterClient,
    prepaidFeePaymasterClient,
} from '../paymaster.js'
import {
    createPrepaidChainClient,
    validateSignedIntent,
    verifyExactTransferReceipt,
    type StoredIntentTemplate,
} from './chain-client.js'
import {
    ceilDiv,
    parseFixed,
    usdMicrosToTokenRawCeil,
} from './fixed-point.js'

export type SponsorshipIntentAction =
    | 'fee-payment-transfer'
    | 'token-approval'
    | 'normal-swap'

type IntentStatus =
    | 'prepared'
    | 'signing'
    | 'submitting'
    | 'submitted'
    | 'unknown'
    | 'confirmed'
    | 'reverted'
    | 'expired'
    | 'rejected'

type DurableIntentRow = StoredIntentTemplate & {
    id: string
    orderId: string
    action: SponsorshipIntentAction
    status: IntentStatus
    expiresAt: Date
    signedRawTransactionHash: Hex | null
    signedRawTransaction: Hex | null
    transactionHash: Hex | null
    submissionAttempts: number
    broadcastAttempts: number
    firstBroadcastAt: Date | null
    lastBroadcastAt: Date | null
}

type DurableOrderRow = {
    id: string
    status: string
    walletAddress: Address
    sellToken: Address
    buyToken: string
    paymentToken: Address
    paymentAmountRaw: string
    paymentTokenDecimals: number
    fixedServiceFeeUsdMicros: string
    platformFeeUsdMicros: string
    commercialFeeUsdMicros: string
    gasReserveUsdMicros: string
    totalPrepaymentUsdMicros: string
    estimatedPaymentGasUsdMicros: string
    conversionCostUsdMicros: string
    actualSponsoredGasUsdMicros: string | null
    approvalSpender: Address | null
    approvalAmountRaw: string | null
    expiresAt: Date
    providerQuoteSnapshot: Record<string, unknown>
    ipHash: string
}

type RecoverySummary = {
    scanned: number
    reconciled: number
    rebroadcast: number
    waiting: number
    failed: number
}

const MAX_BROADCAST_ATTEMPTS = 3
const RETRY_DELAY_MS = 15_000

function intentQuery(lock = false) {
    return `SELECT id,order_id AS "orderId",action,status,wallet_address AS "walletAddress",
                   transaction_to AS "transactionTo",transaction_data AS "transactionData",
                   transaction_data_hash AS "transactionDataHash",native_value::text AS "nativeValue",
                   chain_id AS "chainId",nonce::text,transaction_type AS "transactionType",
                   gas_limit::text AS "gasLimit",gas_price::text AS "gasPrice",
                   max_fee_per_gas::text AS "maxFeePerGas",
                   max_priority_fee_per_gas::text AS "maxPriorityFeePerGas",
                   expires_at AS "expiresAt",
                   signed_raw_transaction_hash AS "signedRawTransactionHash",
                   signed_raw_transaction AS "signedRawTransaction",
                   transaction_hash AS "transactionHash",
                   submission_attempts AS "submissionAttempts",
                   broadcast_attempts AS "broadcastAttempts",
                   first_broadcast_at AS "firstBroadcastAt",
                   last_broadcast_at AS "lastBroadcastAt"
            FROM sponsorship_transaction_intents
            WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`
}

function orderQuery(lock = false) {
    return `SELECT id,status,wallet_address AS "walletAddress",sell_token AS "sellToken",
                   buy_token AS "buyToken",payment_token AS "paymentToken",
                   payment_amount_raw::text AS "paymentAmountRaw",
                   payment_token_decimals AS "paymentTokenDecimals",
                   fixed_service_fee_usd_micros::text AS "fixedServiceFeeUsdMicros",
                   platform_fee_usd_micros::text AS "platformFeeUsdMicros",
                   commercial_fee_usd_micros::text AS "commercialFeeUsdMicros",
                   gas_reserve_usd_micros::text AS "gasReserveUsdMicros",
                   total_prepayment_usd_micros::text AS "totalPrepaymentUsdMicros",
                   estimated_payment_gas_usd_micros::text AS "estimatedPaymentGasUsdMicros",
                   conversion_cost_usd_micros::text AS "conversionCostUsdMicros",
                   actual_sponsored_gas_usd_micros::text AS "actualSponsoredGasUsdMicros",
                   approval_spender AS "approvalSpender",
                   approval_amount_raw::text AS "approvalAmountRaw",
                   expires_at AS "expiresAt",
                   COALESCE(provider_quote_snapshot,'{}'::jsonb) AS "providerQuoteSnapshot",
                   ip_hash AS "ipHash"
            FROM sponsorship_orders
            WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`
}

async function loadIntent(
    database: Pool | PoolClient,
    intentId: string,
    walletAddress: string,
    lock = false,
) {
    const result = await database.query<DurableIntentRow>(
        intentQuery(lock),
        [intentId, walletAddress.toLowerCase()],
    )
    const intent = result.rows[0]
    if (!intent) {
        throw new GasAssistError(
            'INTENT_NOT_FOUND',
            'The sponsorship intent was not found.',
            404,
        )
    }
    return intent
}

async function loadOrder(
    database: Pool | PoolClient,
    orderId: string,
    walletAddress: string,
    lock = false,
) {
    const result = await database.query<DurableOrderRow>(
        orderQuery(lock),
        [orderId, walletAddress.toLowerCase()],
    )
    const order = result.rows[0]
    if (!order) {
        throw new GasAssistError(
            'ORDER_NOT_FOUND',
            'The sponsorship order was not found.',
            404,
        )
    }
    return order
}

function normalizedRawTransaction(value: string) {
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
        throw new GasAssistError(
            'SIGNED_TRANSACTION_MISMATCH',
            'The signed transaction is malformed.',
        )
    }
    return value.toLowerCase() as Hex
}

function proportionalRawFloor(
    totalRaw: bigint,
    partUsd: bigint,
    totalUsd: bigint,
) {
    if (totalRaw < 0n || partUsd < 0n || totalUsd <= 0n) return 0n
    return totalRaw * partUsd / totalUsd
}

function submittedOrderStatus(action: SponsorshipIntentAction) {
    return {
        'fee-payment-transfer': 'payment-submitted',
        'token-approval': 'approval-submitted',
        'normal-swap': 'swap-submitted',
    }[action]
}

function paymasterForAction(action: SponsorshipIntentAction) {
    return action === 'fee-payment-transfer'
        ? prepaidFeePaymasterClient
        : prepaidActionPaymasterClient
}

function canRetryBroadcast(
    intent: Pick<
        DurableIntentRow,
        | 'status'
        | 'signedRawTransaction'
        | 'broadcastAttempts'
        | 'lastBroadcastAt'
        | 'expiresAt'
    >,
    now = new Date(),
) {
    if (!['submitting', 'submitted', 'unknown'].includes(intent.status)) {
        return false
    }
    if (!intent.signedRawTransaction || intent.expiresAt <= now) return false
    if (intent.broadcastAttempts >= MAX_BROADCAST_ATTEMPTS) return false
    return !intent.lastBroadcastAt ||
        now.getTime() - intent.lastBroadcastAt.getTime() >= RETRY_DELAY_MS
}

async function actualGasUsd(
    receipt: { gasUsed: bigint; effectiveGasPrice: bigint },
    order: DurableOrderRow,
    intent: DurableIntentRow,
) {
    const bnbPrice = await getNativeBnbPrice()
    if (!bnbPrice) {
        throw new GasAssistError(
            'TRUSTED_PRICE_UNAVAILABLE',
            'BNB price is unavailable for gas settlement.',
            503,
        )
    }
    const snapshotKey = {
        'fee-payment-transfer': 'paymentGas',
        'token-approval': 'approvalGas',
        'normal-swap': 'swapGas',
    }[intent.action]
    const snapshot = order.providerQuoteSnapshot[snapshotKey] as
        | Record<string, unknown>
        | undefined
    const fallbackGasPrice = /^\d+$/.test(String(snapshot?.currentGasPrice ?? ''))
        ? BigInt(String(snapshot?.currentGasPrice))
        : 0n
    const effectiveGasPrice = receipt.effectiveGasPrice > 0n
        ? receipt.effectiveGasPrice
        : fallbackGasPrice
    if (effectiveGasPrice <= 0n) {
        throw new GasAssistError(
            'SPONSORED_GAS_COST_UNKNOWN',
            'The sponsored gas cost cannot be reconciled safely yet.',
            503,
        )
    }
    return ceilDiv(
        receipt.gasUsed * effectiveGasPrice * parseFixed(bnbPrice),
        10n ** 18n,
    )
}

async function chargeGas(
    client: PoolClient,
    order: DurableOrderRow,
    intent: DurableIntentRow,
    gasUsdMicros: bigint,
    reverted: boolean,
) {
    const snapshotPrice = BigInt(String(
        order.providerQuoteSnapshot.paymentPriceUsdMicros,
    ))
    const tokenAmountRaw = usdMicrosToTokenRawCeil({
        usdMicros: gasUsdMicros,
        tokenPriceUsdMicros: snapshotPrice,
        tokenDecimals: order.paymentTokenDecimals,
    })
    await client.query(
        `INSERT INTO sponsorship_ledger
         (order_id,wallet_address,entry_type,usd_micros,token_address,
          token_amount_raw,action,failure_reason)
         VALUES ($1,$2,'actualGasConsumed',$3,$4,$5,$6,$7)`,
        [
            order.id,
            order.walletAddress,
            gasUsdMicros.toString(),
            order.paymentToken,
            tokenAmountRaw.toString(),
            intent.action,
            reverted ? 'transaction-reverted' : null,
        ],
    )
    await client.query(
        `UPDATE sponsorship_orders
         SET actual_sponsored_gas_usd_micros=
                 COALESCE(actual_sponsored_gas_usd_micros,0)+$2,
             updated_at=now()
         WHERE id=$1`,
        [order.id, gasUsdMicros.toString()],
    )

    const scopes: Array<[string, string]> = [
        ['wallet', order.walletAddress],
        ['ip', order.ipHash],
        ['global', 'global'],
    ]
    for (const [scopeType, scopeHash] of scopes) {
        const actionKey = `${order.paymentToken}:${intent.action}`
        await client.query(
            `INSERT INTO sponsorship_usage
             (usage_date,chain_id,scope_type,scope_hash,
              sponsored_gas_usd_micros,reverted_attempts,token_action_counts)
             VALUES (
               (now() at time zone 'utc')::date,
               56,$1,$2,$3,$4,jsonb_build_object($5::text,1)
             )
             ON CONFLICT (usage_date,chain_id,scope_type,scope_hash)
             DO UPDATE SET
               sponsored_gas_usd_micros=
                 sponsorship_usage.sponsored_gas_usd_micros+
                 EXCLUDED.sponsored_gas_usd_micros,
               reverted_attempts=
                 sponsorship_usage.reverted_attempts+
                 EXCLUDED.reverted_attempts,
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
            [
                scopeType,
                scopeHash,
                gasUsdMicros.toString(),
                reverted ? 1 : 0,
                actionKey,
            ],
        )
    }
}

async function createPendingRefund(
    client: PoolClient,
    order: DurableOrderRow,
    reason: string,
    actualGasUsdMicros: bigint,
) {
    const refundGasUsdMicros = BigInt(order.estimatedPaymentGasUsdMicros)
    const paymentPriceUsdMicros = BigInt(String(
        order.providerQuoteSnapshot.paymentPriceUsdMicros,
    ))
    const nonrefundableRaw = usdMicrosToTokenRawCeil({
        usdMicros: actualGasUsdMicros + refundGasUsdMicros,
        tokenPriceUsdMicros: paymentPriceUsdMicros,
        tokenDecimals: order.paymentTokenDecimals,
    })
    const paidRaw = BigInt(order.paymentAmountRaw)
    const refundableRaw = paidRaw > nonrefundableRaw
        ? paidRaw - nonrefundableRaw
        : 0n
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
         (order_id,wallet_address,entry_type,usd_micros,token_address,
          token_amount_raw,failure_reason)
         VALUES ($1,$2,'refundPending',0,$3,$4,$5)`,
        [
            order.id,
            order.walletAddress,
            order.paymentToken,
            refundableRaw.toString(),
            reason,
        ],
    )
}

async function markSubmitted(
    database: Pool,
    intent: DurableIntentRow,
    transactionHash: Hex,
) {
    const client = await database.connect()
    try {
        await client.query('BEGIN')
        await client.query(
            `UPDATE sponsorship_transaction_intents
             SET status='submitted',transaction_hash=$2,
                 submitted_at=COALESCE(submitted_at,now()),
                 failure_code=NULL,updated_at=now()
             WHERE id=$1 AND status IN ('submitting','submitted','unknown')`,
            [intent.id, transactionHash],
        )
        await client.query(
            `UPDATE sponsorship_orders
             SET status=$2,
                 payment_transaction_hash=CASE
                   WHEN $3::text='fee-payment-transfer' THEN $4
                   ELSE payment_transaction_hash
                 END,
                 approval_transaction_hash=CASE
                   WHEN $3::text='token-approval' THEN $4
                   ELSE approval_transaction_hash
                 END,
                 swap_transaction_hash=CASE
                   WHEN $3::text='normal-swap' THEN $4
                   ELSE swap_transaction_hash
                 END,
                 rejection_code=NULL,updated_at=now()
             WHERE id=$1
               AND status NOT IN ('completed','expired','rejected','failed')`,
            [
                intent.orderId,
                submittedOrderStatus(intent.action),
                intent.action,
                transactionHash,
            ],
        )
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

async function markSubmissionUnknown(
    database: Pool,
    intent: DurableIntentRow,
    failureCode: string,
) {
    const client = await database.connect()
    try {
        await client.query('BEGIN')
        await client.query(
            `UPDATE sponsorship_transaction_intents
             SET status='unknown',
                 transaction_hash=COALESCE(transaction_hash,signed_raw_transaction_hash),
                 failure_code=$2,updated_at=now()
             WHERE id=$1 AND status IN ('submitting','unknown')`,
            [intent.id, failureCode],
        )
        await client.query(
            `UPDATE sponsorship_orders
             SET status='unknown',rejection_code=$2,updated_at=now()
             WHERE id=$1
               AND status NOT IN ('completed','expired','rejected','failed')`,
            [intent.orderId, failureCode],
        )
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}

export function createDurableSponsorshipIntentService(
    database: Pool = getPool(),
) {
    const chain = createPrepaidChainClient()

    async function captureSignedIntent({
        intentId,
        signedRawTransaction: rawValue,
        walletAddress,
    }: {
        intentId: string
        signedRawTransaction: string
        walletAddress: string
    }) {
        const rawTransaction = normalizedRawTransaction(rawValue)
        const intent = await loadIntent(database, intentId, walletAddress)
        if (!['prepared', 'signing'].includes(intent.status) ||
            intent.submissionAttempts !== 0 ||
            intent.expiresAt <= new Date()) {
            throw new GasAssistError(
                'INTENT_ALREADY_USED',
                'This sponsored intent cannot accept another signature.',
                409,
            )
        }
        const verification = await validateSignedIntent(rawTransaction, intent)
        const client = await database.connect()
        try {
            await client.query('BEGIN')
            const locked = await loadIntent(
                client,
                intent.id,
                walletAddress,
                true,
            )
            if (!['prepared', 'signing'].includes(locked.status) ||
                locked.submissionAttempts !== 0 ||
                locked.expiresAt <= new Date()) {
                throw new GasAssistError(
                    'INTENT_ALREADY_USED',
                    'This sponsored intent cannot accept another signature.',
                    409,
                )
            }
            if (locked.signedRawTransaction &&
                locked.signedRawTransaction !== rawTransaction) {
                throw new GasAssistError(
                    'SIGNED_TRANSACTION_MISMATCH',
                    'A different signed transaction is already stored for this intent.',
                    409,
                )
            }
            await client.query(
                `UPDATE sponsorship_transaction_intents
                 SET signed_raw_transaction=$2,
                     signed_raw_transaction_hash=$3,
                     signed_at=COALESCE(signed_at,now()),
                     updated_at=now()
                 WHERE id=$1`,
                [intent.id, rawTransaction, verification.transactionHash],
            )
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
        return { transactionHash: verification.transactionHash }
    }

    async function settleIntent(intent: DurableIntentRow) {
        const transactionHash = intent.transactionHash ??
            intent.signedRawTransactionHash
        if (!transactionHash ||
            !['submitting', 'submitted', 'unknown'].includes(intent.status)) {
            return false
        }

        const [receipt, transaction, order] = await Promise.all([
            chain.getReceipt(transactionHash),
            chain.getTransaction(transactionHash),
            loadOrder(database, intent.orderId, intent.walletAddress),
        ])
        const gasUsdMicros = await actualGasUsd(receipt, order, intent)
        const client = await database.connect()
        try {
            await client.query('BEGIN')
            const lockedIntent = await loadIntent(
                client,
                intent.id,
                intent.walletAddress,
                true,
            )
            const lockedOrder = await loadOrder(
                client,
                order.id,
                order.walletAddress,
                true,
            )
            if (!['submitting', 'submitted', 'unknown'].includes(
                lockedIntent.status,
            )) {
                await client.query('COMMIT')
                return false
            }

            const actualGasAfter = BigInt(
                lockedOrder.actualSponsoredGasUsdMicros ?? '0',
            ) + gasUsdMicros
            await chargeGas(
                client,
                lockedOrder,
                lockedIntent,
                gasUsdMicros,
                receipt.status !== 'success',
            )
            lockedOrder.actualSponsoredGasUsdMicros = actualGasAfter.toString()

            if (receipt.status !== 'success') {
                await client.query(
                    `UPDATE sponsorship_transaction_intents
                     SET status='reverted',failure_code='TRANSACTION_REVERTED',
                         finalized_at=COALESCE(finalized_at,now()),updated_at=now()
                     WHERE id=$1`,
                    [lockedIntent.id],
                )
                if (lockedIntent.action === 'fee-payment-transfer') {
                    await client.query(
                        `UPDATE sponsorship_orders
                         SET status='failed',rejection_code='PAYMENT_REVERTED',
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedOrder.id],
                    )
                } else {
                    await createPendingRefund(
                        client,
                        lockedOrder,
                        lockedIntent.action === 'token-approval'
                            ? 'approval-reverted'
                            : 'swap-reverted',
                        actualGasAfter,
                    )
                    await client.query(
                        `UPDATE sponsorship_orders
                         SET status='failed',rejection_code=$2,updated_at=now()
                         WHERE id=$1`,
                        [
                            lockedOrder.id,
                            lockedIntent.action === 'token-approval'
                                ? 'APPROVAL_REVERTED'
                                : 'SWAP_REVERTED',
                        ],
                    )
                }
                await client.query('COMMIT')
                return true
            }

            if (lockedIntent.action === 'fee-payment-transfer') {
                let received: bigint
                try {
                    received = verifyExactTransferReceipt({
                        receipt,
                        transactionFrom: transaction.from,
                        transactionTo: transaction.to,
                        wallet: lockedOrder.walletAddress,
                        token: lockedOrder.paymentToken,
                        treasury: getApiConfig().fees.treasuryAddress as Address,
                        requiredAmount: BigInt(lockedOrder.paymentAmountRaw),
                    })
                } catch {
                    await client.query(
                        `UPDATE sponsorship_transaction_intents
                         SET status='rejected',
                             failure_code='PAYMENT_RECEIPT_INVALID',
                             finalized_at=COALESCE(finalized_at,now()),
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedIntent.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_orders
                         SET status='failed',
                             rejection_code='PAYMENT_RECEIPT_INVALID',
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedOrder.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_usage
                         SET failed_payment_attempts=failed_payment_attempts+1,
                             updated_at=now()
                         WHERE usage_date=(now() at time zone 'utc')::date
                           AND chain_id=56
                           AND scope_type='wallet'
                           AND scope_hash=$1`,
                        [lockedOrder.walletAddress],
                    )
                    await client.query('COMMIT')
                    return true
                }

                const reserveAndConversionUsd =
                    BigInt(lockedOrder.gasReserveUsdMicros) +
                    BigInt(lockedOrder.conversionCostUsdMicros)
                const reserveRaw = proportionalRawFloor(
                    BigInt(lockedOrder.paymentAmountRaw),
                    reserveAndConversionUsd,
                    BigInt(lockedOrder.totalPrepaymentUsdMicros),
                )
                const commercialRaw =
                    BigInt(lockedOrder.paymentAmountRaw) - reserveRaw
                const serviceRaw = proportionalRawFloor(
                    commercialRaw,
                    BigInt(lockedOrder.fixedServiceFeeUsdMicros),
                    BigInt(lockedOrder.commercialFeeUsdMicros),
                )
                const grantExpiresAt = new Date(Date.now() + 5 * 60 * 1_000)
                await client.query(
                    `INSERT INTO sponsorship_ledger
                     (order_id,wallet_address,entry_type,usd_micros,
                      token_address,token_amount_raw)
                     VALUES ($1,$2,'gasAndConversionReserve',$3,$4,$5),
                            ($1,$2,'commercialFeeReserve',$6,$4,$7),
                            ($1,$2,'serviceFeeReserved',$8,$4,$9)`,
                    [
                        lockedOrder.id,
                        lockedOrder.walletAddress,
                        reserveAndConversionUsd.toString(),
                        lockedOrder.paymentToken,
                        reserveRaw.toString(),
                        lockedOrder.commercialFeeUsdMicros,
                        commercialRaw.toString(),
                        lockedOrder.fixedServiceFeeUsdMicros,
                        serviceRaw.toString(),
                    ],
                )
                await client.query(
                    `UPDATE sponsorship_orders
                     SET status='payment-confirmed',
                         actual_payment_received_raw=$2,
                         payment_transaction_hash=$3,
                         fee_confirmed_at=now(),
                         grant_expires_at=$4,
                         expires_at=$4,
                         rejection_code=NULL,
                         updated_at=now()
                     WHERE id=$1`,
                    [
                        lockedOrder.id,
                        received.toString(),
                        transactionHash,
                        grantExpiresAt,
                    ],
                )
            } else if (lockedIntent.action === 'token-approval') {
                const allowance = lockedOrder.approvalSpender
                    ? await chain.getAllowance(
                        lockedOrder.sellToken,
                        lockedOrder.walletAddress,
                        lockedOrder.approvalSpender,
                    )
                    : 0n
                const approvalAmount = lockedOrder.approvalAmountRaw
                    ? BigInt(lockedOrder.approvalAmountRaw)
                    : 0n
                if (!isAddressEqual(transaction.from, lockedOrder.walletAddress) ||
                    !transaction.to ||
                    !isAddressEqual(transaction.to, lockedOrder.sellToken) ||
                    allowance < approvalAmount ||
                    approvalAmount <= 0n) {
                    await createPendingRefund(
                        client,
                        lockedOrder,
                        'approval-receipt-invalid',
                        actualGasAfter,
                    )
                    await client.query(
                        `UPDATE sponsorship_transaction_intents
                         SET status='rejected',
                             failure_code='APPROVAL_RECEIPT_INVALID',
                             finalized_at=COALESCE(finalized_at,now()),
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedIntent.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_orders
                         SET status='failed',
                             rejection_code='APPROVAL_RECEIPT_INVALID',
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedOrder.id],
                    )
                    await client.query('COMMIT')
                    return true
                }
                await client.query(
                    `UPDATE sponsorship_orders
                     SET status='approval-confirmed',
                         approval_transaction_hash=$2,
                         provider_quote_id=NULL,
                         provider_quote_expires_at=NULL,
                         rejection_code=NULL,
                         updated_at=now()
                     WHERE id=$1`,
                    [lockedOrder.id, transactionHash],
                )
            } else {
                const quote = lockedOrder.providerQuoteSnapshot.quote as
                    | Record<string, unknown>
                    | undefined
                const expectedTransaction = quote?.transaction as
                    | Record<string, unknown>
                    | undefined
                const expectedTarget = normalizeAddress(
                    String(expectedTransaction?.to ?? ''),
                )
                if (!isAddressEqual(transaction.from, lockedOrder.walletAddress) ||
                    !transaction.to ||
                    !expectedTarget ||
                    !isAddressEqual(transaction.to, expectedTarget)) {
                    await client.query(
                        `UPDATE sponsorship_transaction_intents
                         SET status='unknown',
                             failure_code='SWAP_RECEIPT_INVALID',
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedIntent.id],
                    )
                    await client.query(
                        `UPDATE sponsorship_orders
                         SET status='unknown',
                             rejection_code='SWAP_RECEIPT_INVALID',
                             updated_at=now()
                         WHERE id=$1`,
                        [lockedOrder.id],
                    )
                    await client.query('COMMIT')
                    return true
                }
                const reserveRaw = proportionalRawFloor(
                    BigInt(lockedOrder.paymentAmountRaw),
                    BigInt(lockedOrder.gasReserveUsdMicros) +
                        BigInt(lockedOrder.conversionCostUsdMicros),
                    BigInt(lockedOrder.totalPrepaymentUsdMicros),
                )
                const commercialRaw =
                    BigInt(lockedOrder.paymentAmountRaw) - reserveRaw
                const serviceRaw = proportionalRawFloor(
                    commercialRaw,
                    BigInt(lockedOrder.fixedServiceFeeUsdMicros),
                    BigInt(lockedOrder.commercialFeeUsdMicros),
                )
                const platformRaw = commercialRaw - serviceRaw
                await client.query(
                    `INSERT INTO sponsorship_ledger
                     (order_id,wallet_address,entry_type,usd_micros,
                      token_address,token_amount_raw)
                     VALUES ($1,$2,'serviceFeeSettled',$3,$4,$5),
                            ($1,$2,'platformFeeSettled',$6,$4,$7)`,
                    [
                        lockedOrder.id,
                        lockedOrder.walletAddress,
                        lockedOrder.fixedServiceFeeUsdMicros,
                        lockedOrder.paymentToken,
                        serviceRaw.toString(),
                        lockedOrder.platformFeeUsdMicros,
                        platformRaw.toString(),
                    ],
                )
                await client.query(
                    `UPDATE sponsorship_orders
                     SET status='completed',swap_transaction_hash=$2,
                         platform_fee_settled_at=now(),completed_at=now(),
                         rejection_code=NULL,updated_at=now()
                     WHERE id=$1`,
                    [lockedOrder.id, transactionHash],
                )
            }

            await client.query(
                `UPDATE sponsorship_transaction_intents
                 SET status='confirmed',
                     transaction_hash=$2,
                     finalized_at=COALESCE(finalized_at,now()),
                     failure_code=NULL,
                     updated_at=now()
                 WHERE id=$1`,
                [lockedIntent.id, transactionHash],
            )
            await client.query('COMMIT')
            return true
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
    }

    async function reconcileOrder(orderId: string, walletAddress: string) {
        const result = await database.query<DurableIntentRow>(
            `${intentQuery(false).replace(
                'WHERE id=$1 AND wallet_address=$2',
                'WHERE order_id=$1 AND wallet_address=$2',
            )}
             AND status IN ('submitting','submitted','unknown')
             ORDER BY created_at`,
            [orderId, walletAddress.toLowerCase()],
        )
        let reconciled = 0
        for (const intent of result.rows) {
            try {
                if (await settleIntent(intent)) reconciled += 1
            } catch (error) {
                const missingReceipt = error &&
                    typeof error === 'object' &&
                    'name' in error &&
                    String((error as { name?: unknown }).name)
                        .includes('TransactionReceiptNotFound')
                if (!missingReceipt) throw error
            }
        }
        return { reconciled }
    }

    async function recoverPendingIntents(limit = 25): Promise<RecoverySummary> {
        const summary: RecoverySummary = {
            scanned: 0,
            reconciled: 0,
            rebroadcast: 0,
            waiting: 0,
            failed: 0,
        }
        const candidates = await database.query<DurableIntentRow>(
            `SELECT id,order_id AS "orderId",action,status,
                    wallet_address AS "walletAddress",
                    transaction_to AS "transactionTo",
                    transaction_data AS "transactionData",
                    transaction_data_hash AS "transactionDataHash",
                    native_value::text AS "nativeValue",chain_id AS "chainId",
                    nonce::text,transaction_type AS "transactionType",
                    gas_limit::text AS "gasLimit",gas_price::text AS "gasPrice",
                    max_fee_per_gas::text AS "maxFeePerGas",
                    max_priority_fee_per_gas::text AS "maxPriorityFeePerGas",
                    expires_at AS "expiresAt",
                    signed_raw_transaction_hash AS "signedRawTransactionHash",
                    signed_raw_transaction AS "signedRawTransaction",
                    transaction_hash AS "transactionHash",
                    submission_attempts AS "submissionAttempts",
                    broadcast_attempts AS "broadcastAttempts",
                    first_broadcast_at AS "firstBroadcastAt",
                    last_broadcast_at AS "lastBroadcastAt"
             FROM sponsorship_transaction_intents
             WHERE status IN ('submitting','submitted','unknown')
               AND COALESCE(transaction_hash,signed_raw_transaction_hash) IS NOT NULL
             ORDER BY updated_at
             LIMIT $1`,
            [Math.max(1, Math.min(limit, 100))],
        )

        for (const candidate of candidates.rows) {
            summary.scanned += 1
            try {
                if (await settleIntent(candidate)) {
                    summary.reconciled += 1
                    continue
                }
            } catch {
                // A receipt, transaction, or price may not be available yet.
            }

            if (!canRetryBroadcast(candidate)) {
                summary.waiting += 1
                continue
            }
            if (getApiConfig().sponsorship.emergencyDisabled) {
                summary.waiting += 1
                continue
            }

            const retryBefore = new Date(Date.now() - RETRY_DELAY_MS)
            const claimed = await database.query<DurableIntentRow>(
                `UPDATE sponsorship_transaction_intents
                 SET broadcast_attempts=broadcast_attempts+1,
                     first_broadcast_at=COALESCE(first_broadcast_at,now()),
                     last_broadcast_at=now(),updated_at=now()
                 WHERE id=$1
                   AND status IN ('submitting','submitted','unknown')
                   AND signed_raw_transaction IS NOT NULL
                   AND broadcast_attempts < $2
                   AND expires_at > now()
                   AND (last_broadcast_at IS NULL OR last_broadcast_at <= $3)
                 RETURNING id,order_id AS "orderId",action,status,
                           wallet_address AS "walletAddress",
                           transaction_to AS "transactionTo",
                           transaction_data AS "transactionData",
                           transaction_data_hash AS "transactionDataHash",
                           native_value::text AS "nativeValue",
                           chain_id AS "chainId",nonce::text,
                           transaction_type AS "transactionType",
                           gas_limit::text AS "gasLimit",
                           gas_price::text AS "gasPrice",
                           max_fee_per_gas::text AS "maxFeePerGas",
                           max_priority_fee_per_gas::text AS "maxPriorityFeePerGas",
                           expires_at AS "expiresAt",
                           signed_raw_transaction_hash AS "signedRawTransactionHash",
                           signed_raw_transaction AS "signedRawTransaction",
                           transaction_hash AS "transactionHash",
                           submission_attempts AS "submissionAttempts",
                           broadcast_attempts AS "broadcastAttempts",
                           first_broadcast_at AS "firstBroadcastAt",
                           last_broadcast_at AS "lastBroadcastAt"`,
                [candidate.id, MAX_BROADCAST_ATTEMPTS, retryBefore],
            )
            const intent = claimed.rows[0]
            if (!intent?.signedRawTransaction) {
                summary.waiting += 1
                continue
            }
            const expectedHash = intent.transactionHash ??
                intent.signedRawTransactionHash
            if (!expectedHash) {
                summary.failed += 1
                continue
            }

            try {
                const providerHash = await paymasterForAction(intent.action)
                    .submit(intent.signedRawTransaction)
                if (providerHash.toLowerCase() !== expectedHash.toLowerCase()) {
                    await markSubmissionUnknown(
                        database,
                        intent,
                        'PAYMASTER_HASH_MISMATCH',
                    )
                    summary.failed += 1
                    continue
                }
                await markSubmitted(database, intent, providerHash)
                summary.rebroadcast += 1
            } catch {
                try {
                    await chain.getTransaction(expectedHash)
                    await markSubmitted(database, intent, expectedHash)
                    summary.reconciled += 1
                } catch {
                    if (intent.status !== 'submitted') {
                        await markSubmissionUnknown(
                            database,
                            intent,
                            'RECOVERY_SUBMISSION_UNKNOWN',
                        )
                    }
                    summary.failed += 1
                }
            }
        }
        return summary
    }

    return {
        captureSignedIntent,
        reconcileOrder,
        recoverPendingIntents,
    }
}

export const durableIntentInternals = {
    MAX_BROADCAST_ATTEMPTS,
    RETRY_DELAY_MS,
    canRetryBroadcast,
    normalizedRawTransaction,
    submittedOrderStatus,
}
