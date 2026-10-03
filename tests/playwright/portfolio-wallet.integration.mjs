import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

// Build the actual UI components into an isolated fixture and intercept the bundle.
// No persistent server, connected provider, wallet secrets, or production data.
const dist = resolve('/tmp/pistachio-portfolio-wallet-fixture')
const output = resolve(process.env.PISTACHIO_SCREENSHOT_DIR || '/tmp/pistachio-portfolio-wallet-screenshots')
await mkdir(output, { recursive: true })
await build({
    configFile: false, plugins: [react(), tailwindcss()],
    resolve: { alias: { '#wallet-runtime': resolve('src/web3/walletRuntime.js') } },
    build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: resolve('tests/playwright/fixtures/portfolio-wallet.html') } },
})
const extra = process.env.PISTACHIO_CHROMIUM_MODULE ? (await import(process.env.PISTACHIO_CHROMIUM_MODULE)).default : null
const browser = await chromium.launch({ headless: true, ...(extra ? { executablePath: await extra.executablePath(), args: extra.args.filter(arg => arg !== '--single-process') } : {}) })
const errors = []
const origin = 'https://portfolio-test.pistachioswap.com'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
try {
    for (const width of [1440, 1100, 900, 390]) {
        const mobile = width === 390
        const context = await browser.newContext({ locale: 'en-US', viewport: { width, height: 900 }, hasTouch: mobile, isMobile: mobile })
        await context.route('**/*', async route => {
            const url = new URL(route.request().url())
            if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
            const file = resolve(dist, '.' + (url.pathname === '/swap/' ? '/tests/playwright/fixtures/portfolio-wallet.html' : url.pathname))
            if (!file.startsWith(dist + '/')) return route.abort()
            try { await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] || 'application/octet-stream' }) }
            catch { await route.fulfill({ status: 404, body: '' }) }
        })
        const page = await context.newPage()
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(origin + '/swap/?view=portfolio', { waitUntil: 'networkidle' })
        const chart = await page.locator('.uni-portfolio-chart-canvas').boundingBox()
        const column = await page.locator('.uni-portfolio-chart-column').boundingBox()
        const rail = await page.locator('.uni-portfolio-right-rail').boundingBox()
        assert.ok(chart.width > column.width - 2, 'chart fills its column even when stacked')
        if (width > 960) {
            assert.ok(chart.width >= 650, 'desktop chart has room for the portfolio history')
            assert.ok(rail.x >= column.x + column.width, 'desktop actions and performance stay beside chart')
        } else {
            assert.ok(rail.y >= column.y + column.height, 'smaller layouts stack below full-width chart')
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow')
        await page.getByRole('button', { name: '1D', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: '1D', exact: true }).getAttribute('aria-pressed'), 'true')
        await page.getByText('Current value shown. History builds while you use this browser.').waitFor()
        await page.screenshot({ path: resolve(output, `portfolio-${width}.png`), fullPage: true })
        const trigger = page.getByRole('button', { name: 'All networks', exact: true })
        const networkIcon = await trigger.locator('.ps-chain-icon-all').boundingBox()
        assert.ok(networkIcon && networkIcon.width > 0, 'network icon remains visible on mobile')
        await trigger.click()
        const option = page.getByRole('option', { name: 'All networks', exact: true })
        assert.equal(await trigger.locator('.ps-chain-icon-all svg').evaluate(el => el.outerHTML), await option.locator('.ps-chain-icon-all svg').evaluate(el => el.outerHTML))
        await page.screenshot({ path: resolve(output, `networks-${width}.png`) })
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('listbox').count(), 0)
        await page.getByRole('button', { name: /Open account/ }).click()
        const dialog = page.getByRole('dialog', { name: 'Wallet', exact: true })
        await dialog.waitFor()
        await page.waitForTimeout(250)
        const geometry = await dialog.boundingBox()
        assert.ok(geometry.y >= 0 && geometry.y < 900 && geometry.height > 100, 'account popup is inside viewport')
        assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= width + 1, 'account popup fits width')
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).opacity), '1')
        assert.notEqual(await dialog.evaluate(el => getComputedStyle(el).getPropertyValue('--size-header-height')), '')
        await page.screenshot({ path: resolve(output, `wallet-${width}.png`) })
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await page.getByRole('button', { name: /Open account/ }).evaluate(el => el === document.activeElement), true)
        await context.close()
    }
    assert.deepEqual(errors, [])
    console.log('Portfolio sizing, network icon, periods, and wallet open/close passed at 1440, 1100, 900, and 390px.')
} finally { await browser.close() }
