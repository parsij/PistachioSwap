import { randomUUID } from 'node:crypto'

import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { getDatabase } from '../db/client.js'
import {
    crossChainRoutes,
    crossChainRouteSteps,
} from '../db/schema.js'
import type {
    CrossChainQuote,
    CrossChainStep,
    PublicCrossChainRoute,
    PublicRouteState,
} from './types.js'
import { emptyCrossChainCosts, normalizePublicCosts } from './costs.js'

export interface CrossChainRouteRepository {
    create(quote: CrossChainQuote): Promise<PublicCrossChainRoute>
    get(routeId: string): Promise<PublicCrossChainRoute | null>
    markPrepared(routeId: string, ownerAddress: string): Promise<PublicCrossChainRoute>
    setPreparedProviderReference(
        routeId: string,
        providerTrackingId: string,
        expiresAt: string,
    ): Promise<PublicCrossChainRoute>
    claimSubmission(routeId: string, ownerAddress: string): Promise<PublicCrossChainRoute>
    markSubmitted(
        routeId: string,
        ownerAddress: string,
        transactionHash: string,
    ): Promise<PublicCrossChainRoute>
    updateProviderStatus(
        routeId: string,
        update: ProviderStatusUpdate,
    ): Promise<PublicCrossChainRoute>
}

export type ProviderStatusUpdate = {
    status: PublicRouteState
    providerStatus: string
    sourceTransactionHash?: string | null
    destinationTransactionHash?: string | null
    failureCode?: string | null
}

export class MemoryCrossChainRouteRepository implements CrossChainRouteRepository {
    private readonly routes = new Map<string, PublicCrossChainRoute>()

    constructor(private readonly maximumEntries = 5_000) {}

    async create(quote: CrossChainQuote) {
        const existing = [...this.routes.values()].find((route) => route.quoteId === quote.quoteId)
        if (existing) return clone(existing)
        if (this.routes.size >= this.maximumEntries) {
            throw routeError(
                'ROUTE_CAPACITY_REACHED',
                'Cross-chain route storage is temporarily at capacity.',
                503,
            )
        }
        const now = new Date().toISOString()
        const route = toPublicRoute(quote, randomUUID(), now)
        this.routes.set(route.routeId, route)
        return clone(route)
    }

    async get(routeId: string) {
        const route = this.routes.get(routeId)
        if (!route) return null
        this.expire(route)
        return clone(route)
    }

    async markPrepared(routeId: string, ownerAddress: string) {
        const route = this.requireOwned(routeId, ownerAddress)
        this.expire(route)
        if (route.status === 'expired') throw routeError('ROUTE_EXPIRED', 'Route has expired.')
        if (!['quoted', 'prepared'].includes(route.status)) {
            throw routeError('ROUTE_NOT_PREPARABLE', 'Route can no longer be prepared.')
        }
        if (route.status === 'quoted') route.status = 'prepared'
        route.updatedAt = new Date().toISOString()
        return clone(route)
    }

    async claimSubmission(routeId: string, ownerAddress: string) {
        const route = this.requireOwned(routeId, ownerAddress)
        this.expire(route)
        if (route.status === 'expired') throw routeError('ROUTE_EXPIRED', 'Route has expired.')
        if (route.submissionAttempts !== 0) {
            throw routeError('SOURCE_SUBMISSION_ALREADY_CLAIMED', 'Source submission was already claimed.')
        }
        if (route.status !== 'prepared') {
            throw routeError('ROUTE_NOT_PREPARED', 'Route must be prepared before submission.')
        }
        route.submissionAttempts = 1
        route.claimedAt = new Date().toISOString()
        route.status = 'awaiting-source'
        route.updatedAt = route.claimedAt
        return clone(route)
    }

    async setPreparedProviderReference(
        routeId: string,
        providerTrackingId: string,
        expiresAt: string,
    ) {
        const route = this.routes.get(routeId)
        if (!route) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        route.providerTrackingId = providerTrackingId
        route.expiresAt = expiresAt
        route.updatedAt = new Date().toISOString()
        return clone(route)
    }

    async markSubmitted(routeId: string, ownerAddress: string, transactionHash: string) {
        const route = this.requireOwned(routeId, ownerAddress)
        if (route.sourceTransactionHash === transactionHash) return clone(route)
        if (route.submissionAttempts !== 1 || route.sourceTransactionHash) {
            throw routeError('SOURCE_SUBMISSION_NOT_CLAIMED', 'Source submission is not claimable.')
        }
        route.sourceTransactionHash = transactionHash
        route.submittedAt = new Date().toISOString()
        route.status = 'source-submitted'
        route.updatedAt = route.submittedAt
        return clone(route)
    }

    async updateProviderStatus(routeId: string, update: ProviderStatusUpdate) {
        const route = this.routes.get(routeId)
        if (!route) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        Object.assign(route, update, { updatedAt: new Date().toISOString() })
        return clone(route)
    }

    private requireOwned(routeId: string, ownerAddress: string) {
        const route = this.routes.get(routeId)
        if (!route) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        if (route.ownerAddress !== ownerAddress) {
            throw routeError('ROUTE_OWNER_MISMATCH', 'Route belongs to another owner.')
        }
        return route
    }

    private expire(route: PublicCrossChainRoute) {
        if (Date.parse(route.expiresAt) <= Date.now() && !terminal(route.status)) {
            route.status = 'expired'
            route.failureCode = 'QUOTE_EXPIRED'
            route.updatedAt = new Date().toISOString()
        }
    }
}

class PostgresCrossChainRouteRepository implements CrossChainRouteRepository {
    async create(quote: CrossChainQuote) {
        const db = getDatabase()
        return db.transaction(async (tx) => {
            const [row] = await tx.insert(crossChainRoutes).values({
                quoteId: quote.quoteId,
                ownerAddress: quote.request.ownerAddress,
                providerId: quote.provider,
                executionModel: quote.executionModel,
                sourceAsset: quote.request.sourceAsset,
                destinationAsset: quote.request.destinationAsset,
                recipient: quote.request.recipient,
                inputAmount: quote.request.amount,
                outputAmount: quote.buyAmount,
                minimumOutputAmount: quote.minimumBuyAmount,
                durationSeconds: quote.estimatedDurationSeconds ?? 0,
                providerTrackingId: quote.statusId,
                expiresAt: new Date(quote.expiresAt),
                publicData: {
                    costs: normalizePublicCosts(quote.costs),
                    feeIncluded: quote.feeIncluded === true,
                    costBreakdownAvailable: quote.costBreakdownAvailable === true,
                },
            }).returning()
            const steps = await tx.insert(crossChainRouteSteps).values(quote.steps.map((step) => ({
                routeId: row.id,
                stepIndex: step.index,
                stepType: step.type,
                label: step.label,
                chainId: step.chainId,
                status: step.status,
                publicData: {},
            }))).returning()
            return rowToPublic(row, steps)
        })
    }

    async get(routeId: string) {
        const db = getDatabase()
        const [row] = await db.select().from(crossChainRoutes)
            .where(eq(crossChainRoutes.id, routeId)).limit(1)
        if (!row) return null
        const steps = await db.select().from(crossChainRouteSteps)
            .where(eq(crossChainRouteSteps.routeId, routeId))
            .orderBy(asc(crossChainRouteSteps.stepIndex))
        const route = rowToPublic(row, steps)
        if (Date.parse(route.expiresAt) <= Date.now() && !terminal(route.status)) {
            const now = new Date()
            await db.update(crossChainRoutes).set({
                status: 'expired',
                failureCode: 'QUOTE_EXPIRED',
                updatedAt: now,
            }).where(eq(crossChainRoutes.id, routeId))
            route.status = 'expired'
            route.failureCode = 'QUOTE_EXPIRED'
            route.updatedAt = now.toISOString()
        }
        return route
    }

    async markPrepared(routeId: string, ownerAddress: string) {
        const db = getDatabase()
        await db.update(crossChainRoutes).set({
            status: 'prepared',
            updatedAt: new Date(),
        }).where(and(
            eq(crossChainRoutes.id, routeId),
            eq(crossChainRoutes.ownerAddress, ownerAddress),
            eq(crossChainRoutes.status, 'quoted'),
        ))
        const route = await this.getOwned(routeId, ownerAddress)
        if (route.status === 'expired') throw routeError('ROUTE_EXPIRED', 'Route has expired.')
        if (!['quoted', 'prepared'].includes(route.status)) {
            throw routeError('ROUTE_NOT_PREPARABLE', 'Route can no longer be prepared.')
        }
        return route
    }

    async claimSubmission(routeId: string, ownerAddress: string) {
        const db = getDatabase()
        const now = new Date()
        const rows = await db.update(crossChainRoutes).set({
            submissionAttempts: 1,
            claimedAt: now,
            status: 'awaiting-source',
            updatedAt: now,
        }).where(and(
            eq(crossChainRoutes.id, routeId),
            eq(crossChainRoutes.ownerAddress, ownerAddress),
            eq(crossChainRoutes.submissionAttempts, 0),
            eq(crossChainRoutes.status, 'prepared'),
            sql`${crossChainRoutes.expiresAt} > now()`,
        )).returning()
        if (!rows[0]) {
            const route = await this.getOwned(routeId, ownerAddress)
            if (route.status === 'expired') throw routeError('ROUTE_EXPIRED', 'Route has expired.')
            if (route.submissionAttempts !== 0) {
                throw routeError('SOURCE_SUBMISSION_ALREADY_CLAIMED', 'Source submission was already claimed.')
            }
            if (route.status !== 'prepared') {
                throw routeError('ROUTE_NOT_PREPARED', 'Route must be prepared before submission.')
            }
            throw routeError('SOURCE_SUBMISSION_UNAVAILABLE', 'Source submission is unavailable.')
        }
        return this.getRequired(routeId)
    }

    async setPreparedProviderReference(
        routeId: string,
        providerTrackingId: string,
        expiresAt: string,
    ) {
        const db = getDatabase()
        await db.update(crossChainRoutes).set({
            providerTrackingId,
            expiresAt: new Date(expiresAt),
            updatedAt: new Date(),
        }).where(eq(crossChainRoutes.id, routeId))
        return this.getRequired(routeId)
    }

    async markSubmitted(routeId: string, ownerAddress: string, transactionHash: string) {
        const db = getDatabase()
        const existing = await this.getOwned(routeId, ownerAddress)
        if (existing.sourceTransactionHash === transactionHash) return existing
        const now = new Date()
        const rows = await db.update(crossChainRoutes).set({
            sourceTransactionHash: transactionHash,
            submittedAt: now,
            status: 'source-submitted',
            updatedAt: now,
        }).where(and(
            eq(crossChainRoutes.id, routeId),
            eq(crossChainRoutes.ownerAddress, ownerAddress),
            eq(crossChainRoutes.submissionAttempts, 1),
            isNull(crossChainRoutes.sourceTransactionHash),
        )).returning()
        if (!rows[0]) {
            throw routeError('SOURCE_SUBMISSION_NOT_CLAIMED', 'Source submission is not claimable.')
        }
        return this.getRequired(routeId)
    }

    async updateProviderStatus(routeId: string, update: ProviderStatusUpdate) {
        const db = getDatabase()
        await db.update(crossChainRoutes).set({
            ...update,
            updatedAt: new Date(),
        }).where(eq(crossChainRoutes.id, routeId))
        return this.getRequired(routeId)
    }

    private async getOwned(routeId: string, ownerAddress: string) {
        const route = await this.getRequired(routeId)
        if (route.ownerAddress !== ownerAddress) {
            throw routeError('ROUTE_OWNER_MISMATCH', 'Route belongs to another owner.')
        }
        return route
    }

    private async getRequired(routeId: string) {
        const route = await this.get(routeId)
        if (!route) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
        return route
    }
}

export function createCrossChainRouteRepository(): CrossChainRouteRepository {
    return process.env.DATABASE_URL?.trim()
        ? new PostgresCrossChainRouteRepository()
        : new MemoryCrossChainRouteRepository()
}

function toPublicRoute(quote: CrossChainQuote, routeId: string, now: string): PublicCrossChainRoute {
    return {
        routeId,
        publicRouteId: routeId,
        quoteId: quote.quoteId,
        ownerAddress: quote.request.ownerAddress,
        provider: quote.provider,
        executionModel: quote.executionModel,
        sourceAsset: quote.request.sourceAsset,
        destinationAsset: quote.request.destinationAsset,
        recipient: quote.request.recipient,
        inputAmount: quote.request.amount,
        outputAmount: quote.buyAmount,
        minimumOutputAmount: quote.minimumBuyAmount,
        feeAmountUsd: null,
        costs: normalizePublicCosts(quote.costs),
        feeIncluded: quote.feeIncluded === true,
        costBreakdownAvailable: quote.costBreakdownAvailable === true,
        durationSeconds: quote.estimatedDurationSeconds ?? 0,
        status: 'quoted',
        providerStatus: null,
        providerTrackingId: quote.statusId,
        sourceTransactionHash: null,
        destinationTransactionHash: null,
        failureCode: null,
        submissionAttempts: 0,
        claimedAt: null,
        submittedAt: null,
        expiresAt: quote.expiresAt,
        createdAt: now,
        updatedAt: now,
        steps: quote.steps.map(publicStep),
    }
}

function publicStep(step: CrossChainStep): CrossChainStep {
    return { ...step, transaction: null }
}

function rowToPublic(
    row: typeof crossChainRoutes.$inferSelect,
    steps: Array<typeof crossChainRouteSteps.$inferSelect>,
): PublicCrossChainRoute {
    const publicData = row.publicData && typeof row.publicData === 'object' && !Array.isArray(row.publicData)
        ? row.publicData as Record<string, unknown>
        : {}
    return {
        routeId: row.id,
        publicRouteId: row.id,
        quoteId: row.quoteId,
        ownerAddress: row.ownerAddress,
        provider: row.providerId as PublicCrossChainRoute['provider'],
        executionModel: row.executionModel as PublicCrossChainRoute['executionModel'],
        sourceAsset: row.sourceAsset as PublicCrossChainRoute['sourceAsset'],
        destinationAsset: row.destinationAsset as PublicCrossChainRoute['destinationAsset'],
        recipient: row.recipient,
        inputAmount: row.inputAmount,
        outputAmount: row.outputAmount,
        minimumOutputAmount: row.minimumOutputAmount,
        feeAmountUsd: row.feeAmountUsd,
        costs: normalizePublicCosts(publicData.costs ?? emptyCrossChainCosts()),
        feeIncluded: publicData.feeIncluded === true,
        costBreakdownAvailable: publicData.costBreakdownAvailable === true,
        durationSeconds: row.durationSeconds,
        status: row.status as PublicRouteState,
        providerStatus: row.providerStatus,
        providerTrackingId: row.providerTrackingId,
        sourceTransactionHash: row.sourceTransactionHash,
        destinationTransactionHash: row.destinationTransactionHash,
        failureCode: row.failureCode,
        submissionAttempts: row.submissionAttempts,
        claimedAt: row.claimedAt?.toISOString() ?? null,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        steps: steps.map((step) => ({
            id: step.id,
            index: step.stepIndex,
            type: step.stepType as CrossChainStep['type'],
            label: step.label,
            chainId: step.chainId,
            status: step.status as CrossChainStep['status'],
            transaction: null,
        })),
    }
}

function clone(route: PublicCrossChainRoute): PublicCrossChainRoute {
    return structuredClone(route)
}

function terminal(status: PublicRouteState) {
    return ['completed', 'failed', 'refunded', 'expired'].includes(status)
}

export function routeError(code: string, message: string, statusCode?: number) {
    return Object.assign(new Error(message), {
        code,
        ...(statusCode === undefined ? {} : { statusCode }),
    })
}
