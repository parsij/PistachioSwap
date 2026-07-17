import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'
import { verifyMessage, type Address, type Hex } from 'viem'

import { isCuratedEvmChainId } from '../chains.js'
import { getPool } from '../db/client.js'
import { normalizeAddress } from '../lib/address.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1_000
const SESSION_TTL_MS = 15 * 60 * 1_000

interface Challenge {
    id: string
    walletAddress: Address
    chainId: number
    nonceHash: string
    domain: string
    message: string
    expiresAt: Date
    consumedAt: Date | null
    createdAt: Date
}

interface Session {
    id: string
    walletAddress: Address
    chainId: number
    tokenHash: string
    expiresAt: Date
    revokedAt: Date | null
    lastSeenAt: Date
    createdAt: Date
}

export interface CrossChainAuthSession {
    sessionId: string
    walletAddress: Address
    chainId: number
    expiresAt: Date
}

export type CrossChainSignatureVerifier = (input: {
    address: Address
    message: string
    signature: Hex
}) => Promise<boolean>

export class CrossChainAuthError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly statusCode = 400,
    ) {
        super(message)
    }
}

function secretHash(value: string) {
    return `0x${createHash('sha256').update(value).digest('hex')}`
}

function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url')
}

export function normalizeCrossChainAuthDomain(value: string) {
    const domain = value.trim().toLowerCase()
    if (
        domain.length > 255 ||
        !/^(?:localhost|127\.0\.0\.1|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/.test(domain)
    ) {
        throw new CrossChainAuthError(
            'AUTH_DOMAIN_INVALID',
            'The wallet authentication domain is invalid.',
        )
    }
    return domain
}

export function buildCrossChainAuthenticationMessage(input: {
    domain: string
    walletAddress: string
    chainId: number
    nonce: string
    issuedAt: Date
    expiresAt: Date
}) {
    return [
        'PistachioSwap Cross-Chain Authentication',
        '',
        `Domain: ${input.domain}`,
        `Wallet: ${input.walletAddress}`,
        `Source Chain ID: ${input.chainId}`,
        `Nonce: ${input.nonce}`,
        `Issued At: ${input.issuedAt.toISOString()}`,
        `Expiration Time: ${input.expiresAt.toISOString()}`,
        '',
        'This signature authenticates this wallet for cross-chain route mutations on the source chain.',
        'It does not authorize or submit a transaction.',
    ].join('\n')
}

export class CrossChainAuthService {
    private readonly challenges = new Map<string, Challenge>()
    private readonly sessions = new Map<string, Session>()

    constructor(
        private readonly database?: Pool,
        private readonly verifier: CrossChainSignatureVerifier = async (input) =>
            verifyMessage(input),
        private readonly now: () => Date = () => new Date(),
    ) {}

    async createChallenge(input: {
        walletAddress: string
        chainId: number
        domain: string
    }) {
        const walletAddress = normalizeAddress(input.walletAddress) as Address | null
        if (!walletAddress) {
            throw new CrossChainAuthError('INVALID_WALLET', 'A valid wallet address is required.')
        }
        if (!isCuratedEvmChainId(input.chainId)) {
            throw new CrossChainAuthError(
                'INVALID_CHAIN',
                'An enabled source chain ID is required.',
            )
        }
        const domain = normalizeCrossChainAuthDomain(input.domain)
        const issuedAt = this.now()
        const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS)
        const nonce = randomToken(24)
        const challenge: Challenge = {
            id: randomUUID(),
            walletAddress,
            chainId: input.chainId,
            nonceHash: secretHash(nonce),
            domain,
            message: buildCrossChainAuthenticationMessage({
                domain,
                walletAddress,
                chainId: input.chainId,
                nonce,
                issuedAt,
                expiresAt,
            }),
            expiresAt,
            consumedAt: null,
            createdAt: issuedAt,
        }

        if (this.database) {
            await this.database.query(
                `INSERT INTO cross_chain_auth_challenges
                 (id,wallet_address,chain_id,nonce_hash,domain,message,expires_at,created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                    challenge.id,
                    challenge.walletAddress,
                    challenge.chainId,
                    challenge.nonceHash,
                    challenge.domain,
                    challenge.message,
                    challenge.expiresAt,
                    challenge.createdAt,
                ],
            )
        } else {
            this.challenges.set(challenge.id, challenge)
        }

        return {
            challengeId: challenge.id,
            walletAddress,
            chainId: challenge.chainId,
            domain,
            issuedAt: issuedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            message: challenge.message,
        }
    }

    async verifyChallenge(input: {
        challengeId: string
        signature: string
        domain: string
    }) {
        if (
            !/^[0-9a-f-]{36}$/i.test(input.challengeId) ||
            !/^0x[0-9a-f]{130}$/i.test(input.signature)
        ) {
            throw new CrossChainAuthError(
                'AUTH_SIGNATURE_INVALID',
                'The wallet authentication signature is invalid.',
            )
        }
        const domain = normalizeCrossChainAuthDomain(input.domain)
        if (this.database) {
            const client = await this.database.connect()
            try {
                await client.query('BEGIN')
                const challenge = await this.readDatabaseChallenge(
                    input.challengeId,
                    client,
                )
                const result = await this.consumeChallenge(
                    challenge,
                    domain,
                    input.signature as Hex,
                )
                await client.query(
                    'UPDATE cross_chain_auth_challenges SET consumed_at=$2 WHERE id=$1',
                    [challenge.id, result.consumedAt],
                )
                await client.query(
                    `INSERT INTO cross_chain_auth_sessions
                     (id,wallet_address,chain_id,token_hash,expires_at,last_seen_at,created_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [
                        result.session.id,
                        result.session.walletAddress,
                        result.session.chainId,
                        result.session.tokenHash,
                        result.session.expiresAt,
                        result.session.lastSeenAt,
                        result.session.createdAt,
                    ],
                )
                await client.query('COMMIT')
                return result.response
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined)
                throw error
            } finally {
                client.release()
            }
        }

        const challenge = this.challenges.get(input.challengeId)
        const result = await this.consumeChallenge(
            challenge,
            domain,
            input.signature as Hex,
        )
        challenge!.consumedAt = result.consumedAt
        this.sessions.set(result.session.tokenHash, result.session)
        return result.response
    }

    async authenticate(authorization: string | undefined): Promise<CrossChainAuthSession> {
        const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)
        if (!match) {
            throw new CrossChainAuthError(
                'AUTH_REQUIRED',
                'Cross-chain wallet authentication is required.',
                401,
            )
        }
        const tokenHash = secretHash(match[1]!)
        const now = this.now()

        if (this.database) {
            const result = await this.database.query<{
                id: string
                walletAddress: Address
                chainId: number
                expiresAt: Date
            }>(
                `SELECT id,wallet_address AS "walletAddress",chain_id AS "chainId",
                        expires_at AS "expiresAt"
                 FROM cross_chain_auth_sessions
                 WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > $2
                 LIMIT 1`,
                [tokenHash, now],
            )
            const session = result.rows[0]
            if (!session) this.invalidSession()
            await this.database.query(
                'UPDATE cross_chain_auth_sessions SET last_seen_at=$2 WHERE id=$1',
                [session!.id, now],
            )
            return {
                sessionId: session!.id,
                walletAddress: session!.walletAddress,
                chainId: session!.chainId,
                expiresAt: session!.expiresAt,
            }
        }

        const session = this.sessions.get(tokenHash)
        if (!session || session.revokedAt || session.expiresAt <= now) this.invalidSession()
        session!.lastSeenAt = now
        return {
            sessionId: session!.id,
            walletAddress: session!.walletAddress,
            chainId: session!.chainId,
            expiresAt: session!.expiresAt,
        }
    }

    async revoke(authorization: string | undefined) {
        const session = await this.authenticate(authorization)
        const now = this.now()
        if (this.database) {
            await this.database.query(
                'UPDATE cross_chain_auth_sessions SET revoked_at=$2 WHERE id=$1',
                [session.sessionId, now],
            )
        } else {
            const stored = [...this.sessions.values()].find(({ id }) => id === session.sessionId)
            if (stored) stored.revokedAt = now
        }
    }

    private async readDatabaseChallenge(challengeId: string, client: PoolClient) {
        const result = await client.query<{
            id: string
            walletAddress: Address
            chainId: number
            nonceHash: string
            domain: string
            message: string
            expiresAt: Date
            consumedAt: Date | null
            createdAt: Date
        }>(
            `SELECT id,wallet_address AS "walletAddress",chain_id AS "chainId",
                    nonce_hash AS "nonceHash",domain,message,expires_at AS "expiresAt",
                    consumed_at AS "consumedAt",created_at AS "createdAt"
             FROM cross_chain_auth_challenges WHERE id=$1 FOR UPDATE`,
            [challengeId],
        )
        return result.rows[0]
    }

    private async consumeChallenge(
        challenge: Challenge | undefined,
        domain: string,
        signature: Hex,
    ) {
        if (!challenge || challenge.domain !== domain) {
            throw new CrossChainAuthError(
                'AUTH_CHALLENGE_NOT_FOUND',
                'The wallet authentication challenge was not found.',
                404,
            )
        }
        const consumedAt = this.now()
        if (challenge.consumedAt || challenge.expiresAt <= consumedAt) {
            throw new CrossChainAuthError(
                'AUTH_CHALLENGE_EXPIRED',
                'The wallet authentication challenge expired or was already used.',
                409,
            )
        }
        const valid = await this.verifier({
            address: challenge.walletAddress,
            message: challenge.message,
            signature,
        })
        if (!valid) {
            throw new CrossChainAuthError(
                'AUTH_SIGNER_MISMATCH',
                'The signature does not match the requested wallet.',
                403,
            )
        }
        const sessionToken = randomToken()
        const expiresAt = new Date(consumedAt.getTime() + SESSION_TTL_MS)
        const session: Session = {
            id: randomUUID(),
            walletAddress: challenge.walletAddress,
            chainId: challenge.chainId,
            tokenHash: secretHash(sessionToken),
            expiresAt,
            revokedAt: null,
            lastSeenAt: consumedAt,
            createdAt: consumedAt,
        }
        return {
            consumedAt,
            session,
            response: {
                sessionToken,
                walletAddress: session.walletAddress,
                chainId: session.chainId,
                expiresAt: expiresAt.toISOString(),
            },
        }
    }

    private invalidSession(): never {
        throw new CrossChainAuthError(
            'AUTH_SESSION_INVALID',
            'The cross-chain wallet session is invalid or expired.',
            401,
        )
    }
}

let defaultService: CrossChainAuthService | null = null

export function createCrossChainAuthService(input: {
    database?: Pool
    verifier?: CrossChainSignatureVerifier
    now?: () => Date
} = {}) {
    return new CrossChainAuthService(input.database, input.verifier, input.now)
}

export function getCrossChainAuthService() {
    if (!defaultService) {
        const database = process.env.DATABASE_URL ? getPool() : undefined
        defaultService = createCrossChainAuthService({ database })
    }
    return defaultService
}

export const crossChainAuthInternals = {
    secretHash,
}
