from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one occurrence, found {count}: {old[:120]!r}"
        )
    file.write_text(text.replace(old, new))


# Keep the legacy settlement path consistent with the durable settlement path.
replace(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    """                `INSERT INTO sponsorship_usage
                 (usage_date,chain_id,scope_type,scope_hash,sponsored_gas_usd_micros,reverted_attempts,token_action_counts)
                 VALUES ((now() at time zone 'utc')::date,56,$1,$2,$3,$4,jsonb_build_object($5,1))
                 ON CONFLICT (usage_date,chain_id,scope_type,scope_hash)
                 DO UPDATE SET sponsored_gas_usd_micros=sponsorship_usage.sponsored_gas_usd_micros+EXCLUDED.sponsored_gas_usd_micros,
                               reverted_attempts=sponsorship_usage.reverted_attempts+EXCLUDED.reverted_attempts,
                               token_action_counts=sponsorship_usage.token_action_counts || EXCLUDED.token_action_counts,
                               updated_at=now()`,""",
    """                `INSERT INTO sponsorship_usage
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
                               updated_at=now()`,""",
)

# Describe every column and event table added by migration 0005 in Drizzle.
replace(
    "apps/api/src/db/schema.ts",
    """        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        signedRawTransactionHash: text('signed_raw_transaction_hash'),
        transactionHash: text('transaction_hash'),
        submissionAttempts: integer('submission_attempts').notNull().default(0),
        failureCode: text('failure_code'),""",
    """        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        signedRawTransaction: text('signed_raw_transaction'),
        signedRawTransactionHash: text('signed_raw_transaction_hash'),
        signedAt: timestamp('signed_at', { withTimezone: true }),
        firstBroadcastAt: timestamp('first_broadcast_at', { withTimezone: true }),
        lastBroadcastAt: timestamp('last_broadcast_at', { withTimezone: true }),
        submittedAt: timestamp('submitted_at', { withTimezone: true }),
        finalizedAt: timestamp('finalized_at', { withTimezone: true }),
        broadcastAttempts: integer('broadcast_attempts').notNull().default(0),
        transactionHash: text('transaction_hash'),
        submissionAttempts: integer('submission_attempts').notNull().default(0),
        failureCode: text('failure_code'),""",
)
replace(
    "apps/api/src/db/schema.ts",
    """        index('sponsorship_intents_expiry_idx').on(table.status, table.expiresAt),
        check('sponsorship_intents_chain_check', sql`${table.chainId} = 56`),
        check('sponsorship_intents_value_gas_check', sql`
            ${table.nativeValue} = 0 AND ${table.gasLimit} > 0 AND ${table.gasPrice} = 0
        `),""",
    """        index('sponsorship_intents_expiry_idx').on(table.status, table.expiresAt),
        index('sponsorship_intents_recovery_idx')
            .on(table.status, table.lastBroadcastAt, table.expiresAt)
            .where(sql`${table.status} IN ('submitting','submitted','unknown')`),
        check('sponsorship_intents_chain_check', sql`${table.chainId} = 56`),
        check('sponsorship_intents_value_gas_check', sql`
            ${table.nativeValue} = 0 AND ${table.gasLimit} > 0 AND ${table.gasPrice} = 0
        `),
        check('sponsorship_intents_broadcast_attempts_check', sql`
            ${table.broadcastAttempts} BETWEEN 0 AND 3
        `),
        check('sponsorship_intents_signed_raw_transaction_check', sql`
            ${table.signedRawTransaction} IS NULL OR (
                ${table.signedRawTransaction} ~ '^0x[0-9a-f]+$' AND
                (length(${table.signedRawTransaction}) - 2) % 2 = 0 AND
                ${table.signedRawTransactionHash} ~ '^0x[0-9a-f]{64}$' AND
                ${table.signedAt} IS NOT NULL
            )
        `),""",
)
replace(
    "apps/api/src/db/schema.ts",
    """export const sponsorshipLedger = pgTable(
""",
    """export const sponsorshipIntentEvents = pgTable(
    'sponsorship_intent_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        intentId: uuid('intent_id')
            .notNull()
            .references(() => sponsorshipTransactionIntents.id),
        orderId: uuid('order_id')
            .notNull()
            .references(() => sponsorshipOrders.id),
        action: text('action').notNull(),
        eventType: text('event_type').notNull(),
        previousStatus: text('previous_status'),
        status: text('status').notNull(),
        transactionHash: text('transaction_hash'),
        details: jsonb('details').notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('sponsorship_intent_events_intent_idx').on(
            table.intentId,
            table.createdAt,
        ),
        index('sponsorship_intent_events_order_idx').on(
            table.orderId,
            table.createdAt,
        ),
        check('sponsorship_intent_events_action_check', sql`
            ${table.action} IN (
                'fee-payment-transfer','token-approval','normal-swap'
            )
        `),
        check('sponsorship_intent_events_event_type_check', sql`
            ${table.eventType} IN (
                'intent-created','raw-transaction-received',
                'broadcast-attempted','transaction-hash-recorded',
                'status-changed'
            )
        `),
    ],
)

export const sponsorshipLedger = pgTable(
""",
)
