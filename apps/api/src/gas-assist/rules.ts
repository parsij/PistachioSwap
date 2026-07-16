import type { Pool, PoolClient } from 'pg'

import { GasAssistError } from './errors.js'

export type SponsorRule = {
    id: string
    chainId: number
    walletAddress: string
    tokenAddress: string
    minimumAmountBaseUnits: string
    maximumAmountBaseUnits: string | null
    enabled: boolean
    expiresAt: Date | null
    maximumSponsorshipsPerDay: number | null
    maximumTotalAmountPerDayBaseUnits: string | null
}

type Queryable = Pick<Pool | PoolClient, 'query'>

export async function loadExactSponsorRule(
    database: Queryable,
    chainId: number,
    walletAddress: string,
    tokenAddress: string,
) {
    const result = await database.query<SponsorRule>(
        `SELECT id, chain_id AS "chainId", wallet_address AS "walletAddress",
                token_address AS "tokenAddress",
                minimum_amount_base_units::text AS "minimumAmountBaseUnits",
                maximum_amount_base_units::text AS "maximumAmountBaseUnits",
                enabled, expires_at AS "expiresAt",
                maximum_sponsorships_per_day AS "maximumSponsorshipsPerDay",
                maximum_total_amount_per_day_base_units::text AS "maximumTotalAmountPerDayBaseUnits"
         FROM gas_assist_sponsor_rules
         WHERE chain_id=$1 AND wallet_address=$2 AND token_address=$3
         LIMIT 1`,
        [chainId, walletAddress, tokenAddress],
    )
    return result.rows[0] ?? null
}

export function authorizeRule(rule: SponsorRule | null, amount: bigint, now = new Date()) {
    if (!rule) throw new GasAssistError('GAS_ASSIST_RULE_NOT_FOUND', 'This wallet and token are not eligible for Gas Assist.', 403)
    if (!rule.enabled) throw new GasAssistError('GAS_ASSIST_RULE_DISABLED', 'This Gas Assist rule is disabled.', 403)
    if (rule.expiresAt && rule.expiresAt <= now) {
        throw new GasAssistError('GAS_ASSIST_RULE_EXPIRED', 'This Gas Assist rule has expired.', 403)
    }
    if (amount < BigInt(rule.minimumAmountBaseUnits)) {
        throw new GasAssistError('BELOW_SPONSOR_MINIMUM', 'The approval amount is below the sponsor minimum.', 403)
    }
    if (rule.maximumAmountBaseUnits !== null && amount > BigInt(rule.maximumAmountBaseUnits)) {
        throw new GasAssistError('ABOVE_SPONSOR_MAXIMUM', 'The approval amount is above the sponsor maximum.', 403)
    }
    return rule
}
