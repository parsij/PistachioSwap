import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { closeDatabase } from '../src/db/client.js'
import {
    type MarketCatalogRefreshOptions,
    marketCatalogService,
} from '../src/modules/market-tokens.js'
import {
    marketCatalogLockManager,
    type MarketCatalogLockManager,
} from '../src/market-catalog/locks.js'
import {
    ACTIVE_TOKEN_DISCOVERY_CHAINS,
    type TokenDiscoveryChain,
} from '../src/token-discovery/registry.js'

export const DEFAULT_MARKET_CATALOG_BOOTSTRAP_CONCURRENCY = 3
export const MARKET_CATALOG_BOOTSTRAP_LOCK_SCOPE = 'market-catalog:bootstrap'

type RefreshCatalog = {
    tokens: unknown[]
    commonTokens?: unknown[]
    partial: boolean
    persistence: {
        nextRefreshAt: number | null
        lastSuccessAt: number | null
    }
}

export type MarketCatalogBootstrapService = {
    hydratePersistentCatalogs?: () => Promise<unknown>
    refreshChain: (
        chainId: number,
        options: MarketCatalogRefreshOptions,
    ) => Promise<RefreshCatalog>
}

type Logger = Pick<typeof console, 'log' | 'error'>

export type MarketCatalogBootstrapOptions = {
    argv?: string[]
    activeChains?: readonly TokenDiscoveryChain[]
    service?: MarketCatalogBootstrapService
    lockManager?: MarketCatalogLockManager
    logger?: Logger
    now?: () => number
    signal?: AbortSignal
}

export type MarketCatalogBootstrapResult = {
    exitCode: 0 | 1
    total: number
    succeeded: number
    failed: number
    interrupted: boolean
    successfulChainIds: number[]
    failedChainIds: number[]
}

type ParsedArgs = {
    chainIds: number[]
    concurrency: number
    dryRun: boolean
}

function parseInteger(value: string) {
    if (!/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}

export function parseMarketCatalogBootstrapArgs(
    argv: readonly string[],
    activeChains: readonly TokenDiscoveryChain[] = ACTIVE_TOKEN_DISCOVERY_CHAINS,
): ParsedArgs {
    const activeIds = new Set(activeChains.map((chain) => chain.chainId))
    let chainIds: number[] | null = null
    let concurrency = DEFAULT_MARKET_CATALOG_BOOTSTRAP_CONCURRENCY
    let dryRun = false

    for (const argument of argv) {
        if (argument === '--') continue
        if (argument === '--dry-run') {
            dryRun = true
            continue
        }
        if (argument.startsWith('--concurrency=')) {
            const parsed = parseInteger(argument.slice('--concurrency='.length))
            if (parsed === null || parsed < 1 || parsed > 5) {
                throw new Error('Invalid --concurrency value. Use an integer from 1 through 5.')
            }
            concurrency = parsed
            continue
        }
        if (argument.startsWith('--chains=')) {
            const raw = argument.slice('--chains='.length)
            if (!raw.trim()) throw new Error('Invalid --chains value. Provide comma-separated chain IDs.')
            const parsed = raw.split(',').map((value) => {
                const chainId = parseInteger(value.trim())
                if (chainId === null) {
                    throw new Error(`Invalid chain ID: ${value}`)
                }
                return chainId
            })
            const unsupported = parsed.filter((chainId) => !activeIds.has(chainId))
            if (unsupported.length > 0) {
                throw new Error(
                    `Unsupported token-discovery chain ID(s): ${[...new Set(unsupported)].join(',')}`,
                )
            }
            chainIds = [...new Set(parsed)]
            continue
        }
        throw new Error(`Unknown argument: ${argument}`)
    }

    return {
        chainIds: chainIds ?? activeChains.map((chain) => chain.chainId),
        concurrency,
        dryRun,
    }
}

function isoOrNull(value: number | null) {
    return value === null ? null : new Date(value).toISOString()
}

function compactError(error: unknown) {
    if (error instanceof Error) return error.message
    return 'Market catalog refresh failed.'
}

async function runBootstrapWorkers({
    chains,
    concurrency,
    service,
    logger,
    signal,
    now,
}: {
    chains: readonly TokenDiscoveryChain[]
    concurrency: number
    service: MarketCatalogBootstrapService
    logger: Logger
    signal?: AbortSignal
    now: () => number
}) {
    const successfulChainIds: number[] = []
    const failedChainIds: number[] = []
    let interrupted = false
    let cursor = 0

    async function runWorker() {
        while (cursor < chains.length) {
            if (signal?.aborted) {
                interrupted = true
                break
            }
            const chain = chains[cursor]!
            cursor += 1
            const startedAt = now()
            logger.log('[market-catalog-bootstrap:chain-start]', {
                chainId: chain.chainId,
                chainName: chain.name,
                startedAt: new Date(startedAt).toISOString(),
            })
            try {
                const catalog = await service.refreshChain(chain.chainId, {
                    force: true,
                    reason: 'manual-bootstrap',
                    signal,
                })
                const finishedAt = now()
                successfulChainIds.push(chain.chainId)
                logger.log('[market-catalog-bootstrap:chain-finish]', {
                    chainId: chain.chainId,
                    chainName: chain.name,
                    startedAt: new Date(startedAt).toISOString(),
                    finishedAt: new Date(finishedAt).toISOString(),
                    durationMs: Math.max(0, finishedAt - startedAt),
                    result: 'succeeded',
                    rankedTokenCount: catalog.tokens.length,
                    commonTokenCount: catalog.commonTokens?.length ?? 0,
                    partial: catalog.partial,
                    persisted: catalog.persistence.lastSuccessAt !== null,
                    nextRefreshAt: isoOrNull(catalog.persistence.nextRefreshAt),
                })
            } catch (error) {
                const finishedAt = now()
                failedChainIds.push(chain.chainId)
                if (signal?.aborted) interrupted = true
                logger.log('[market-catalog-bootstrap:chain-finish]', {
                    chainId: chain.chainId,
                    chainName: chain.name,
                    startedAt: new Date(startedAt).toISOString(),
                    finishedAt: new Date(finishedAt).toISOString(),
                    durationMs: Math.max(0, finishedAt - startedAt),
                    result: signal?.aborted ? 'interrupted' : 'failed',
                    rankedTokenCount: 0,
                    commonTokenCount: 0,
                    partial: true,
                    persisted: false,
                    nextRefreshAt: null,
                    error: compactError(error),
                })
            }
        }
    }

    await Promise.all(Array.from(
        { length: Math.min(concurrency, chains.length) },
        () => runWorker(),
    ))

    return { successfulChainIds, failedChainIds, interrupted }
}

export async function runMarketCatalogBootstrap({
    argv = process.argv.slice(2),
    activeChains = ACTIVE_TOKEN_DISCOVERY_CHAINS,
    service = marketCatalogService,
    lockManager = marketCatalogLockManager,
    logger = console,
    now = Date.now,
    signal,
}: MarketCatalogBootstrapOptions = {}): Promise<MarketCatalogBootstrapResult> {
    const startedAt = now()
    let parsed: ParsedArgs
    try {
        parsed = parseMarketCatalogBootstrapArgs(argv, activeChains)
    } catch (error) {
        logger.error('[market-catalog-bootstrap:error]', compactError(error))
        return {
            exitCode: 1,
            total: 0,
            succeeded: 0,
            failed: 0,
            interrupted: false,
            successfulChainIds: [],
            failedChainIds: [],
        }
    }

    const selected = parsed.chainIds.map((chainId) =>
        activeChains.find((chain) => chain.chainId === chainId)!)
    logger.log('[market-catalog-bootstrap:start]', {
        selectedChainCount: selected.length,
        chainIds: parsed.chainIds,
        concurrency: parsed.concurrency,
        forcedRefresh: true,
        dryRun: parsed.dryRun,
    })

    if (parsed.dryRun) {
        logger.log('[market-catalog-bootstrap:summary]', {
            total: selected.length,
            succeeded: 0,
            failed: 0,
            interrupted: false,
            durationMs: Math.max(0, now() - startedAt),
            successfulChainIds: [],
            failedChainIds: [],
        })
        return {
            exitCode: 0,
            total: selected.length,
            succeeded: 0,
            failed: 0,
            interrupted: false,
            successfulChainIds: [],
            failedChainIds: [],
        }
    }

    const lock = await lockManager.acquire(MARKET_CATALOG_BOOTSTRAP_LOCK_SCOPE)
    if (!lock) {
        logger.error('[market-catalog-bootstrap:error]', 'Another market-catalog bootstrap is already running.')
        return {
            exitCode: 1,
            total: selected.length,
            succeeded: 0,
            failed: selected.length,
            interrupted: false,
            successfulChainIds: [],
            failedChainIds: parsed.chainIds,
        }
    }

    try {
        await service.hydratePersistentCatalogs?.()
        const result = await runBootstrapWorkers({
            chains: selected,
            concurrency: parsed.concurrency,
            service,
            logger,
            signal,
            now,
        })
        const interrupted = result.interrupted || signal?.aborted === true
        const summary = {
            total: selected.length,
            succeeded: result.successfulChainIds.length,
            failed: result.failedChainIds.length,
            interrupted,
            durationMs: Math.max(0, now() - startedAt),
            successfulChainIds: result.successfulChainIds,
            failedChainIds: result.failedChainIds,
        }
        logger.log('[market-catalog-bootstrap:summary]', summary)
        return {
            exitCode: summary.failed > 0 || interrupted ? 1 : 0,
            total: summary.total,
            succeeded: summary.succeeded,
            failed: summary.failed,
            interrupted,
            successfulChainIds: summary.successfulChainIds,
            failedChainIds: summary.failedChainIds,
        }
    } finally {
        await lock.release()
    }
}

async function main() {
    const controller = new AbortController()
    const handleSignal = () => controller.abort()
    process.once('SIGINT', handleSignal)
    process.once('SIGTERM', handleSignal)
    try {
        const result = await runMarketCatalogBootstrap({ signal: controller.signal })
        process.exitCode = result.exitCode
    } finally {
        process.off('SIGINT', handleSignal)
        process.off('SIGTERM', handleSignal)
        await closeDatabase().catch(() => undefined)
    }
}

const isMain = process.argv[1]
    ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false

if (isMain) {
    void main().catch((error) => {
        console.error('[market-catalog-bootstrap:error]', compactError(error))
        process.exitCode = 1
    })
}
