import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { getComplianceService } from '../src/compliance/service.js'
import { marketCatalogService } from '../src/modules/market-tokens.js'
import { dexScreenerWalletPriceCache } from '../src/providers/dexscreener/wallet-price-cache.js'

vi.mock('../src/modules/uniswap-volume-tokens.js', async (original) => ({
    ...await original<typeof import('../src/modules/uniswap-volume-tokens.js')>(),
    loadPersistedUniswapVolumeCatalog: vi.fn(async () => null),
    getUniswapVolumeCatalog: vi.fn(async () => null),
}))
vi.mock('../src/token-discovery/shapeshift-asset-catalog.js', async (original) => ({
    ...await original<typeof import('../src/token-discovery/shapeshift-asset-catalog.js')>(),
    loadShapeShiftAssetCatalog: vi.fn(async () => ({ source: 'unavailable', catalog: null })),
}))

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

it('serves health while initial OFAC download is pending and handles refresh failure', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('COMPLIANCE_ENABLED', 'true')
    vi.stubEnv('COMPLIANCE_TEST_ENABLED', 'true')
    vi.stubEnv('ALCHEMY_PORTFOLIO_ENABLED', 'false')
    const service = getComplianceService()
    let rejectRefresh!: (error: Error) => void
    const refresh = vi.spyOn(service, 'refreshOfacSnapshot').mockReturnValue(
        new Promise((_, reject) => { rejectRefresh = reject }),
    )
    vi.spyOn(marketCatalogService, 'hydratePersistentCatalogs').mockResolvedValue({ loaded: 0, ignored: 0, degraded: false })
    vi.spyOn(marketCatalogService, 'startRollingRefresh').mockReturnValue(() => {})
    vi.spyOn(dexScreenerWalletPriceCache, 'hydrate').mockResolvedValue({ loaded: 0, ignored: 0 })
    vi.spyOn(dexScreenerWalletPriceCache, 'flush').mockResolvedValue(undefined)
    const app = createApp()
    const errorLog = vi.spyOn(app.log, 'error')
    const boot = app.ready()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            boot,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Startup waited for OFAC download')), 1_000)
            }),
        ])
        expect(refresh).toHaveBeenCalledOnce()
        expect((await app.inject('/health')).statusCode).toBe(200)
        rejectRefresh(new Error('OFAC download unavailable'))
        await Promise.resolve()
        expect(errorLog).toHaveBeenCalledWith(
            expect.objectContaining({ subsystem: 'compliance' }),
            expect.stringContaining('transaction screening will fail closed'),
        )
    } finally {
        clearTimeout(timer)
        rejectRefresh(new Error('Test cleanup'))
        await boot.catch(() => undefined)
        await app.close()
    }
})
