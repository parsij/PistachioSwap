import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { LEGAL_PAGES, legalPagesPlugin, renderLegalMarkdown } from '../build/legal-pages.mjs'

const root = resolve(import.meta.dirname, '../..')

test('legal renderer escapes executable markup and rejects external or protocol-relative links', () => {
    const html = renderLegalMarkdown('# Title\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert) [remote](//example.com) [privacy](/legal/privacy/)')
    assert.ok(!html.includes('<script>'))
    assert.ok(!html.includes('href="javascript:'))
    assert.ok(!html.includes('href="//'))
    assert.ok(html.includes('<a href="/legal/privacy/">privacy</a>'))
})

test('published pages include current documents, pricing limitations, and no internal review placeholders', () => {
    for (const [page, source] of Object.entries(LEGAL_PAGES)) {
        const wrapper = readFileSync(resolve(root, `.${page}`), 'utf8')
        const html = process.env.LEGAL_DIST
            ? readFileSync(resolve(root, process.env.LEGAL_DIST, `.${page}`), 'utf8')
            : legalPagesPlugin(root).transformIndexHtml.handler(wrapper, { path: page })
        assert.ok(html.includes(source === 'TERMS.md' ? '<h1>PistachioSwap Terms of Use</h1>' : '<h1>PistachioSwap Privacy Policy</h1>'))
        assert.doesNotMatch(html, /LEGAL_DOCUMENT|\[(CONFIRM|VERIFY|COMPLETE|COUNSEL|IMPLEMENTATION|PROVIDER)|REVIEW COPY|REVISED_DRAFT_/)
        assert.match(html, /pre-launch/i)
        if (source === 'TERMS.md') {
            assert.match(html, /retains any difference between the agreed charge and actual gas expenses/)
            assert.match(html, /If source execution reverts, the payment in that operation also reverts/)
            assert.match(html, /source success does not establish destination fulfillment/)
            assert.match(html, /mandatory law/)
        } else {
            assert.match(html, /signed UserOperations and EIP-7702 authorizations/i)
            assert.match(html, /Alchemy and thirdweb/)
            assert.match(html, /Do Not Track/)
            assert.match(html, /at least 10 years/)
        }
    }
})

test('public landing and guide footers expose both policies separately from license notices', () => {
    for (const source of ['index.html', 'landing/faq/index.html', 'landing/wallet/index.html', 'landing/how-it-works/index.html', 'landing/gas-assist/index.html', 'gas-assist/index.html']) {
        const html = readFileSync(resolve(root, source), 'utf8')
        assert.match(html, /href="\/legal\/terms\/"/)
        assert.match(html, /href="\/legal\/privacy\/"/)
        assert.match(html, /href="\/legal\/third-party\/"/)
    }
})
