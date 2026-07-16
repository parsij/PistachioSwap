import {
    bigint,
    boolean,
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

export const gasAssistGaslessQuotes = pgTable(
    'gas_assist_gasless_quotes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
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
