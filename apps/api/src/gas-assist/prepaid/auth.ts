import { createHash, randomBytes } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'
import { isAddressEqual, verifyMessage, type Address, type Hex } from 'viem'

import { getApiConfig } from '../../config.js'
import { getPool } from '../../db/client.js'
import { normalizeAddress } from '../../lib/address.js'
import { GasAssistError } from '../errors.js'

function secretHash(value: string) {
    return `0x${createHash('sha256').update(value).digest('hex')}`
}

function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url')
}

export function buildAuthenticationMessage({
    domain,
    walletAddress,
    nonce,
    issuedAt,
    expiresAt,
}: {
    domain: string
    walletAddress: string
    nonce: string
    issuedAt: Date
    expiresAt: Date
}) {
    return [
        'PistachioSwap Gas Assist Authentication',
        '',
        `Domain: ${domain}`,
        `Wallet: ${walletAddress}`,
        'Chain ID: 56',
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt.toISOString()}`,
        `Expiration Time: ${expiresAt.toISOString()}`,
        '',
        'This signature authenticates your wallet. It does not authorize a transaction.',
    ].join('\n')
}

function normalizeDomain(value: string) {
    const domain = value.trim().toLowerCase()
    if (!/^(?:localhost|127\.0\.0\.1|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/.test(domain)) {
        throw new GasAssistError('AUTH_DOMAIN_INVALID', 'The wallet authentication domain is invalid.')
    }
    return domain
}

export function createWalletAuthService(database: Pool = getPool()) {
    async function createChallenge({
        walletAddress: value,
        chainId,
        domain: domainValue,
    }: {
        walletAddress: string
        chainId: number
        domain: string
    }) {
        const walletAddress = normalizeAddress(value)
        const domain = normalizeDomain(domainValue)
        if (!walletAddress) throw new GasAssistError('INVALID_WALLET', 'A valid wallet address is required.')
        if (chainId !== 56) throw new GasAssistError('WRONG_CHAIN', 'Gas Assist authentication requires BNB Chain.')
        const now = new Date()
        const expiresAt = new Date(now.getTime() + getApiConfig().sponsorship.authChallengeTtlSeconds * 1_000)
        const nonce = randomToken(24)
        const message = buildAuthenticationMessage({
            domain,
            walletAddress,
            nonce,
            issuedAt: now,
            expiresAt,
        })
        const result = await database.query<{ id: string }>(
            `INSERT INTO sponsorship_auth_challenges
             (wallet_address,chain_id,nonce_hash,domain,message,expires_at)
             VALUES ($1,56,$2,$3,$4,$5) RETURNING id`,
            [walletAddress, secretHash(nonce), domain, message, expiresAt],
        )
        return {
            challengeId: result.rows[0]!.id,
            walletAddress,
            chainId: 56,
            domain,
            issuedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            message,
        }
    }

    async function verifyChallenge({
        challengeId,
        signature,
        domain: domainValue,
    }: {
        challengeId: string
        signature: string
        domain: string
    }) {
        if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^0x[0-9a-f]{130}$/i.test(signature)) {
            throw new GasAssistError('AUTH_SIGNATURE_INVALID', 'The wallet authentication signature is invalid.')
        }
        const domain = normalizeDomain(domainValue)
        const client = await database.connect()
        try {
            await client.query('BEGIN')
            const result = await client.query<{
                walletAddress: Address
                message: string
                storedDomain: string
                expiresAt: Date
                consumedAt: Date | null
            }>(
                `SELECT wallet_address AS "walletAddress",message,domain AS "storedDomain",
                        expires_at AS "expiresAt",consumed_at AS "consumedAt"
                 FROM sponsorship_auth_challenges WHERE id=$1 FOR UPDATE`,
                [challengeId],
            )
            const challenge = result.rows[0]
            if (!challenge || challenge.storedDomain !== domain) {
                throw new GasAssistError('AUTH_CHALLENGE_NOT_FOUND', 'The wallet authentication challenge was not found.', 404)
            }
            if (challenge.consumedAt || challenge.expiresAt <= new Date()) {
                throw new GasAssistError('AUTH_CHALLENGE_EXPIRED', 'The wallet authentication challenge expired.', 409)
            }
            const valid = await verifyMessage({
                address: challenge.walletAddress,
                message: challenge.message,
                signature: signature as Hex,
            })
            if (!valid) throw new GasAssistError('AUTH_SIGNER_MISMATCH', 'The signature does not match the requested wallet.', 403)

            const sessionToken = randomToken()
            const expiresAt = new Date(
                Date.now() + getApiConfig().sponsorship.authSessionTtlSeconds * 1_000,
            )
            await client.query(
                `UPDATE sponsorship_auth_challenges SET consumed_at=now() WHERE id=$1`,
                [challengeId],
            )
            await client.query(
                `INSERT INTO sponsorship_auth_sessions
                 (wallet_address,chain_id,token_hash,expires_at)
                 VALUES ($1,56,$2,$3)`,
                [challenge.walletAddress, secretHash(sessionToken), expiresAt],
            )
            await client.query('COMMIT')
            return {
                sessionToken,
                walletAddress: challenge.walletAddress.toLowerCase(),
                chainId: 56,
                expiresAt: expiresAt.toISOString(),
            }
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            client.release()
        }
    }

    async function authenticate(authorization: string | undefined, client?: PoolClient) {
        const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)
        if (!match) throw new GasAssistError('AUTH_REQUIRED', 'Wallet authentication is required.', 401)
        const databaseClient = client ?? database
        const result = await databaseClient.query<{
            id: string
            walletAddress: string
            chainId: number
            expiresAt: Date
        }>(
            `SELECT id,wallet_address AS "walletAddress",chain_id AS "chainId",expires_at AS "expiresAt"
             FROM sponsorship_auth_sessions
             WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()
             LIMIT 1`,
            [secretHash(match[1]!)],
        )
        const session = result.rows[0]
        if (!session || session.chainId !== 56) {
            throw new GasAssistError('AUTH_SESSION_INVALID', 'The wallet authentication session is invalid or expired.', 401)
        }
        await databaseClient.query(
            `UPDATE sponsorship_auth_sessions SET last_seen_at=now() WHERE id=$1`,
            [session.id],
        )
        return {
            sessionId: session.id,
            walletAddress: session.walletAddress,
            chainId: 56 as const,
            expiresAt: session.expiresAt,
        }
    }

    return { createChallenge, verifyChallenge, authenticate }
}

export const walletAuthInternals = {
    secretHash,
    buildAuthenticationMessage,
    normalizeDomain,
    addressesMatch: (left: Address, right: Address) => isAddressEqual(left, right),
}
