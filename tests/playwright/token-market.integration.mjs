import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

// Build first with VITE_REOWN_PROJECT_ID=00000000000000000000000000000000 pnpm build.
// This test-only project ID and all market fixtures are intercepted; no provider is contacted.
// Run: node tests/playwright/token-market.integration.mjs (requires installed Playwright Chromium).
// Serve the production bundle through Playwright interception. No local server or wallet needed.
const origin = 'https://market-ui-test.pistachioswap.com'
const dist = resolve('dist')
const output = resolve(process.env.PISTACHIO_SCREENSHOT_DIR || '/tmp/pistachio-market-screenshots')
await mkdir(output, { recursive: true })
const token = {
    chainId: 56, address: '0x1111111111111111111111111111111111111111', name: 'Zcash', symbol: 'ZEC', decimals: 18,
    source: 'shapeshift-local', verificationStatus: 'established', recognitionStatus: 'established',
    verificationReasons: ['curated-official-contract'], classificationTier: 'established', securityStatus: 'trusted',
    possibleSpam: false, visibility: 'primary', priceConfidence: 'trusted', priceUSD: '38.42',
    volume24hUsd: null, liquidityUsd: null, priceChange24hPercent: 2.5,
}
const native = { ...token, address: '0x0000000000000000000000000000000000000000', name: 'BNB', symbol: 'BNB', isNative: true, priceUSD: '600' }
const other = { ...token, address: '0x2222222222222222222222222222222222222222', name: 'USD Coin', symbol: 'USDC', priceUSD: '1' }
const baseToken = { ...other, chainId: 8453, name: 'Base USD Coin', symbol: 'BUSDC' }
const fixtures = [native, token, other, baseToken, ...Array.from({ length: 22 }, (_, i) => ({ ...token,
    address: `0x${(i + 100).toString(16).padStart(40, '0')}`, name: `Catalog Token ${i + 1}`, symbol: `CT${i + 1}`, priceUSD: null,
}))]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
let browser
let marketCount = 0
let unavailable = false
const errors = []
try {
    const extra = process.env.PISTACHIO_CHROMIUM_MODULE ? (await import(process.env.PISTACHIO_CHROMIUM_MODULE)).default : null
    browser = await chromium.launch({ headless: true, ...(extra ? { executablePath: await extra.executablePath(), args: extra.args } : {}) })
    async function context(options = {}) {
        const context = await browser.newContext({ locale: 'en-US', ...options })
        await context.route('**/*', async (route) => {
            const url = new URL(route.request().url())
            if (url.pathname.includes('/v1/token-details/market')) {
                marketCount += 1
                if (unavailable) return route.fulfill({ status: 503, json: { error: { message: 'Market data unavailable' } } })
                const period = url.searchParams.get('period')
                const end = Date.UTC(2026, 9, 3, 18)
                return route.fulfill({ json: {
                    schemaVersion: 1, chainId: Number(url.searchParams.get('chainId')), address: url.searchParams.get('address'),
                    name: 'Zcash', symbol: 'ZEC', currentPriceUsd: 38.42, periodChangePercent: 2.5, periodChangeUsd: 0.94, change24hPercent: 2.5,
                    about: 'Test-only provider description.', coinGeckoUrl: 'https://www.coingecko.com/en/coins/zcash', websites: ['https://example.org/'], chart: { period, historyLimitDays: period === 'ALL' ? 365 : null, candles: Array.from({length:30}, (_,i) => ({timestamp:end-(29-i)*120000, open:37+i*.02, high:37.1+i*.02, low:36.9+i*.02, close:37.05+i*.02})), points: Array.from({ length: 60 }, (_, i) => ({ timestamp: end - (59 - i) * 60_000,
                        priceUsd: 37 + i * .02 + Math.sin(i / 4) * .3, volumeUsd: 1_000_000 + i * 5000 })) },
                    stats: { tvlUsd: null, marketCapUsd: 630_000_000, fdvUsd: 800_000_000, volume24hUsd: 70_000_000, high52wUsd: 80, low52wUsd: 18 },
                } })
            }
            if (url.pathname.includes('/v1/token-catalog') || url.pathname.includes('/v1/market-tokens')) {
                const query = (url.searchParams.get('search') || url.searchParams.get('q') || '').toLowerCase()
                const scope = url.searchParams.get('chainId'); const tokens = fixtures.filter((item) => (!scope || scope === 'all' || String(item.chainId) === scope) && (!query || `${item.name} ${item.symbol}`.toLowerCase().includes(query)))
                return route.fulfill({ json: { schemaVersion: 1, chainId: url.searchParams.get('chainId') || 'all', generatedAt: new Date().toISOString(),
                    tokens, commonTokens: [], fallbackTokens: [], nextCursor: null, hasMore: false, diagnostics: { totalForChain: tokens.length } } })
            }
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
            if (url.origin === origin) {
                const path = url.pathname === '/swap/' ? '/swap/index.html' : url.pathname
                const file = resolve(dist, '.' + path)
                if (!file.startsWith(dist + '/')) return route.abort()
                try { return await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] || 'application/octet-stream' }) }
                catch { return route.fulfill({ status: 404, body: '' }) }
            }
            return route.fulfill({ json: {} })
        })
        return context
    }
    const desktop = await context({ viewport: { width: 1440, height: 900 } })
    const page = await desktop.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin + '/swap/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Search tokens', exact: true }).click()
    await page.getByText('Zcash', { exact: true }).waitFor()
    await page.screenshot({ path: resolve(output, 'desktop-search.png') })
    await page.getByRole('textbox', { name: 'Search tokens and wallets' }).fill('zec')
    const row = page.locator('.global-search-result-row').filter({ hasText: 'Zcash' }).first()
    await row.waitFor()
    await page.screenshot({ path: resolve(output, 'desktop-query.png') })
    const before = marketCount
    await row.hover()
    await page.waitForTimeout(150)
    assert.equal(marketCount, before, 'hover must wait for intent')
    await page.locator('.token-hover-card').waitFor()
    await page.locator('.token-hover-card-price').waitFor()
    await page.getByRole('button', { name: 'Copy token address', exact: true }).hover()
    await page.getByRole('tooltip', { name: 'Copy token address' }).waitFor()
    await page.screenshot({ path: resolve(output, 'desktop-hover.png') })
    await page.getByRole('button', { name: 'Open token details' }).hover()
    await page.waitForTimeout(250)
    assert.equal(await page.locator('.token-hover-card').count(), 1, 'pointer can enter card')
    await page.getByRole('button', { name: 'Open token details' }).click()
    await page.locator('.token-details-page').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('view'), 'token')
    await page.getByText('Stats', { exact: true }).waitFor()
    await page.waitForTimeout(250)
    await page.screenshot({ path: resolve(output, 'desktop-details.png'), fullPage: true })
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await page.getByText('Available history · up to 365 days').waitFor()
    await page.getByRole('button', { name: 'Candlestick chart', exact: true }).click()
    await page.getByLabel('Token candlestick chart', { exact: true }).waitFor()
    await page.locator('.token-market-chart').hover({ position: { x: 200, y: 200 } })
    await page.locator('.token-details-price-copy time').waitFor()
    await page.screenshot({ path: resolve(output, 'desktop-candles.png'), fullPage: true })
    await page.getByRole('button', { name: 'TVL', exact: true }).click()
    await page.getByText('TVL history unavailable').waitFor()
    await page.getByRole('button', { name: 'Price', exact: true }).click()
    await page.getByRole('button', { name: 'Line chart', exact: true }).click()
    await page.getByRole('button', { name: '1W', exact: true }).click()
    await page.waitForTimeout(200)
    assert.equal(await page.getByRole('button', { name: '1W', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Volume', exact: true }).click()
    await page.getByText('Reported 24-hour volume', { exact: true }).waitFor()
    await page.locator('.token-market-chart').hover({ position: { x: 250, y: 180 } })
    await page.locator('.token-details-price-copy time').waitFor()
    await page.screenshot({ path: resolve(output, 'desktop-volume.png') })
    await page.setViewportSize({ width: 1100, height: 900 })
    const rail = await page.locator('.token-details-swap').boundingBox()
    const chart = await page.locator('.token-details-left').boundingBox()
    assert.ok(rail.x > chart.x + chart.width, 'swap stays on the right at laptop widths')
    assert.ok(rail.width >= 440, 'swap rail matches main swap width')
    await page.screenshot({ path: resolve(output, 'laptop-details.png'), fullPage: true })
    await page.getByRole('button', { name: 'Search tokens', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search tokens and wallets' }).fill('busdc')
    await page.locator('.global-search-result-row').filter({hasText:'Base USD Coin'}).click()
    await page.locator('.token-details-right').getByRole('button', { name: /ETH/ }).first().waitFor()
    assert.equal(new URL(page.url()).searchParams.get('chain'), '8453')
    await page.screenshot({ path: resolve(output, 'base-native-pair.png'), fullPage: true })

    const mobile = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    const phone = await mobile.newPage()
    phone.on('pageerror', (error) => errors.push(error.message))
    await phone.goto(origin + '/swap/', { waitUntil: 'networkidle' })
    await phone.getByRole('button', { name: 'Search tokens', exact: true }).click()
    await phone.getByRole('tab', { name: 'Tokens', exact: true }).click()
    await phone.getByText('Zcash', { exact: true }).waitFor()
    await phone.screenshot({ path: resolve(output, 'mobile-search.png') })
    const beforeMobile = marketCount
    await phone.locator('.global-search-result-row').filter({ hasText: 'Zcash' }).first().dispatchEvent('pointerover', { pointerType: 'touch' })
    await phone.waitForTimeout(400)
    assert.equal(marketCount, beforeMobile, 'touch must not fetch a hover preview')
    await phone.locator('.global-search-scroll').evaluate((node) => { node.scrollTop = 600 })
    assert.ok(await phone.locator('.global-search-scroll').evaluate((node) => node.scrollTop) > 0)
    await phone.screenshot({ path: resolve(output, 'mobile-scroll.png') })
    await phone.getByRole('textbox', { name: 'Search tokens and wallets' }).fill('zec')
    await phone.locator('.global-search-result-row').filter({ hasText: 'Zcash' }).first().click()
    await phone.getByText('Stats', { exact: true }).waitFor()
    await phone.waitForTimeout(250)
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal mobile overflow')
    await phone.screenshot({ path: resolve(output, 'mobile-details.png'), fullPage: true })
    unavailable = true
    await phone.getByRole('button', { name: '1M', exact: true }).click()
    await phone.getByText('Market data could not be refreshed.', { exact: true }).waitFor()
    await phone.screenshot({ path: resolve(output, 'mobile-unavailable.png'), fullPage: true })
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    console.log(JSON.stringify({ screenshots: output, requests: marketCount, browserErrors: errors, result: 'passed' }))
} finally { await browser?.close() }
