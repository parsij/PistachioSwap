import {
    bigint,
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const gasAssistGaslessQuotes = pgTable(
    'gas_assist_gasless_quotes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sponsorshipOrderId: uuid('sponsorship_order_id'),
        billingMode: text('billing_mode').notNull().default('provider-integrator'),
        zid: text('zid'),
        chainId: integer('chain_id').notNull(),
        walletAddress: text('wallet_address').notNull(),
        sellTokenAddress: text('sell_token_address').notNull(),
        buyTokenAddress: text('buy_token_address').notNull(),
        requestedSellAmount: numeric('requested_sell_amount', { precision: 78, scale: 0 }).notNull(),
        quotedSellAmount: numeric('quoted_sell_amount', { precision: 78, scale: 0 }).notNull(),
        buyAmount: numeric('buy_amount', { precision: 78, scale: 0 }).notNull(),
        minimumBuyAmount: numeric('minimum_buy_amount', { precision: 78, scale: 0 }).notNull(),
        fees: jsonb('fees').notNull(),
        route: jsonb('route').notNull(),
        approval: jsonb('approval'),
        trade: jsonb('trade').notNull(),
        approvalRequired: boolean('approval_required').notNull(),
        gaslessApprovalAvailable: boolean('gasless_approval_available').notNull(),
        approvalAmount: numeric('approval_amount', { precision: 78, scale: 0 }),
        approvalUnlimited: boolean('approval_unlimited').notNull().default(false),
        status: text('status').notNull().default('awaiting_signatures'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        approvalSignatureHash: text('approval_signature_hash'),
        tradeSignatureHash: text('trade_signature_hash'),
        tradeHash: text('trade_hash'),
        transactionHash: text('transaction_hash'),
        providerStatus: text('provider_status'),
        failureCode: text('failure_code'),
        submissionAttempts: integer('submission_attempts').notNull().default(0),
        lastStatusCheckedAt: timestamp('last_status_checked_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('gas_assist_gasless_wallet_created_idx').on(table.chainId, table.walletAddress, table.createdAt),
        index('gas_assist_gasless_status_expiry_idx').on(table.status, table.expiresAt),
        uniqueIndex('gas_assist_gasless_trade_hash_idx').on(table.tradeHash),
    ],
)

export const gasAssistSponsorRules = pgTable(
    'gas_assist_sponsor_rules',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        chainId: integer('chain_id').notNull(),
        walletAddress: text('wallet_address').notNull(),
        tokenAddress: text('token_address').notNull(),
        minimumAmountBaseUnits: numeric('minimum_amount_base_units', {
            precision: 78,
            scale: 0,
        }).notNull(),
        maximumAmountBaseUnits: numeric('maximum_amount_base_units', {
            precision: 78,
            scale: 0,
        }),
        enabled: boolean('enabled').notNull().default(true),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        maximumSponsorshipsPerDay: integer('maximum_sponsorships_per_day'),
        maximumTotalAmountPerDayBaseUnits: numeric(
            'maximum_total_amount_per_day_base_units',
            { precision: 78, scale: 0 },
        ),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex('gas_assist_rules_exact_idx').on(
            table.chainId,
            table.walletAddress,
            table.tokenAddress,
        ),
        index('gas_assist_rules_enabled_idx').on(table.chainId, table.enabled),
        index('gas_assist_rules_expiry_idx').on(table.expiresAt),
    ],
)

export const gasAssistSwapIntents = pgTable(
    'gas_assist_swap_intents',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        chainId: integer('chain_id').notNull(),
        walletAddress: text('wallet_address').notNull(),
        sellTokenAddress: text('sell_token_address').notNull(),
        buyTokenAddress: text('buy_token_address').notNull(),
        amountIn: numeric('amount_in', { precision: 78, scale: 0 }).notNull(),
        swapContractAddress: text('swap_contract_address'),
        providerQuoteId: text('provider_quote_id').notNull(),
        routeExecutableThroughSwapContract: boolean(
            'route_executable_through_swap_contract',
        )
            .notNull()
            .default(false),
        status: text('status').notNull().default('active'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('gas_assist_intents_wallet_expiry_idx').on(
            table.chainId,
            table.walletAddress,
            table.expiresAt,
        ),
        index('gas_assist_intents_status_idx').on(table.status, table.expiresAt),
    ],
)

export const gasAssistApprovalQuotes = pgTable(
    'gas_assist_approval_quotes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        chainId: integer('chain_id').notNull(),
        walletAddress: text('wallet_address').notNull(),
        tokenAddress: text('token_address').notNull(),
        spenderAddress: text('spender_address').notNull(),
        amountIn: numeric('amount_in', { precision: 78, scale: 0 }).notNull(),
        sponsorRuleId: uuid('sponsor_rule_id')
            .notNull()
            .references(() => gasAssistSponsorRules.id),
        swapIntentId: uuid('swap_intent_id')
            .notNull()
            .references(() => gasAssistSwapIntents.id),
        nonce: numeric('nonce', { precision: 78, scale: 0 }).notNull(),
        gasLimit: numeric('gas_limit', { precision: 78, scale: 0 }).notNull(),
        transactionType: text('transaction_type').notNull().default('legacy'),
        unsignedTransactionHash: text('unsigned_transaction_hash').notNull(),
        calldataHash: text('calldata_hash').notNull(),
        status: text('status').notNull().default('pending'),
        sponsorPolicyReference: text('sponsor_policy_reference'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        submittedTxHash: text('submitted_tx_hash'),
        failureCode: text('failure_code'),
        submissionAttempts: integer('submission_attempts').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('gas_assist_quotes_wallet_status_idx').on(
            table.chainId,
            table.walletAddress,
            table.status,
        ),
        index('gas_assist_quotes_expiry_idx').on(table.expiresAt),
        index('gas_assist_quotes_intent_idx').on(table.swapIntentId),
    ],
)

export const gasAssistSponsorshipAttempts = pgTable(
    'gas_assist_sponsorship_attempts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        quoteId: uuid('quote_id').references(() => gasAssistApprovalQuotes.id),
        sponsorRuleId: uuid('sponsor_rule_id').references(
            () => gasAssistSponsorRules.id,
        ),
        chainId: integer('chain_id').notNull(),
        walletAddressHash: text('wallet_address_hash').notNull(),
        ipHash: text('ip_hash').notNull(),
        tokenAddress: text('token_address').notNull(),
        outcome: text('outcome').notNull(),
        providerCode: text('provider_code'),
        transactionHash: text('transaction_hash'),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('gas_assist_attempts_quote_idx').on(table.quoteId),
        index('gas_assist_attempts_created_idx').on(table.chainId, table.createdAt),
    ],
)

export const gasAssistDailyUsage = pgTable(
    'gas_assist_daily_usage',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        usageDate: date('usage_date').notNull(),
        chainId: integer('chain_id').notNull(),
        sponsorRuleId: uuid('sponsor_rule_id')
            .notNull()
            .references(() => gasAssistSponsorRules.id),
        walletAddressHash: text('wallet_address_hash').notNull(),
        ipHash: text('ip_hash').notNull(),
        sponsoredCount: integer('sponsored_count').notNull().default(0),
        sponsoredGas: bigint('sponsored_gas', { mode: 'bigint' })
            .notNull()
            .default(0n),
        sponsoredAmountBaseUnits: numeric('sponsored_amount_base_units', {
            precision: 78,
            scale: 0,
        })
            .notNull()
            .default('0'),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex('gas_assist_usage_scope_idx').on(
            table.usageDate,
            table.chainId,
            table.sponsorRuleId,
            table.walletAddressHash,
            table.ipHash,
        ),
        index('gas_assist_usage_wallet_day_idx').on(
            table.usageDate,
            table.chainId,
            table.walletAddressHash,
        ),
        index('gas_assist_usage_ip_day_idx').on(
            table.usageDate,
            table.chainId,
            table.ipHash,
        ),
    ],
)

export const sponsorshipPaymentTokens = pgTable(
    'sponsorship_payment_tokens',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        chainId: integer('chain_id').notNull(),
        tokenAddress: text('token_address').notNull(),
        symbol: text('symbol').notNull(),
        decimals: integer('decimals').notNull(),
        enabled: boolean('enabled').notNull().default(false),
        feePaymentEnabled: boolean('fee_payment_enabled').notNull().default(false),
        approvalSponsorshipEnabled: boolean('approval_sponsorship_enabled').notNull().default(false),
        normalSwapSponsorshipEnabled: boolean('normal_swap_sponsorship_enabled').notNull().default(false),
        isStablecoin: boolean('is_stablecoin').notNull().default(false),
        paymentPriority: integer('payment_priority').notNull().default(0),
        minimumLiquidityUsdMicros: bigint('minimum_liquidity_usd_micros', { mode: 'bigint' }).notNull(),
        minimumGrossTradeUsdMicros: bigint('minimum_gross_trade_usd_micros', { mode: 'bigint' }).notNull(),
        maximumGrossTradeUsdMicros: bigint('maximum_gross_trade_usd_micros', { mode: 'bigint' }),
        maximumPriceAgeSeconds: integer('maximum_price_age_seconds').notNull(),
        maximumPriceDeviationBps: integer('maximum_price_deviation_bps').notNull(),
        exactTransferRequired: boolean('exact_transfer_required').notNull().default(true),
        feeOnTransferAllowed: boolean('fee_on_transfer_allowed').notNull().default(false),
        rebasingAllowed: boolean('rebasing_allowed').notNull().default(false),
        strictSecurityRequired: boolean('strict_security_required').notNull().default(true),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_payment_tokens_chain_address_idx').on(table.chainId, table.tokenAddress),
        index('sponsorship_payment_tokens_enabled_idx').on(table.chainId, table.enabled, table.feePaymentEnabled),
        check('sponsorship_payment_tokens_chain_check', sql`${table.chainId} = 56`),
        check('sponsorship_payment_tokens_decimals_check', sql`${table.decimals} BETWEEN 0 AND 36`),
        check('sponsorship_payment_tokens_thresholds_check', sql`
            ${table.minimumLiquidityUsdMicros} >= 0 AND
            ${table.minimumGrossTradeUsdMicros} >= 0 AND
            (${table.maximumGrossTradeUsdMicros} IS NULL OR ${table.maximumGrossTradeUsdMicros} >= ${table.minimumGrossTradeUsdMicros}) AND
            ${table.maximumPriceAgeSeconds} > 0 AND
            ${table.maximumPriceDeviationBps} BETWEEN 0 AND 10000
        `),
        check('sponsorship_payment_tokens_transfer_check', sql`
            ${table.feeOnTransferAllowed} = false AND ${table.rebasingAllowed} = false
        `),
    ],
)

export const sponsorshipAuthChallenges = pgTable(
    'sponsorship_auth_challenges',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        walletAddress: text('wallet_address').notNull(),
        chainId: integer('chain_id').notNull(),
        nonceHash: text('nonce_hash').notNull(),
        domain: text('domain').notNull(),
        message: text('message').notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        consumedAt: timestamp('consumed_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_auth_challenges_nonce_idx').on(table.nonceHash),
        index('sponsorship_auth_challenges_wallet_idx').on(table.walletAddress, table.expiresAt),
    ],
)

export const sponsorshipAuthSessions = pgTable(
    'sponsorship_auth_sessions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        walletAddress: text('wallet_address').notNull(),
        chainId: integer('chain_id').notNull(),
        tokenHash: text('token_hash').notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_auth_sessions_token_idx').on(table.tokenHash),
        index('sponsorship_auth_sessions_wallet_idx').on(table.walletAddress, table.expiresAt),
    ],
)

export const sponsorshipOrders = pgTable(
    'sponsorship_orders',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        status: text('status').notNull().default('quoted'),
        walletAddress: text('wallet_address').notNull(),
        chainId: integer('chain_id').notNull(),
        sellToken: text('sell_token').notNull(),
        buyToken: text('buy_token').notNull(),
        grossInputAmountRaw: numeric('gross_input_amount_raw', { precision: 78, scale: 0 }).notNull(),
        netSwapAmountRaw: numeric('net_swap_amount_raw', { precision: 78, scale: 0 }).notNull(),
        paymentToken: text('payment_token').notNull(),
        paymentTokenReason: text('payment_token_reason').notNull(),
        paymentAmountRaw: numeric('payment_amount_raw', { precision: 78, scale: 0 }).notNull(),
        paymentTokenDecimals: integer('payment_token_decimals').notNull(),
        tradeNotionalUsdMicros: bigint('trade_notional_usd_micros', { mode: 'bigint' }).notNull(),
        fixedServiceFeeUsdMicros: bigint('fixed_service_fee_usd_micros', { mode: 'bigint' }).notNull(),
        platformFeeUsdMicros: bigint('platform_fee_usd_micros', { mode: 'bigint' }).notNull(),
        commercialFeeUsdMicros: bigint('commercial_fee_usd_micros', { mode: 'bigint' }).notNull(),
        gasReserveUsdMicros: bigint('gas_reserve_usd_micros', { mode: 'bigint' }).notNull(),
        totalPrepaymentUsdMicros: bigint('total_prepayment_usd_micros', { mode: 'bigint' }).notNull(),
        estimatedPaymentGasUsdMicros: bigint('estimated_payment_gas_usd_micros', { mode: 'bigint' }).notNull(),
        estimatedApprovalGasUsdMicros: bigint('estimated_approval_gas_usd_micros', { mode: 'bigint' }).notNull(),
        estimatedSwapGasUsdMicros: bigint('estimated_swap_gas_usd_micros', { mode: 'bigint' }).notNull(),
        gasMultiplierBps: integer('gas_multiplier_bps').notNull(),
        quoteProvider: text('quote_provider').notNull(),
        providerQuoteId: text('provider_quote_id'),
        providerQuoteExpiresAt: timestamp('provider_quote_expires_at', { withTimezone: true }),
        providerQuoteSnapshot: jsonb('provider_quote_snapshot'),
        providerFees: jsonb('provider_fees').notNull().default({}),
        expectedOutputRaw: numeric('expected_output_raw', { precision: 78, scale: 0 }).notNull(),
        minimumOutputRaw: numeric('minimum_output_raw', { precision: 78, scale: 0 }).notNull(),
        requiresApproval: boolean('requires_approval').notNull(),
        approvalSpender: text('approval_spender'),
        approvalAmountRaw: numeric('approval_amount_raw', { precision: 78, scale: 0 }),
        sponsoredFlow: text('sponsored_flow').notNull(),
        billingMode: text('billing_mode').notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        paymentTransactionHash: text('payment_transaction_hash'),
        approvalTransactionHash: text('approval_transaction_hash'),
        swapTransactionHash: text('swap_transaction_hash'),
        actualPaymentReceivedRaw: numeric('actual_payment_received_raw', { precision: 78, scale: 0 }),
        actualSponsoredGasUsdMicros: bigint('actual_sponsored_gas_usd_micros', { mode: 'bigint' }),
        platformFeeSettledAt: timestamp('platform_fee_settled_at', { withTimezone: true }),
        completedAt: timestamp('completed_at', { withTimezone: true }),
        rejectionCode: text('rejection_code'),
        idempotencyKey: text('idempotency_key').notNull(),
        ipHash: text('ip_hash').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_orders_idempotency_idx').on(table.idempotencyKey),
        index('sponsorship_orders_wallet_status_idx').on(table.walletAddress, table.status),
        index('sponsorship_orders_expiry_idx').on(table.status, table.expiresAt),
        check('sponsorship_orders_chain_check', sql`${table.chainId} = 56`),
        check('sponsorship_orders_amounts_check', sql`
            ${table.grossInputAmountRaw} > 0 AND ${table.netSwapAmountRaw} > 0 AND
            ${table.netSwapAmountRaw} <= ${table.grossInputAmountRaw} AND ${table.paymentAmountRaw} > 0 AND
            ${table.tradeNotionalUsdMicros} > 0 AND ${table.commercialFeeUsdMicros} >= 0 AND
            ${table.gasReserveUsdMicros} >= 0 AND ${table.totalPrepaymentUsdMicros} > 0
        `),
        check('sponsorship_orders_billing_check', sql`${table.billingMode} = 'prepaid-megafuel'`),
    ],
)

export const sponsorshipTransactionIntents = pgTable(
    'sponsorship_transaction_intents',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id').notNull().references(() => sponsorshipOrders.id),
        action: text('action').notNull(),
        status: text('status').notNull().default('authorized'),
        walletAddress: text('wallet_address').notNull(),
        transactionTo: text('transaction_to').notNull(),
        transactionData: text('transaction_data').notNull(),
        transactionDataHash: text('transaction_data_hash').notNull(),
        nativeValue: numeric('native_value', { precision: 78, scale: 0 }).notNull().default('0'),
        chainId: integer('chain_id').notNull(),
        nonce: numeric('nonce', { precision: 78, scale: 0 }).notNull(),
        transactionType: text('transaction_type').notNull(),
        gasLimit: numeric('gas_limit', { precision: 78, scale: 0 }).notNull(),
        gasPrice: numeric('gas_price', { precision: 78, scale: 0 }).notNull(),
        maxFeePerGas: numeric('max_fee_per_gas', { precision: 78, scale: 0 }),
        maxPriorityFeePerGas: numeric('max_priority_fee_per_gas', { precision: 78, scale: 0 }),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        signedRawTransactionHash: text('signed_raw_transaction_hash'),
        transactionHash: text('transaction_hash'),
        submissionAttempts: integer('submission_attempts').notNull().default(0),
        failureCode: text('failure_code'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_intents_order_action_idx').on(table.orderId, table.action),
        index('sponsorship_intents_wallet_nonce_idx').on(table.walletAddress, table.nonce),
        index('sponsorship_intents_expiry_idx').on(table.status, table.expiresAt),
        check('sponsorship_intents_chain_check', sql`${table.chainId} = 56`),
        check('sponsorship_intents_value_gas_check', sql`
            ${table.nativeValue} = 0 AND ${table.gasLimit} > 0 AND ${table.gasPrice} = 0
        `),
    ],
)

export const sponsorshipLedger = pgTable(
    'sponsorship_ledger',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id').notNull().references(() => sponsorshipOrders.id),
        walletAddress: text('wallet_address').notNull(),
        entryType: text('entry_type').notNull(),
        usdMicros: bigint('usd_micros', { mode: 'bigint' }).notNull(),
        tokenAddress: text('token_address').notNull(),
        tokenAmountRaw: numeric('token_amount_raw', { precision: 78, scale: 0 }).notNull(),
        action: text('action'),
        failureReason: text('failure_reason'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('sponsorship_ledger_order_idx').on(table.orderId, table.createdAt),
        index('sponsorship_ledger_wallet_idx').on(table.walletAddress, table.createdAt),
        check('sponsorship_ledger_amount_check', sql`${table.usdMicros} >= 0 AND ${table.tokenAmountRaw} >= 0`),
    ],
)

export const sponsorshipWalletCredits = pgTable(
    'sponsorship_wallet_credits',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        walletAddress: text('wallet_address').notNull(),
        chainId: integer('chain_id').notNull(),
        tokenAddress: text('token_address').notNull(),
        availableTokenAmountRaw: numeric('available_token_amount_raw', { precision: 78, scale: 0 }).notNull().default('0'),
        availableUsdMicros: bigint('available_usd_micros', { mode: 'bigint' }).notNull().default(0n),
        sourceOrderId: uuid('source_order_id').notNull().references(() => sponsorshipOrders.id),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_wallet_credits_source_idx').on(table.sourceOrderId),
        index('sponsorship_wallet_credits_wallet_idx').on(table.walletAddress, table.chainId),
        check('sponsorship_wallet_credits_nonnegative_check', sql`
            ${table.availableTokenAmountRaw} >= 0 AND ${table.availableUsdMicros} >= 0
        `),
    ],
)

export const sponsorshipUsage = pgTable(
    'sponsorship_usage',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        usageDate: date('usage_date').notNull(),
        chainId: integer('chain_id').notNull(),
        scopeType: text('scope_type').notNull(),
        scopeHash: text('scope_hash').notNull(),
        orderCount: integer('order_count').notNull().default(0),
        sponsoredGasUsdMicros: bigint('sponsored_gas_usd_micros', { mode: 'bigint' }).notNull().default(0n),
        tokenActionCounts: jsonb('token_action_counts').notNull().default({}),
        rejectedAttempts: integer('rejected_attempts').notNull().default(0),
        revertedAttempts: integer('reverted_attempts').notNull().default(0),
        expiredAttempts: integer('expired_attempts').notNull().default(0),
        signatureMismatchAttempts: integer('signature_mismatch_attempts').notNull().default(0),
        failedPaymentAttempts: integer('failed_payment_attempts').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('sponsorship_usage_scope_idx').on(table.usageDate, table.chainId, table.scopeType, table.scopeHash),
        index('sponsorship_usage_day_idx').on(table.usageDate, table.chainId),
        check('sponsorship_usage_nonnegative_check', sql`
            ${table.orderCount} >= 0 AND ${table.sponsoredGasUsdMicros} >= 0 AND
            ${table.rejectedAttempts} >= 0 AND ${table.revertedAttempts} >= 0 AND
            ${table.expiredAttempts} >= 0 AND ${table.signatureMismatchAttempts} >= 0 AND
            ${table.failedPaymentAttempts} >= 0
        `),
    ],
)
