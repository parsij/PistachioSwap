import type { Pool, PoolClient } from 'pg'
import {
    isAddressEqual,
    keccak256,
    toHex,
    type Address,
    type Hex,
} from 'viem'

import { getApiConfig } from '../../config.js'
import { getPool } from '../../db/client.js'
import { normalizeAddress } from '../../lib/address.js'
import { GasAssistError } from '../errors.js'
import { buildExactApproval } from '../exact-approval.js'
import { prepaidActionPaymasterClient } from '../paymaster.js'
import { megaFuelActionPolicyManagement } from '../policy-management.js'
import {
    createPrepaidChainClient,
    validateSignedIntent,
    type StoredIntentTemplate,
} from './chain-client.js'
import { createSponsorshipIntentService } from './intent-service.js'
import { createStoredIntentSubmitter } from './stored-intent-submitter.js'
import {
    getExactSponsoredQuote,
    quoteGasLimit,
    quoteSelector,
} from './normal-swap.js'

export type SponsorshipPackageAction =
    | 'fee-payment-transfer'
    | 'token-approval'
    | 'normal-swap'

const PACKAGE_ACTIONS: readonly SponsorshipPackageAction[] = [
    'fee-payment-transfer',
    'token-approval',
    'normal-swap',
]
const PACKAGE_TTL_SECONDS = 15 * 60
const MINIMUM_PACKAGE_LIFETIME_MS = 14 * 60 * 1_000

type PackageOrderRow = {
    id: string
    status: string
    walletAddress: Address
    sellToken: Address
    buyToken: string
    netSwapAmountRaw: string
    paymentToken: Address
    paymentAmountRaw: string
    paymentTokenDecimals: number
    gasReserveUsdMicros: string
    estimatedPaymentGasUsdMicros: string
    estimatedApprovalGasUsdMicros: string
    estimatedSwapGasUsdMicros: string
    approvalSpender: Address
    approvalAmountRaw: string
    expectedOutputRaw: string
    minimumOutputRaw: string
    expiresAt: Date
    providerQuoteSnapshot: Record<string, unknown>
    ipHash: string
}

type PackageIntentRow = StoredIntentTemplate & {
    id: string
    orderId: string
    action: SponsorshipPackageAction
    status: string
    expiresAt: Date
    signedRawTransaction: Hex | null
    signedRawTransactionHash: Hex | null
    transactionHash: Hex | null
    submissionAttempts: number
}

type SignedPackageInput = {
    intentId: string
    action: SponsorshipPackageAction
    signedRawTransaction: string
}

function orderQuery(lock = false) {
    return `SELECT id,status,wallet_address AS "walletAddress",
                   sell_token AS "sellToken",buy_token AS "buyToken",
                   net_swap_amount_raw::text AS "netSwapAmountRaw",
                   payment_token AS "paymentToken",
                   payment_amount_raw::text AS "paymentAmountRaw",
                   payment_token_decimals AS "paymentTokenDecimals",
                   gas_reserve_usd_micros::text AS "gasReserveUsdMicros",
                   estimated_payment_gas_usd_micros::text AS "estimatedPaymentGasUsdMicros",
                   estimated_approval_gas_usd_micros::text AS "estimatedApprovalGasUsdMicros",
                   estimated_swap_gas_usd_micros::text AS "estimatedSwapGasUsdMicros",
                   approval_spender AS "approvalSpender",
                   approval_amount_raw::text AS "approvalAmountRaw",
                   expected_output_raw::text AS "expectedOutputRaw",
                   minimum_output_raw::text AS "minimumOutputRaw",
                   expires_at AS "expiresAt",
                   COALESCE(provider_quote_snapshot,'{}'::jsonb) AS "providerQuoteSnapshot",
                   ip_hash AS "ipHash"
            FROM sponsorship_orders
            WHERE id=$1 AND wallet_address=$2${lock ? ' FOR UPDATE' : ''}`
}

function intentsQuery(lock = false) {
    return `SELECT id,order_id AS "orderId",action,status,
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
            WHERE order_id=$1 AND wallet_address=$2
            ORDER BY CASE action
                WHEN 'fee-payment-transfer' THEN 1
                WHEN 'token-approval' THEN 2
                WHEN 'normal-swap' THEN 3
                ELSE 4 END${lock ? ' FOR UPDATE' : ''}`
}

async function loadOrder(
    database: Pool | PoolClient,
    orderId: string,
    walletAddress: string,
    lock = false,
) {
    const result = await database.query<PackageOrderRow>(
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

async function loadIntents(
    database: Pool | PoolClient,
    orderId: string,
    walletAddress: string,
    lock = false,
) {
    return (await database.query<PackageIntentRow>(
        intentsQuery(lock),
        [orderId, walletAddress.toLowerCase()],
    )).rows
}

function normalizedRawTransaction(value: string) {
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
        throw new GasAssistError(
            'SIGNED_TRANSACTION_MISMATCH',
            'A signed package transaction is malformed.',
        )
    }
    return value.toLowerCase() as Hex
}

function positiveInteger(value: unknown, field: string) {
    const normalized = String(value ?? '')
    if (!/^[1-9]\d*$/.test(normalized)) {
        throw new GasAssistError(
            'PRESIGNED_PACKAGE_INVALID',
            `The stored ${field} is invalid.`,
            409,
        )
    }
    return BigInt(normalized)
}

function unsignedTransaction({
    walletAddress,
    transactionTo,
    transactionData,
    nativeValue = 0n,
    nonce,
    gasLimit,
}: {
    walletAddress: Address
    transactionTo: Address
    transactionData: Hex
    nativeValue?: bigint
    nonce: bigint
    gasLimit: bigint
}) {
    return {
        from: walletAddress,
        to: transactionTo,
        data: transactionData,
        value: toHex(nativeValue),
        chainId: toHex(56),
        nonce: toHex(nonce),
        gas: toHex(gasLimit),
        gasPrice: '0x0',
        type: '0x0',
    }
}

function assertPackageActions<T extends { action: SponsorshipPackageAction }>(
    values: T[],
) {
    if (values.length !== PACKAGE_ACTIONS.length) {
        throw new GasAssistError(
            'PRESIGNED_PACKAGE_INCOMPLETE',
            'Payment, approval, and swap signatures are all required.',
        )
    }
    const byAction = new Map(values.map((value) => [value.action, value]))
    if (byAction.size !== PACKAGE_ACTIONS.length ||
        PACKAGE_ACTIONS.some((action) => !byAction.has(action))) {
        throw new GasAssistError(
            'PRESIGNED_PACKAGE_INCOMPLETE',
            'The signed package must contain exactly one payment, approval, and swap.',
        )
    }
    return PACKAGE_ACTIONS.map((action) => byAction.get(action)!)
}

function assertConsecutiveNonces(intents: PackageIntentRow[]) {
    const ordered = assertPackageActions(intents)
    const feeNonce = BigInt(ordered[0].nonce)
    if (BigInt(ordered[1].nonce) !== feeNonce + 1n ||
        BigInt(ordered[2].nonce) !== feeNonce + 2n) {
        throw new GasAssistError(
            'PRESIGNED_PACKAGE_NONCE_MISMATCH',
            'The package transactions do not use consecutive account nonces.',
            409,
        )
    }
}

function nextActionForStatus(status: string): SponsorshipPackageAction | null {
    return {
        'payment-prepared': 'fee-payment-transfer',
        'payment-confirmed': 'token-approval',
        'approval-confirmed': 'normal-swap',
    }[status] as SponsorshipPackageAction | undefined ?? null
}

function publicPackage(order: PackageOrderRow, intents: PackageIntentRow[]) {
    const ordered = assertPackageActions(intents)
    return {
        orderId: order.id,
        expiresAt: new Date(Math.min(
            order.expiresAt.getTime(),
            ...ordered.map((intent) => intent.expiresAt.getTime()),
        )).toISOString(),
        rawTransactionSigning: {
            required: true,
            method: 'eth_signTransaction',
        },
        transactions: ordered.map((intent) => ({
            intentId: intent.id,
            action: intent.action,
            policy: intent.action === 'fee-payment-transfer' ? 'fee' : 'action',
            expiresAt: intent.expiresAt.toISOString(),
            transaction: unsignedTransaction({
                walletAddress: intent.walletAddress,
                transactionTo: intent.transactionTo,
                transactionData: intent.transactionData,
                nativeValue: BigInt(intent.nativeValue),
                nonce: BigInt(intent.nonce),
                gasLimit: BigInt(intent.gasLimit),
            }),
        })),
    }
}

export function createSponsorshipPackageService(database: Pool = getPool()) {
    const chain = createPrepaidChainClient()
    const intentService = createSponsorshipIntentService({ database })
    const storedIntentSubmitter = createStoredIntentSubmitter(database)

    async function prepare(orderId: string, walletAddress: string) {
        const config = getApiConfig().sponsorship
        if (!config.enabled || config.emergencyDisabled ||
            !config.approvalSponsorEnabled || !config.normalSwapSponsorEnabled) {
            throw new GasAssistError(
                'SPONSORSHIP_DISABLED',
                'Pre-signed Gas Assist packages are disabled.',
                503,
            )
        }

        let order = await loadOrder(database, orderId, walletAddress)
        let intents = await loadIntents(database, orderId, walletAddress)
        if (intents.length === PACKAGE_ACTIONS.length) {
            assertConsecutiveNonces(intents)
            return publicPackage(order, intents)
        }

        if (order.status === 'quoted') {
            await intentService.preparePayment(order.id, order.walletAddress)
            order = await loadOrder(database, orderId, walletAddress)
            intents = await loadIntents(database, orderId, walletAddress)
        }
        if (order.status !== 'payment-prepared') {
            throw new GasAssistError(
                'ORDER_STATE_CONFLICT',
                'The order is not ready to prepare a pre-signed transaction package.',
                409,
            )
        }
        const feeIntent = intents.find((intent) =>
            intent.action === 'fee-payment-transfer')
        if (!feeIntent || intents.some((intent) =>
            intent.action !== 'fee-payment-transfer')) {
            throw new GasAssistError(
                'PRESIGNED_PACKAGE_STATE_CONFLICT',
                'The order contains an incomplete or conflicting transaction package.',
                409,
            )
        }

        const slippageBps = Number(order.providerQuoteSnapshot.slippageBps)
        if (!Number.isInteger(slippageBps)) {
            throw new GasAssistError(
                'PRESIGNED_PACKAGE_INVALID',
                'The stored slippage setting is invalid.',
                409,
            )
        }
        const [sellDecimals, buyDecimals] = await Promise.all([
            chain.getTokenDecimals(order.sellToken),
            order.buyToken === 'native'
                ? Promise.resolve(18)
                : chain.getTokenDecimals(order.buyToken as Address),
        ])
        const quote = await getExactSponsoredQuote({
            wallet: order.walletAddress,
            sellToken: order.sellToken,
            buyToken: order.buyToken,
            sellAmount: BigInt(order.netSwapAmountRaw),
            sellTokenDecimals: sellDecimals,
            buyTokenDecimals: buyDecimals,
            slippageBps,
        })
        if (quote.provider !== 'uniswap') {
            throw new GasAssistError(
                'PRESIGNED_PACKAGE_REQUIRES_UNISWAP',
                'The durable pre-signed package requires a 15-minute Uniswap transaction.',
                409,
            )
        }
        if (!isAddressEqual(quote.allowanceTarget, order.approvalSpender) ||
            BigInt(quote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError(
                'ORDER_REQUOTE_REQUIRED',
                'The refreshed route moved outside the reviewed approval or minimum output.',
                409,
            )
        }
        const quoteExpiry = Date.parse(quote.expiresAt)
        if (!Number.isFinite(quoteExpiry) ||
            quoteExpiry - Date.now() < MINIMUM_PACKAGE_LIFETIME_MS) {
            throw new GasAssistError(
                'PRESIGNED_PACKAGE_QUOTE_TOO_SHORT',
                'The swap transaction does not have enough of its 15-minute lifetime remaining.',
                409,
            )
        }
        const packageExpiresAt = new Date(Math.min(
            quoteExpiry,
            Date.now() + PACKAGE_TTL_SECONDS * 1_000,
        ))
        const approvalData = buildExactApproval(
            order.approvalSpender,
            BigInt(order.approvalAmountRaw),
        )
        const [approvalEstimate, swapEstimate] = await Promise.all([
            chain.estimateSponsoredAction({
                wallet: order.walletAddress,
                to: order.sellToken,
                data: approvalData,
                maximumGas: BigInt(config.maximumApprovalGas),
            }),
            chain.priceGasLimit(
                quoteGasLimit(quote),
                BigInt(config.maximumSwapGas),
            ),
        ])
        const estimatedTotalGas =
            BigInt(order.estimatedPaymentGasUsdMicros) +
            approvalEstimate.gasUsdMicros +
            swapEstimate.gasUsdMicros
        if (estimatedTotalGas > BigInt(order.gasReserveUsdMicros)) {
            throw new GasAssistError(
                'GAS_RESERVE_EXCEEDED',
                'The refreshed package gas exceeds the funded sponsorship reserve.',
                409,
            )
        }

        await megaFuelActionPolicyManagement.add(
            'ToAccountWhitelist',
            [quote.transaction.to],
        )
        await megaFuelActionPolicyManagement.add(
            'ContractMethodSigWhitelist',
            [quoteSelector(quote)],
        )

        const baseNonce = BigInt(feeIntent.nonce)
        const approvalTransaction = unsignedTransaction({
            walletAddress: order.walletAddress,
            transactionTo: order.sellToken,
            transactionData: approvalData,
            nonce: baseNonce + 1n,
            gasLimit: approvalEstimate.gasLimit,
        })
        const swapTransaction = unsignedTransaction({
            walletAddress: order.walletAddress,
            transactionTo: quote.transaction.to,
            transactionData: quote.transaction.data,
            nativeValue: BigInt(quote.transaction.value),
            nonce: baseNonce + 2n,
            gasLimit: swapEstimate.gasLimit,
        })
        const [approvalSponsorable, swapSponsorable] = await Promise.all([
            prepaidActionPaymasterClient.isSponsorable(approvalTransaction),
            prepaidActionPaymasterClient.isSponsorable(swapTransaction),
        ])
        if (!approvalSponsorable || !swapSponsorable) {
            throw new GasAssistError(
                'PAYMASTER_REJECTED',
                'MegaFuel declined an exact transaction in the pre-signed package.',
                409,
            )
        }

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
            approvalGas: {
                gasLimit: approvalEstimate.gasLimit.toString(),
                currentGasPrice: approvalEstimate.currentGasPrice.toString(),
                gasUsdMicros: approvalEstimate.gasUsdMicros.toString(),
                observedAt: approvalEstimate.observedAt.toISOString(),
            },
            swapGas: {
                gasLimit: swapEstimate.gasLimit.toString(),
                currentGasPrice: swapEstimate.currentGasPrice.toString(),
                gasUsdMicros: swapEstimate.gasUsdMicros.toString(),
                observedAt: swapEstimate.observedAt.toISOString(),
            },
        }

        const client = await database.connect()
        try {
            await client.query('BEGIN')
            const lockedOrder = await loadOrder(
                client,
                order.id,
                order.walletAddress,
                true,
            )
            const lockedIntents = await loadIntents(
                client,
                order.id,
                order.walletAddress,
                true,
            )
            if (lockedIntents.length === PACKAGE_ACTIONS.length) {
                await client.query('COMMIT')
                return publicPackage(lockedOrder, lockedIntents)
            }
            if (lockedOrder.status !== 'payment-prepared' ||
                lockedIntents.length !== 1 ||
                lockedIntents[0]?.action !== 'fee-payment-transfer') {
                throw new GasAssistError(
                    'PRESIGNED_PACKAGE_STATE_CONFLICT',
                    'The order changed while its package was being prepared.',
                    409,
                )
            }
            await client.query(
                `UPDATE sponsorship_transaction_intents
                 SET expires_at=$2,updated_at=now()
                 WHERE id=$1`,
                [lockedIntents[0].id, packageExpiresAt],
            )
            await client.query(
                `INSERT INTO sponsorship_transaction_intents
                 (order_id,action,status,wallet_address,transaction_to,
                  transaction_data,transaction_data_hash,native_value,chain_id,
                  nonce,transaction_type,gas_limit,gas_price,expires_at)
                 VALUES
                 ($1,'token-approval','prepared',$2,$3,$4,$5,0,56,$6,'legacy',$7,0,$8),
                 ($1,'normal-swap','prepared',$2,$9,$10,$11,$12,56,$13,'legacy',$14,0,$8)`,
                [
                    order.id,
                    order.walletAddress,
                    order.sellToken,
                    approvalData,
                    keccak256(approvalData),
                    (baseNonce + 1n).toString(),
                    approvalEstimate.gasLimit.toString(),
                    packageExpiresAt,
                    quote.transaction.to,
                    quote.transaction.data,
                    keccak256(quote.transaction.data),
                    quote.transaction.value,
                    (baseNonce + 2n).toString(),
                    swapEstimate.gasLimit.toString(),
                ],
            )
            await client.query(
                `UPDATE sponsorship_orders
                 SET expires_at=$2,provider_quote_id=$3,
                     provider_quote_expires_at=$4,
                     provider_quote_snapshot=$5::jsonb,
                     provider_fees=$6::jsonb,
                     expected_output_raw=$7,minimum_output_raw=$8,
                     estimated_approval_gas_usd_micros=$9,
                     estimated_swap_gas_usd_micros=$10,
                     updated_at=now()
                 WHERE id=$1`,
                [
                    order.id,
                    packageExpiresAt,
                    quote.quoteId,
                    quote.expiresAt,
                    JSON.stringify(refreshedSnapshot),
                    JSON.stringify({ platformFee: quote.platformFee }),
                    quote.buyAmount,
                    quote.minimumBuyAmount,
                    approvalEstimate.gasUsdMicros.toString(),
                    swapEstimate.gasUsdMicros.toString(),
                ],
            )
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }

        order = await loadOrder(database, orderId, walletAddress)
        intents = await loadIntents(database, orderId, walletAddress)
        assertConsecutiveNonces(intents)
        return publicPackage(order, intents)
    }

    async function storeSignedPackage({
        orderId,
        walletAddress,
        signedTransactions,
    }: {
        orderId: string
        walletAddress: string
        signedTransactions: SignedPackageInput[]
    }) {
        const orderedInput = assertPackageActions(signedTransactions)
        const intents = assertPackageActions(
            await loadIntents(database, orderId, walletAddress),
        )
        assertConsecutiveNonces(intents)
        const inputByAction = new Map(
            orderedInput.map((input) => [input.action, input]),
        )
        const verified = await Promise.all(intents.map(async (intent) => {
            const input = inputByAction.get(intent.action)!
            if (input.intentId !== intent.id) {
                throw new GasAssistError(
                    'SIGNED_TRANSACTION_MISMATCH',
                    'A signed transaction belongs to a different package intent.',
                )
            }
            if (!['prepared', 'signing'].includes(intent.status) ||
                intent.submissionAttempts !== 0 ||
                intent.expiresAt <= new Date()) {
                throw new GasAssistError(
                    'INTENT_ALREADY_USED',
                    'A transaction in this package cannot accept another signature.',
                    409,
                )
            }
            const raw = normalizedRawTransaction(input.signedRawTransaction)
            const validation = await validateSignedIntent(raw, intent)
            return { intent, raw, hash: validation.transactionHash }
        }))

        const client = await database.connect()
        try {
            await client.query('BEGIN')
            await loadOrder(client, orderId, walletAddress, true)
            const locked = assertPackageActions(
                await loadIntents(client, orderId, walletAddress, true),
            )
            assertConsecutiveNonces(locked)
            for (const item of verified) {
                const lockedIntent = locked.find((intent) =>
                    intent.id === item.intent.id)
                if (!lockedIntent ||
                    !['prepared', 'signing'].includes(lockedIntent.status) ||
                    lockedIntent.submissionAttempts !== 0 ||
                    lockedIntent.expiresAt <= new Date()) {
                    throw new GasAssistError(
                        'INTENT_ALREADY_USED',
                        'The package changed while its signatures were being stored.',
                        409,
                    )
                }
                if (lockedIntent.signedRawTransaction &&
                    lockedIntent.signedRawTransaction !== item.raw) {
                    throw new GasAssistError(
                        'SIGNED_TRANSACTION_MISMATCH',
                        'A different signed transaction is already stored for this package.',
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
                    [lockedIntent.id, item.raw, item.hash],
                )
            }
            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }

        return {
            packageStored: true,
            transactionHashes: Object.fromEntries(
                verified.map((item) => [item.intent.action, item.hash]),
            ),
        }
    }

    async function advanceOrder(
        orderId: string,
        walletAddress: string,
        clientIp?: string,
    ) {
        const order = await loadOrder(database, orderId, walletAddress)
        const nextAction = nextActionForStatus(order.status)
        if (!nextAction) {
            return { started: false, status: order.status }
        }
        const intent = (await loadIntents(database, order.id, order.walletAddress))
            .find((candidate) => candidate.action === nextAction)
        if (!intent?.signedRawTransaction ||
            !['prepared', 'signing'].includes(intent.status) ||
            intent.submissionAttempts !== 0) {
            return { started: false, status: order.status }
        }
        try {
            const result = await storedIntentSubmitter.submit({
                intentId: intent.id,
                walletAddress: order.walletAddress,
            })
            return {
                started: true,
                action: nextAction,
                ...result,
            }
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? String((error as { code?: unknown }).code ?? 'SUBMISSION_FAILED')
                : 'SUBMISSION_FAILED'
            if (code === 'INTENT_ALREADY_USED') {
                return { started: false, status: order.status }
            }
            return {
                started: false,
                status: order.status,
                safeErrorCode: code,
            }
        }
    }

    async function submitSignedPackage({
        orderId,
        walletAddress,
        clientIp,
        signedTransactions,
    }: {
        orderId: string
        walletAddress: string
        clientIp: string
        signedTransactions: SignedPackageInput[]
    }) {
        const stored = await storeSignedPackage({
            orderId,
            walletAddress,
            signedTransactions,
        })
        const execution = await advanceOrder(orderId, walletAddress, clientIp)
        return {
            ...stored,
            executionStarted: execution.started,
            currentAction: 'action' in execution ? execution.action : null,
            safeErrorCode: 'safeErrorCode' in execution
                ? execution.safeErrorCode
                : null,
        }
    }

    async function advancePendingPackages(limit = 25) {
        const candidates = await database.query<{
            id: string
            walletAddress: string
        }>(
            `SELECT o.id,o.wallet_address AS "walletAddress"
             FROM sponsorship_orders o
             WHERE o.status IN (
                 'payment-prepared','payment-confirmed','approval-confirmed'
             )
               AND EXISTS (
                 SELECT 1
                 FROM sponsorship_transaction_intents i
                 WHERE i.order_id=o.id
                   AND i.status IN ('prepared','signing')
                   AND i.submission_attempts=0
                   AND i.signed_raw_transaction IS NOT NULL
                   AND i.action=CASE o.status
                     WHEN 'payment-prepared' THEN 'fee-payment-transfer'
                     WHEN 'payment-confirmed' THEN 'token-approval'
                     WHEN 'approval-confirmed' THEN 'normal-swap'
                   END
               )
             ORDER BY o.updated_at
             LIMIT $1`,
            [Math.max(1, Math.min(limit, 100))],
        )
        const summary = { scanned: 0, started: 0, waiting: 0, failed: 0 }
        for (const candidate of candidates.rows) {
            summary.scanned += 1
            const result = await advanceOrder(
                candidate.id,
                candidate.walletAddress,
            )
            if (result.started) summary.started += 1
            else if ('safeErrorCode' in result && result.safeErrorCode) {
                summary.failed += 1
            } else {
                summary.waiting += 1
            }
        }
        return summary
    }

    async function getState(orderId: string, walletAddress: string) {
        const intents = await loadIntents(database, orderId, walletAddress)
        const signedActions = new Set(
            intents
                .filter((intent) => Boolean(intent.signedRawTransaction))
                .map((intent) => intent.action),
        )
        return {
            preSignedPackage: PACKAGE_ACTIONS.every((action) =>
                signedActions.has(action)),
        }
    }

    return {
        prepare,
        storeSignedPackage,
        submitSignedPackage,
        advanceOrder,
        advancePendingPackages,
        getState,
    }
}

export const sponsorshipPackageInternals = {
    PACKAGE_ACTIONS,
    PACKAGE_TTL_SECONDS,
    MINIMUM_PACKAGE_LIFETIME_MS,
    assertPackageActions,
    nextActionForStatus,
    normalizedRawTransaction,
    positiveInteger,
    unsignedTransaction,
}
