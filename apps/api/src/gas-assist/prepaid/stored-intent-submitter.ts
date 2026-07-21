import type { Pool, PoolClient } from 'pg'
import {
    decodeFunctionData,
    isAddressEqual,
    toHex,
    type Address,
    type Hex,
} from 'viem'

import { getApiConfig } from '../../config.js'
import { getPool } from '../../db/client.js'
import { GasAssistError } from '../errors.js'
import { approveAbi, UINT256_MAX } from '../exact-approval.js'
import {
    prepaidActionPaymasterClient,
    prepaidFeePaymasterClient,
} from '../paymaster.js'
import {
    createPrepaidChainClient,
    transferAbi,
    validateSignedIntent,
    type StoredIntentTemplate,
} from './chain-client.js'
import { parseFixed } from './fixed-point.js'
import { getSponsorshipTokenEvidence } from './token-evidence.js'

export type StoredPackageAction =
    | 'fee-payment-transfer'
    | 'token-approval'
    | 'normal-swap'

type StoredOrderRow = {
    id: string
    status: string
    walletAddress: Address
    sellToken: Address
    netSwapAmountRaw: string
    paymentToken: Address
    paymentAmountRaw: string
    approvalSpender: Address
    approvalAmountRaw: string
    gasReserveUsdMicros: string
    actualSponsoredGasUsdMicros: string | null
    providerQuoteSnapshot: Record<string, unknown>
    expiresAt: Date
    ipHash: string
}

type StoredIntentRow = StoredIntentTemplate & {
    id: string
    orderId: string
    action: StoredPackageAction
    status: string
    expiresAt: Date
    signedRawTransaction: Hex | null
    signedRawTransactionHash: Hex | null
    transactionHash: Hex | null
    submissionAttempts: number
}

function orderStatusForAction(action: StoredPackageAction) {
    return {
        'fee-payment-transfer': 'payment-prepared',
        'token-approval': 'payment-confirmed',
        'normal-swap': 'approval-confirmed',
    }[action]
}

function submittingOrderStatus(action: StoredPackageAction) {
    return {
        'fee-payment-transfer': 'payment-submitting',
        'token-approval': 'approval-submitted',
        'normal-swap': 'swap-submitted',
    }[action]
}

function submittedOrderStatus(action: StoredPackageAction) {
    return {
        'fee-payment-transfer': 'payment-submitted',
        'token-approval': 'approval-submitted',
        'normal-swap': 'swap-submitted',
    }[action]
}

function paymasterForAction(action: StoredPackageAction) {
    return action === 'fee-payment-transfer'
        ? prepaidFeePaymasterClient
        : prepaidActionPaymasterClient
}

function unsignedTransaction(
    order: StoredOrderRow,
    intent: StoredIntentRow,
) {
    return {
        from: order.walletAddress,
        to: intent.transactionTo,
        data: intent.transactionData,
        value: toHex(BigInt(intent.nativeValue)),
        chainId: toHex(intent.chainId),
        nonce: toHex(BigInt(intent.nonce)),
        gas: toHex(BigInt(intent.gasLimit)),
        gasPrice: '0x0',
        type: '0x0',
    }
}

async function loadOrder(
    database: Pool | PoolClient,
    orderId: string,
    walletAddress: string,
    lock = false,
) {
    const result = await database.query<StoredOrderRow>(
        `SELECT id,status,wallet_address AS "walletAddress",
                sell_token AS "sellToken",
                net_swap_amount_raw::text AS "netSwapAmountRaw",
                payment_token AS "paymentToken",
                payment_amount_raw::text AS "paymentAmountRaw",
                approval_spender AS "approvalSpender",
                approval_amount_raw::text AS "approvalAmountRaw",
                gas_reserve_usd_micros::text AS "gasReserveUsdMicros",
                actual_sponsored_gas_usd_micros::text AS "actualSponsoredGasUsdMicros",
                COALESCE(provider_quote_snapshot,'{}'::jsonb) AS "providerQuoteSnapshot",
                expires_at AS "expiresAt",ip_hash AS "ipHash"
         FROM sponsorship_orders
         WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`,
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

async function loadIntent(
    database: Pool | PoolClient,
    intentId: string,
    walletAddress: string,
    lock = false,
) {
    const result = await database.query<StoredIntentRow>(
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
                signed_raw_transaction AS "signedRawTransaction",
                signed_raw_transaction_hash AS "signedRawTransactionHash",
                transaction_hash AS "transactionHash",
                submission_attempts AS "submissionAttempts"
         FROM sponsorship_transaction_intents
         WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`,
        [intentId, walletAddress.toLowerCase()],
    )
    const intent = result.rows[0]
    if (!intent) {
        throw new GasAssistError(
            'INTENT_NOT_FOUND',
            'The sponsored transaction intent was not found.',
            404,
        )
    }
    return intent
}

async function assertPaymentEvidence(
    database: Pool,
    order: StoredOrderRow,
) {
    const rule = await database.query<{
        enabled: boolean
        feePaymentEnabled: boolean
        minimumLiquidityUsdMicros: string
        maximumPriceAgeSeconds: number
        maximumPriceDeviationBps: number
    }>(
        `SELECT enabled,fee_payment_enabled AS "feePaymentEnabled",
                minimum_liquidity_usd_micros::text AS "minimumLiquidityUsdMicros",
                maximum_price_age_seconds AS "maximumPriceAgeSeconds",
                maximum_price_deviation_bps AS "maximumPriceDeviationBps"
         FROM sponsorship_payment_tokens
         WHERE chain_id=56 AND token_address=$1`,
        [order.paymentToken],
    )
    const tokenRule = rule.rows[0]
    if (!tokenRule?.enabled || !tokenRule.feePaymentEnabled) {
        throw new GasAssistError(
            'PAYMENT_TOKEN_DISABLED',
            'The payment token is no longer enabled.',
            409,
        )
    }
    const evidence = await getSponsorshipTokenEvidence(order.paymentToken)
    if (!evidence.priceUsdMicros || evidence.priceDeviationBps === null) {
        throw new GasAssistError(
            'PAYMENT_TOKEN_PRICE_UNAVAILABLE',
            'The payment-token price is unavailable.',
            503,
        )
    }
    const age = Date.now() - evidence.priceObservedAt.getTime()
    const config = getApiConfig().sponsorship
    if (age < 0 || age > Math.min(
        tokenRule.maximumPriceAgeSeconds,
        config.maximumPriceAgeSeconds,
    ) * 1_000) {
        throw new GasAssistError(
            'PAYMENT_TOKEN_PRICE_STALE',
            'The payment-token price is stale.',
            409,
        )
    }
    if (evidence.priceDeviationBps > Math.min(
        tokenRule.maximumPriceDeviationBps,
        config.maximumPriceDeviationBps,
    )) {
        throw new GasAssistError(
            'PAYMENT_TOKEN_PRICE_DEVIATION',
            'The payment-token price sources disagree.',
            409,
        )
    }
    const minimumLiquidity = BigInt(tokenRule.minimumLiquidityUsdMicros) >
        parseFixed(config.minimumPaymentTokenLiquidityUsd)
        ? BigInt(tokenRule.minimumLiquidityUsdMicros)
        : parseFixed(config.minimumPaymentTokenLiquidityUsd)
    if (evidence.liquidityUsdMicros < minimumLiquidity) {
        throw new GasAssistError(
            'PAYMENT_TOKEN_LIQUIDITY_LOW',
            'The payment token no longer has enough confirmed liquidity.',
            409,
        )
    }
}

async function assertBusinessState(
    database: Pool,
    chain: ReturnType<typeof createPrepaidChainClient>,
    order: StoredOrderRow,
    intent: StoredIntentRow,
) {
    if (intent.action === 'fee-payment-transfer') {
        await assertPaymentEvidence(database, order)
        const decoded = decodeFunctionData({
            abi: transferAbi,
            data: intent.transactionData,
        })
        const [recipient, amount] = decoded.args
        const treasury = getApiConfig().fees.treasuryAddress
        if (decoded.functionName !== 'transfer' || !treasury ||
            !isAddressEqual(recipient, treasury) ||
            amount !== BigInt(order.paymentAmountRaw) ||
            !isAddressEqual(intent.transactionTo, order.paymentToken)) {
            throw new GasAssistError(
                'SIGNED_TRANSACTION_MISMATCH',
                'The stored payment no longer matches the order.',
                409,
            )
        }
        const balance = await chain.getBalance(
            order.paymentToken,
            order.walletAddress,
        )
        if (balance < amount) {
            throw new GasAssistError(
                'INSUFFICIENT_PAYMENT_TOKEN_BALANCE',
                'The wallet can no longer cover the exact sponsorship payment.',
                409,
            )
        }
        return
    }

    if (intent.action === 'token-approval') {
        const decoded = decodeFunctionData({
            abi: approveAbi,
            data: intent.transactionData,
        })
        const [spender, amount] = decoded.args
        if (decoded.functionName !== 'approve' ||
            !isAddressEqual(spender, order.approvalSpender) ||
            amount !== BigInt(order.approvalAmountRaw) ||
            amount === UINT256_MAX ||
            !isAddressEqual(intent.transactionTo, order.sellToken)) {
            throw new GasAssistError(
                'SIGNED_TRANSACTION_MISMATCH',
                'The stored approval no longer matches the order.',
                409,
            )
        }
        const [allowance, balance] = await Promise.all([
            chain.getAllowance(
                order.sellToken,
                order.walletAddress,
                order.approvalSpender,
            ),
            chain.getBalance(order.sellToken, order.walletAddress),
        ])
        if (allowance >= amount) {
            throw new GasAssistError(
                'ALLOWANCE_ALREADY_SUFFICIENT',
                'The exact approval is already sufficient.',
                409,
            )
        }
        if (balance < amount) {
            throw new GasAssistError(
                'INSUFFICIENT_TOKEN_BALANCE',
                'The sell-token balance no longer covers the exact approval.',
                409,
            )
        }
        return
    }

    const quote = order.providerQuoteSnapshot.quote as
        | Record<string, unknown>
        | undefined
    const transaction = quote?.transaction as
        | Record<string, unknown>
        | undefined
    if (String(quote?.provider ?? '') !== 'uniswap' ||
        Date.parse(String(quote?.expiresAt ?? '')) <= Date.now() ||
        String(quote?.sellAmount ?? '') !== order.netSwapAmountRaw ||
        String(transaction?.to ?? '').toLowerCase() !==
            intent.transactionTo.toLowerCase() ||
        String(transaction?.data ?? '').toLowerCase() !==
            intent.transactionData.toLowerCase()) {
        throw new GasAssistError(
            'SIGNED_TRANSACTION_MISMATCH',
            'The stored swap is no longer the active 15-minute Uniswap transaction.',
            409,
        )
    }
    const [allowance, balance] = await Promise.all([
        chain.getAllowance(
            order.sellToken,
            order.walletAddress,
            order.approvalSpender,
        ),
        chain.getBalance(order.sellToken, order.walletAddress),
    ])
    if (allowance < BigInt(order.approvalAmountRaw)) {
        throw new GasAssistError(
            'ALLOWANCE_NOT_CONFIRMED',
            'The exact approval has not confirmed.',
            409,
        )
    }
    if (balance < BigInt(order.netSwapAmountRaw)) {
        throw new GasAssistError(
            'INSUFFICIENT_TOKEN_BALANCE',
            'The sell-token balance no longer covers the exact swap.',
            409,
        )
    }
}

async function assertUsageLimits(database: Pool, order: StoredOrderRow) {
    const config = getApiConfig().sponsorship
    const result = await database.query<{
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
        [order.walletAddress, order.ipHash],
    )
    const usage = result.rows[0]!
    if (BigInt(usage.walletGas) >= parseFixed(config.walletDailyGasUsd)) {
        throw new GasAssistError('WALLET_GAS_BUDGET', 'The wallet sponsored gas budget is exhausted.', 429)
    }
    if (BigInt(usage.globalGas) >= parseFixed(config.globalDailyGasUsd)) {
        throw new GasAssistError('GLOBAL_GAS_BUDGET', 'The global sponsored gas budget is exhausted.', 429)
    }
    if (BigInt(usage.walletOrders) > BigInt(config.walletDailyOrderLimit)) {
        throw new GasAssistError('WALLET_DAILY_LIMIT', 'The wallet daily sponsorship limit is exhausted.', 429)
    }
    if (BigInt(usage.ipOrders) > BigInt(config.ipDailyOrderLimit)) {
        throw new GasAssistError('IP_DAILY_LIMIT', 'The network daily sponsorship limit is exhausted.', 429)
    }
    if (BigInt(usage.globalOrders) > BigInt(config.globalDailyOrderLimit)) {
        throw new GasAssistError('GLOBAL_DAILY_LIMIT', 'The global daily sponsorship limit is exhausted.', 429)
    }
}

export function createStoredIntentSubmitter(database: Pool = getPool()) {
    const chain = createPrepaidChainClient()

    async function submit({
        intentId,
        walletAddress,
    }: {
        intentId: string
        walletAddress: string
    }) {
        const config = getApiConfig().sponsorship
        if (!config.enabled || config.emergencyDisabled) {
            throw new GasAssistError(
                'SPONSORSHIP_DISABLED',
                'New sponsorship submissions are disabled.',
                503,
            )
        }
        const intent = await loadIntent(database, intentId, walletAddress)
        const order = await loadOrder(
            database,
            intent.orderId,
            walletAddress,
        )
        if (order.status !== orderStatusForAction(intent.action) ||
            !['prepared', 'signing'].includes(intent.status) ||
            intent.submissionAttempts !== 0 ||
            !intent.signedRawTransaction ||
            intent.expiresAt <= new Date() || order.expiresAt <= new Date()) {
            throw new GasAssistError(
                'INTENT_ALREADY_USED',
                'This stored sponsored intent is not ready for submission.',
                409,
            )
        }
        const verification = await validateSignedIntent(
            intent.signedRawTransaction,
            intent,
        )
        if (intent.signedRawTransactionHash &&
            intent.signedRawTransactionHash !== verification.transactionHash) {
            throw new GasAssistError(
                'SIGNED_TRANSACTION_MISMATCH',
                'The stored signed transaction hash is inconsistent.',
                409,
            )
        }
        await assertBusinessState(database, chain, order, intent)
        await assertUsageLimits(database, order)
        const maximumGas = intent.action === 'fee-payment-transfer'
            ? BigInt(config.maximumPaymentTransferGas)
            : intent.action === 'token-approval'
                ? BigInt(config.maximumApprovalGas)
                : BigInt(config.maximumSwapGas)
        const estimate = await chain.estimateSponsoredAction({
            wallet: order.walletAddress,
            to: intent.transactionTo,
            data: intent.transactionData,
            value: BigInt(intent.nativeValue),
            maximumGas,
        })
        const consumed = BigInt(order.actualSponsoredGasUsdMicros ?? '0')
        if (consumed + estimate.gasUsdMicros >
            BigInt(order.gasReserveUsdMicros)) {
            throw new GasAssistError(
                'GAS_RESERVE_EXCEEDED',
                'Current gas exceeds the funded sponsorship reserve.',
                409,
            )
        }
        const paymaster = paymasterForAction(intent.action)
        if (!await paymaster.isSponsorable(unsignedTransaction(order, intent))) {
            throw new GasAssistError(
                'PAYMASTER_REJECTED',
                'MegaFuel no longer accepts this exact stored transaction.',
                409,
            )
        }

        const client = await database.connect()
        try {
            await client.query('BEGIN')
            const lockedIntent = await loadIntent(
                client,
                intent.id,
                order.walletAddress,
                true,
            )
            const lockedOrder = await loadOrder(
                client,
                order.id,
                order.walletAddress,
                true,
            )
            if (lockedOrder.status !== orderStatusForAction(intent.action) ||
                !['prepared', 'signing'].includes(lockedIntent.status) ||
                lockedIntent.submissionAttempts !== 0 ||
                !lockedIntent.signedRawTransaction ||
                lockedIntent.expiresAt <= new Date() ||
                lockedOrder.expiresAt <= new Date()) {
                throw new GasAssistError(
                    'INTENT_ALREADY_USED',
                    'The stored sponsored intent changed before submission.',
                    409,
                )
            }
            await client.query(
                `UPDATE sponsorship_transaction_intents
                 SET status='submitting',submission_attempts=1,
                     transaction_hash=$2,
                     first_broadcast_at=COALESCE(first_broadcast_at,now()),
                     last_broadcast_at=now(),
                     broadcast_attempts=LEAST(broadcast_attempts+1,3),
                     updated_at=now()
                 WHERE id=$1`,
                [intent.id, verification.transactionHash],
            )
            await client.query(
                `UPDATE sponsorship_orders
                 SET status=$2,rejection_code=NULL,updated_at=now()
                 WHERE id=$1`,
                [order.id, submittingOrderStatus(intent.action)],
            )
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }

        let providerHash: Hex
        try {
            providerHash = await paymaster.submit(intent.signedRawTransaction)
        } catch {
            await database.query(
                `UPDATE sponsorship_transaction_intents
                 SET status='unknown',failure_code='SUBMISSION_RESULT_UNKNOWN',
                     updated_at=now()
                 WHERE id=$1 AND status='submitting'`,
                [intent.id],
            )
            await database.query(
                `UPDATE sponsorship_orders
                 SET status='unknown',rejection_code='SUBMISSION_RESULT_UNKNOWN',
                     updated_at=now()
                 WHERE id=$1`,
                [order.id],
            )
            throw new GasAssistError(
                'SUBMISSION_RESULT_UNKNOWN',
                'Submission is uncertain; durable recovery will reconcile the stored bytes.',
                502,
            )
        }
        if (providerHash.toLowerCase() !==
            verification.transactionHash.toLowerCase()) {
            await database.query(
                `UPDATE sponsorship_transaction_intents
                 SET status='unknown',failure_code='PAYMASTER_HASH_MISMATCH',
                     updated_at=now()
                 WHERE id=$1`,
                [intent.id],
            )
            await database.query(
                `UPDATE sponsorship_orders
                 SET status='unknown',rejection_code='PAYMASTER_HASH_MISMATCH',
                     updated_at=now()
                 WHERE id=$1`,
                [order.id],
            )
            throw new GasAssistError(
                'PAYMASTER_HASH_MISMATCH',
                'MegaFuel returned a different transaction hash.',
                502,
            )
        }
        await database.query(
            `UPDATE sponsorship_transaction_intents
             SET status='submitted',transaction_hash=$2,
                 submitted_at=COALESCE(submitted_at,now()),updated_at=now()
             WHERE id=$1 AND status='submitting'`,
            [intent.id, providerHash],
        )
        await database.query(
            `UPDATE sponsorship_orders
             SET status=$2,
                 payment_transaction_hash=CASE WHEN $3='fee-payment-transfer' THEN $4 ELSE payment_transaction_hash END,
                 approval_transaction_hash=CASE WHEN $3='token-approval' THEN $4 ELSE approval_transaction_hash END,
                 swap_transaction_hash=CASE WHEN $3='normal-swap' THEN $4 ELSE swap_transaction_hash END,
                 updated_at=now()
             WHERE id=$1`,
            [
                order.id,
                submittedOrderStatus(intent.action),
                intent.action,
                providerHash,
            ],
        )
        return {
            status: 'submitted' as const,
            transactionHash: providerHash,
        }
    }

    return { submit }
}

export const storedIntentSubmitterInternals = {
    orderStatusForAction,
    submittingOrderStatus,
    submittedOrderStatus,
    unsignedTransaction,
}
