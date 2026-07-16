import type { Pool } from 'pg'
import { isAddressEqual } from 'viem'

import { getApiConfig } from '../config.js'
import { getPool } from '../db/client.js'
import { GasAssistError } from './errors.js'
import {
    hashPrivateScope,
    unsignedTransactionEvidence,
    verifySignedApproval,
} from './exact-approval.js'
import { validateEligibility, type EligibilityInput } from './eligibility.js'
import { loadSwapIntent } from './intents.js'
import { paymasterClient } from './paymaster.js'
import { authorizeRule, loadExactSponsorRule } from './rules.js'

type ApprovalQuote = {
    id: string
    chainId: number
    walletAddress: `0x${string}`
    tokenAddress: `0x${string}`
    spenderAddress: `0x${string}`
    amountIn: string
    sponsorRuleId: string
    swapIntentId: string
    nonce: string
    gasLimit: string
    transactionType: string
    status: string
    expiresAt: Date
    submittedTxHash: string | null
    submissionAttempts: number
}

async function reserveSubmission(
    database: Pool,
    quote: ApprovalQuote,
    rule: ReturnType<typeof authorizeRule>,
    walletHash: string,
    ipHash: string,
) {
    const client = await database.connect()
    try {
        await client.query('BEGIN')
        for (const scope of [walletHash, ipHash, rule.id].sort()) {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope])
        }
        const result = await client.query<{
            walletCount: string
            ipCount: string
            ruleCount: string
            ruleAmount: string
        }>(
            `SELECT
              (SELECT COALESCE(sum(sponsored_count),0) FROM gas_assist_daily_usage
               WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND wallet_address_hash=$1)
              + (SELECT count(*) FROM gas_assist_sponsorship_attempts
                 WHERE created_at >= (now() at time zone 'utc')::date AND chain_id=56
                   AND wallet_address_hash=$1 AND outcome='submitting') AS "walletCount",
              (SELECT COALESCE(sum(sponsored_count),0) FROM gas_assist_daily_usage
               WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND ip_hash=$2)
              + (SELECT count(*) FROM gas_assist_sponsorship_attempts
                 WHERE created_at >= (now() at time zone 'utc')::date AND chain_id=56
                   AND ip_hash=$2 AND outcome='submitting') AS "ipCount",
              (SELECT COALESCE(sum(sponsored_count),0) FROM gas_assist_daily_usage
               WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND sponsor_rule_id=$3)
              + (SELECT count(*) FROM gas_assist_sponsorship_attempts
                 WHERE created_at >= (now() at time zone 'utc')::date AND chain_id=56
                   AND sponsor_rule_id=$3 AND outcome='submitting') AS "ruleCount",
              (SELECT COALESCE(sum(sponsored_amount_base_units),0) FROM gas_assist_daily_usage
               WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=56 AND sponsor_rule_id=$3)
              + (SELECT COALESCE(sum(q.amount_in),0)
                 FROM gas_assist_sponsorship_attempts a
                 JOIN gas_assist_approval_quotes q ON q.id=a.quote_id
                 WHERE a.created_at >= (now() at time zone 'utc')::date AND a.chain_id=56
                   AND a.sponsor_rule_id=$3 AND a.outcome='submitting') AS "ruleAmount"`,
            [walletHash, ipHash, rule.id],
        )
        const usage = result.rows[0]!
        const config = getApiConfig().gasAssist
        if (BigInt(usage.walletCount) >= BigInt(config.dailyWalletLimit)) {
            throw new GasAssistError('WALLET_DAILY_LIMIT', 'The wallet Gas Assist daily limit has been reached.', 429)
        }
        if (BigInt(usage.ipCount) >= BigInt(config.dailyIpLimit)) {
            throw new GasAssistError('IP_DAILY_LIMIT', 'The Gas Assist network daily limit has been reached.', 429)
        }
        if (
            rule.maximumSponsorshipsPerDay !== null &&
            BigInt(usage.ruleCount) >= BigInt(rule.maximumSponsorshipsPerDay)
        ) {
            throw new GasAssistError('RULE_DAILY_LIMIT', 'The sponsor rule daily limit has been reached.', 429)
        }
        if (
            rule.maximumTotalAmountPerDayBaseUnits !== null &&
            BigInt(usage.ruleAmount) + BigInt(quote.amountIn) >
                BigInt(rule.maximumTotalAmountPerDayBaseUnits)
        ) {
            throw new GasAssistError('RULE_DAILY_AMOUNT_LIMIT', 'The sponsor rule daily amount limit would be exceeded.', 429)
        }
        const transition = await client.query(
            `UPDATE gas_assist_approval_quotes
             SET status='submitting', submission_attempts=submission_attempts+1, updated_at=now()
             WHERE id=$1 AND status IN ('pending','signing','failed') AND submission_attempts < 2`,
            [quote.id],
        )
        if (!transition.rowCount) {
            throw new GasAssistError('APPROVAL_QUOTE_IN_USE', 'The approval quote is already being submitted.', 409)
        }
        const attempt = await client.query<{ id: string }>(
            `INSERT INTO gas_assist_sponsorship_attempts (
               quote_id, sponsor_rule_id, chain_id, wallet_address_hash, ip_hash,
               token_address, outcome, provider_code
             ) VALUES ($1,$2,56,$3,$4,$5,'submitting','MEGAFUEL') RETURNING id`,
            [quote.id, rule.id, walletHash, ipHash, quote.tokenAddress],
        )
        await client.query('COMMIT')
        return attempt.rows[0]!.id
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
}

export async function createApprovalQuote(
    input: EligibilityInput,
    database?: Pool,
) {
    if (!getApiConfig().gasAssist.enabled) {
        throw new GasAssistError('GAS_ASSIST_DISABLED', 'Gas Assist is disabled.', 503)
    }
    const activeDatabase = database ?? getPool()
    const eligibility = await validateEligibility(input, { database: activeDatabase })
    if (eligibility.status !== 'sponsorable') return eligibility
    const evidence = unsignedTransactionEvidence(eligibility.transaction)
    const expiresAt = new Date(
        Date.now() + getApiConfig().gasAssist.quoteTtlSeconds * 1_000,
    )
    const result = await activeDatabase.query<{ id: string }>(
        `INSERT INTO gas_assist_approval_quotes (
           chain_id, wallet_address, token_address, spender_address, amount_in,
           sponsor_rule_id, swap_intent_id, nonce, gas_limit, transaction_type,
           unsigned_transaction_hash, calldata_hash, sponsor_policy_reference, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'legacy',$10,$11,$12,$13)
         RETURNING id`,
        [
            56,
            eligibility.transaction.from,
            eligibility.transaction.to,
            getApiConfig().gasAssist.swapContractAddress,
            eligibility.amount.toString(),
            eligibility.rule.id,
            eligibility.intent.id,
            BigInt(eligibility.transaction.nonce).toString(),
            eligibility.gasLimit.toString(),
            evidence.unsignedTransactionHash,
            evidence.calldataHash,
            'configured-policy',
            expiresAt,
        ],
    )
    return {
        status: 'sponsorable' as const,
        quoteId: result.rows[0]!.id,
        expiresAt: expiresAt.toISOString(),
        transaction: eligibility.transaction,
    }
}

async function loadApprovalQuote(database: Pool, quoteId: string) {
    const result = await database.query<ApprovalQuote>(
        `SELECT id, chain_id AS "chainId", wallet_address AS "walletAddress",
                token_address AS "tokenAddress", spender_address AS "spenderAddress",
                amount_in::text AS "amountIn", sponsor_rule_id AS "sponsorRuleId",
                swap_intent_id AS "swapIntentId", nonce::text, gas_limit::text AS "gasLimit",
                transaction_type AS "transactionType", status, expires_at AS "expiresAt",
                submitted_tx_hash AS "submittedTxHash", submission_attempts AS "submissionAttempts"
         FROM gas_assist_approval_quotes WHERE id=$1 LIMIT 1`,
        [quoteId],
    )
    return result.rows[0] ?? null
}

export async function getApprovalQuoteStatus(quoteId: string, database?: Pool) {
    if (!getApiConfig().gasAssist.enabled) {
        throw new GasAssistError('GAS_ASSIST_DISABLED', 'Gas Assist is disabled.', 503)
    }
    const quote = await loadApprovalQuote(database ?? getPool(), quoteId)
    if (!quote) throw new GasAssistError('APPROVAL_QUOTE_NOT_FOUND', 'Approval quote not found.', 404)
    return {
        quoteId: quote.id,
        status: quote.status,
        expiresAt: quote.expiresAt.toISOString(),
        transactionHash: quote.submittedTxHash,
    }
}

export async function submitApprovalQuote({
    quoteId,
    signedTransaction,
    clientIp,
    database,
}: {
    quoteId: string
    signedTransaction: `0x${string}`
    clientIp: string
    database?: Pool
}) {
    if (!getApiConfig().gasAssist.enabled) {
        throw new GasAssistError('GAS_ASSIST_DISABLED', 'Gas Assist is disabled.', 503)
    }
    const activeDatabase = database ?? getPool()
    const quote = await loadApprovalQuote(activeDatabase, quoteId)
    if (!quote) throw new GasAssistError('APPROVAL_QUOTE_NOT_FOUND', 'Approval quote not found.', 404)
    if (quote.status === 'submitted' || quote.status === 'confirmed') {
        return { status: quote.status, transactionHash: quote.submittedTxHash }
    }
    if (quote.expiresAt <= new Date()) {
        await activeDatabase.query(
            `UPDATE gas_assist_approval_quotes SET status='expired', updated_at=now()
             WHERE id=$1 AND status IN ('pending','signing','failed')`,
            [quote.id],
        )
        throw new GasAssistError('APPROVAL_QUOTE_EXPIRED', 'The approval quote has expired.', 409)
    }
    if (!['pending', 'signing', 'failed'].includes(quote.status) || quote.submissionAttempts >= 2) {
        throw new GasAssistError('APPROVAL_QUOTE_NOT_PENDING', 'The approval quote cannot be submitted again.', 409)
    }

    const rule = authorizeRule(
        await loadExactSponsorRule(activeDatabase, quote.chainId, quote.walletAddress, quote.tokenAddress),
        BigInt(quote.amountIn),
    )
    if (rule.id !== quote.sponsorRuleId || rule.walletAddress !== quote.walletAddress) {
        throw new GasAssistError('SPONSOR_RULE_MISMATCH', 'The sponsor rule no longer matches this quote.', 403)
    }
    const intent = await loadSwapIntent(quote.swapIntentId, activeDatabase)
    const configuredSpender = getApiConfig().gasAssist.swapContractAddress as `0x${string}`
    if (
        !intent || intent.status !== 'active' || intent.expiresAt <= new Date() ||
        intent.walletAddress !== quote.walletAddress ||
        intent.sellTokenAddress !== quote.tokenAddress ||
        BigInt(intent.amountIn) !== BigInt(quote.amountIn) ||
        !intent.routeExecutableThroughSwapContract ||
        !intent.swapContractAddress ||
        !isAddressEqual(intent.swapContractAddress as `0x${string}`, configuredSpender)
    ) {
        throw new GasAssistError('SWAP_INTENT_MISMATCH', 'The active swap intent no longer matches this approval.', 409)
    }
    const verification = await verifySignedApproval({
        signedTransaction,
        wallet: quote.walletAddress,
        token: quote.tokenAddress,
        spender: configuredSpender,
        amount: BigInt(quote.amountIn),
        nonce: BigInt(quote.nonce),
        gasLimit: BigInt(quote.gasLimit),
    })

    const eligibility = await validateEligibility({
        chainId: 56,
        walletAddress: quote.walletAddress,
        tokenAddress: quote.tokenAddress,
        amountIn: quote.amountIn,
        swapIntentId: quote.swapIntentId,
        clientIp,
    }, { database: activeDatabase })
    if (eligibility.status !== 'sponsorable') {
        throw new GasAssistError(
            eligibility.status === 'already-approved'
                ? 'ALLOWANCE_ALREADY_SUFFICIENT'
                : 'NORMAL_APPROVAL_REQUIRED',
            'The approval no longer requires sponsorship.',
            409,
        )
    }

    const config = getApiConfig().gasAssist
    const walletHash = hashPrivateScope(config.ipHashSecret as string, quote.walletAddress)
    const ipHash = hashPrivateScope(config.ipHashSecret as string, clientIp)
    const attemptId = await reserveSubmission(
        activeDatabase,
        quote,
        rule,
        walletHash,
        ipHash,
    )

    let transactionHash: `0x${string}`
    try {
        transactionHash = await paymasterClient.submit(signedTransaction)
        if (transactionHash !== verification.transactionHash.toLowerCase()) {
            throw new GasAssistError(
                'PAYMASTER_HASH_MISMATCH',
                'The paymaster transaction hash did not match the signed approval.',
                502,
            )
        }
    } catch (error) {
        await activeDatabase.query(
            `UPDATE gas_assist_approval_quotes
             SET status='failed', failure_code='PAYMASTER_SUBMISSION_FAILED', updated_at=now()
             WHERE id=$1 AND status='submitting'`,
            [quote.id],
        )
        await activeDatabase.query(
            `UPDATE gas_assist_sponsorship_attempts
             SET outcome='failed', provider_code='PAYMASTER_SUBMISSION_FAILED'
             WHERE id=$1 AND outcome='submitting'`,
            [attemptId],
        )
        throw error
    }

    const client = await activeDatabase.connect()
    try {
        await client.query('BEGIN')
        await client.query(
            `UPDATE gas_assist_approval_quotes
             SET status='submitted', submitted_tx_hash=$2, failure_code=NULL, updated_at=now()
             WHERE id=$1 AND status='submitting'`,
            [quote.id, transactionHash],
        )
        await client.query(
            `UPDATE gas_assist_sponsorship_attempts
             SET outcome='submitted', transaction_hash=$2
             WHERE id=$1 AND outcome='submitting'`,
            [attemptId, transactionHash],
        )
        await client.query(
            `INSERT INTO gas_assist_daily_usage (
               usage_date, chain_id, sponsor_rule_id, wallet_address_hash, ip_hash,
               sponsored_count, sponsored_gas, sponsored_amount_base_units
             ) VALUES ((now() at time zone 'utc')::date,56,$1,$2,$3,1,$4,$5)
             ON CONFLICT (usage_date, chain_id, sponsor_rule_id, wallet_address_hash, ip_hash)
             DO UPDATE SET
               sponsored_count=gas_assist_daily_usage.sponsored_count+1,
               sponsored_gas=gas_assist_daily_usage.sponsored_gas+EXCLUDED.sponsored_gas,
               sponsored_amount_base_units=gas_assist_daily_usage.sponsored_amount_base_units+EXCLUDED.sponsored_amount_base_units,
               updated_at=now()`,
            [rule.id, walletHash, ipHash, quote.gasLimit, quote.amountIn],
        )
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
    return { status: 'submitted' as const, transactionHash }
}
