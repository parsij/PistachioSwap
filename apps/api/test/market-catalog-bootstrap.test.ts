import { describe, expect, it, vi } from 'vitest'

import {
    DEFAULT_MARKET_CATALOG_BOOTSTRAP_CONCURRENCY,
    MARKET_CATALOG_BOOTSTRAP_LOCK_SCOPE,
    parseMarketCatalogBootstrapArgs,
    runMarketCatalogBootstrap,
    type MarketCatalogBootstrapService,
} from '../scripts/bootstrap-market-catalog.js'
import type { MarketCatalogLockManager } from '../src/market-catalog/locks.js'
import { ACTIVE_TOKEN_DISCOVERY_CHAINS } from '../src/token-discovery/registry.js'

const chains = ACTIVE_TOKEN_DISCOVERY_CHAINS.slice(0, 6)

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function catalog(chainId: number) {
    return {
        tokens: [{ chainId }],
        commonTokens: [{ chainId, common: true }],
        partial: false,
        persistence: {
            nextRefreshAt: Date.parse('2026-07-22T12:03:00.000Z'),
            lastSuccessAt: Date.parse('2026-07-22T12:00:00.000Z'),
        },
    }
}

function logger() {
    return {
        log: vi.fn(),
        error: vi.fn(),
    }
}

function lockManager({ acquire = true } = {}) {
    const releases: string[] = []
    const manager: MarketCatalogLockManager = {
        acquire: vi.fn(async (scope: string) => acquire
            ? { release: vi.fn(async () => { releases.push(scope) }) }
            : null),
    }
    return { manager, releases }
}

async function flush() {
    await Promise.resolve()
    await Promise.resolve()
}

describe('market catalog bootstrap command', () => {
    it('parses defaults and validates concurrency range', () => {
        expect(parseMarketCatalogBootstrapArgs([], chains)).toMatchObject({
            concurrency: DEFAULT_MARKET_CATALOG_BOOTSTRAP_CONCURRENCY,
            dryRun: false,
            chainIds: chains.map((chain) => chain.chainId),
        })
        expect(parseMarketCatalogBootstrapArgs(['--', '--dry-run'], chains).dryRun)
            .toBe(true)
        expect(() => parseMarketCatalogBootstrapArgs(['--concurrency=0'], chains))
            .toThrow(/concurrency/)
        expect(() => parseMarketCatalogBootstrapArgs(['--concurrency=6'], chains))
            .toThrow(/concurrency/)
    })

    it('deduplicates requested chain IDs and rejects unsupported chains before provider requests', async () => {
        const first = chains[0].chainId
        const second = chains[1].chainId
        expect(parseMarketCatalogBootstrapArgs([
            `--chains=${first},${second},${first}`,
        ], chains).chainIds).toEqual([first, second])

        const service = { refreshChain: vi.fn() }
        const lock = lockManager()
        const result = await runMarketCatalogBootstrap({
            argv: ['--chains=999999'],
            activeChains: chains,
            service,
            lockManager: lock.manager,
            logger: logger(),
        })
        expect(result.exitCode).toBe(1)
        expect(service.refreshChain).not.toHaveBeenCalled()
        expect(lock.manager.acquire).not.toHaveBeenCalled()
    })

    it('dry-run validates and prints selected chains without locks, requests, or writes', async () => {
        const service = {
            hydratePersistentCatalogs: vi.fn(),
            refreshChain: vi.fn(),
        }
        const lock = lockManager()
        const output = logger()
        const result = await runMarketCatalogBootstrap({
            argv: ['--dry-run', `--chains=${chains[0].chainId},${chains[1].chainId}`],
            activeChains: chains,
            service,
            lockManager: lock.manager,
            logger: output,
        })

        expect(result.exitCode).toBe(0)
        expect(service.hydratePersistentCatalogs).not.toHaveBeenCalled()
        expect(service.refreshChain).not.toHaveBeenCalled()
        expect(lock.manager.acquire).not.toHaveBeenCalled()
        expect(output.log).toHaveBeenCalledWith('[market-catalog-bootstrap:start]', expect.objectContaining({
            selectedChainCount: 2,
            concurrency: 3,
            forcedRefresh: true,
            dryRun: true,
        }))
    })

    it('with default concurrency starts the first three chains immediately and no fourth until one finishes', async () => {
        const pending = chains.map(() => deferred<ReturnType<typeof catalog>>())
        const started: number[] = []
        const service: MarketCatalogBootstrapService = {
            refreshChain: vi.fn((chainId: number) => {
                const index = chains.findIndex((chain) => chain.chainId === chainId)
                started.push(chainId)
                return pending[index].promise
            }),
        }
        const run = runMarketCatalogBootstrap({
            argv: [],
            activeChains: chains,
            service,
            lockManager: lockManager().manager,
            logger: logger(),
        })

        await flush()
        expect(started).toEqual(chains.slice(0, 3).map((chain) => chain.chainId))
        pending[0].resolve(catalog(chains[0].chainId))
        await flush()
        expect(started).toEqual(chains.slice(0, 4).map((chain) => chain.chainId))
        for (let index = 1; index < pending.length; index += 1) {
            pending[index].resolve(catalog(chains[index].chainId))
        }
        await expect(run).resolves.toMatchObject({ exitCode: 0, succeeded: chains.length })
    })

    it('never exceeds configured active refresh concurrency', async () => {
        for (const concurrency of [1, 3, 5]) {
            let active = 0
            let maximumActive = 0
            const order: number[] = []
            const service: MarketCatalogBootstrapService = {
                refreshChain: vi.fn(async (chainId: number) => {
                    active += 1
                    maximumActive = Math.max(maximumActive, active)
                    order.push(chainId)
                    await Promise.resolve()
                    active -= 1
                    return catalog(chainId)
                }),
            }

            const result = await runMarketCatalogBootstrap({
                argv: [`--concurrency=${concurrency}`],
                activeChains: chains,
                service,
                lockManager: lockManager().manager,
                logger: logger(),
            })

            expect(result.exitCode).toBe(0)
            expect(maximumActive).toBeLessThanOrEqual(concurrency)
            expect(order).toEqual(chains.map((chain) => chain.chainId))
        }
    })

    it('uses force manual-bootstrap options and attempts every selected chain exactly once', async () => {
        const service: MarketCatalogBootstrapService = {
            refreshChain: vi.fn(async (chainId) => catalog(chainId)),
        }
        const result = await runMarketCatalogBootstrap({
            argv: [`--chains=${chains[0].chainId},${chains[1].chainId},${chains[0].chainId}`],
            activeChains: chains,
            service,
            lockManager: lockManager().manager,
            logger: logger(),
        })

        expect(result.exitCode).toBe(0)
        expect(service.refreshChain).toHaveBeenCalledTimes(2)
        expect(service.refreshChain).toHaveBeenNthCalledWith(
            1,
            chains[0].chainId,
            expect.objectContaining({ force: true, reason: 'manual-bootstrap' }),
        )
    })

    it('persists successful catalogs immediately as each chain finishes', async () => {
        const first = deferred<ReturnType<typeof catalog>>()
        const second = deferred<ReturnType<typeof catalog>>()
        const finishedLogs: number[] = []
        const output = logger()
        output.log.mockImplementation((event, payload) => {
            if (event === '[market-catalog-bootstrap:chain-finish]' &&
                payload.result === 'succeeded') {
                finishedLogs.push(payload.chainId)
            }
        })
        const service: MarketCatalogBootstrapService = {
            refreshChain: vi.fn((chainId) =>
                chainId === chains[0].chainId ? first.promise : second.promise),
        }
        const run = runMarketCatalogBootstrap({
            argv: [`--chains=${chains[0].chainId},${chains[1].chainId}`, '--concurrency=2'],
            activeChains: chains,
            service,
            lockManager: lockManager().manager,
            logger: output,
        })
        await flush()
        first.resolve(catalog(chains[0].chainId))
        await flush()
        expect(finishedLogs).toEqual([chains[0].chainId])
        second.resolve(catalog(chains[1].chainId))
        await expect(run).resolves.toMatchObject({ exitCode: 0 })
    })

    it('continues after one chain fails and reports non-zero without clearing old snapshots', async () => {
        const oldSnapshot = new Map([[chains[0].chainId, 'old']])
        const service: MarketCatalogBootstrapService = {
            refreshChain: vi.fn(async (chainId) => {
                if (chainId === chains[0].chainId) throw new Error('provider failed')
                oldSnapshot.set(chainId, 'new')
                return catalog(chainId)
            }),
        }
        const result = await runMarketCatalogBootstrap({
            argv: [`--chains=${chains[0].chainId},${chains[1].chainId},${chains[2].chainId}`],
            activeChains: chains,
            service,
            lockManager: lockManager().manager,
            logger: logger(),
        })

        expect(result).toMatchObject({
            exitCode: 1,
            succeeded: 2,
            failed: 1,
            failedChainIds: [chains[0].chainId],
        })
        expect(oldSnapshot.get(chains[0].chainId)).toBe('old')
    })

    it('rejects simultaneous bootstrap execution cleanly', async () => {
        const lock = lockManager({ acquire: false })
        const service = { refreshChain: vi.fn() }
        const result = await runMarketCatalogBootstrap({
            argv: [`--chains=${chains[0].chainId}`],
            activeChains: chains,
            service,
            lockManager: lock.manager,
            logger: logger(),
        })

        expect(result.exitCode).toBe(1)
        expect(lock.manager.acquire).toHaveBeenCalledWith(MARKET_CATALOG_BOOTSTRAP_LOCK_SCOPE)
        expect(service.refreshChain).not.toHaveBeenCalled()
    })

    it('SIGINT-style abort stops new scheduling and releases locks', async () => {
        const controller = new AbortController()
        const releases: string[] = []
        const manager: MarketCatalogLockManager = {
            acquire: vi.fn(async (scope) => ({
                release: vi.fn(async () => { releases.push(scope) }),
            })),
        }
        const service: MarketCatalogBootstrapService = {
            refreshChain: vi.fn(async (chainId) => {
                controller.abort()
                throw new DOMException(`aborted ${chainId}`, 'AbortError')
            }),
        }
        const result = await runMarketCatalogBootstrap({
            argv: ['--concurrency=1'],
            activeChains: chains,
            service,
            lockManager: manager,
            logger: logger(),
            signal: controller.signal,
        })

        expect(result).toMatchObject({
            exitCode: 1,
            interrupted: true,
            failed: 1,
        })
        expect(service.refreshChain).toHaveBeenCalledTimes(1)
        expect(releases).toEqual([MARKET_CATALOG_BOOTSTRAP_LOCK_SCOPE])
    })
})
