// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import React from 'react'
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TokenSelector from './TokenSelector.jsx'
import { clearTokenLogoCacheForTest } from './tokenLogoCache.js'

const native = {
    classificationVersion: 5,
    id: '56:0x0000000000000000000000000000000000000000',
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    isNative: true,
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
    rawBalance: '2074720000000000000',
    balance: '2.07472',
    priceUSD: '54.463',
    valueUSD: '113',
    recognitionStatus: 'established',
    recognitionReasons: ['native-token'],
    spamStatus: 'clean',
    possibleSpam: false,
    verifiedContract: null,
    securityStatus: 'trusted',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
    logoURI: '/icons/bnb.svg',
}

const hidden = {
    classificationVersion: 5,
    id: '56:0x0000000000000000000000000000000000000099',
    chainId: 56,
    address: '0x0000000000000000000000000000000000000099',
    isNative: false,
    name: 'claim-reward.example.com',
    symbol: 'BONUS',
    decimals: 18,
    rawBalance: '1000000000000000000',
    balance: '1',
    priceUSD: null,
    valueUSD: null,
    recognitionStatus: 'unverified',
    spamStatus: 'possible-spam',
    possibleSpam: true,
    verifiedContract: false,
    securityStatus: 'unknown',
    priceConfidence: 'unknown',
    visibility: 'hidden',
    spamReasons: ['moralis-possible-spam'],
    visibilityReasons: ['moralis-possible-spam'],
}

const honeypot = {
    ...hidden,
    id: '56:0x0000000000000000000000000000000000000077',
    address: '0x0000000000000000000000000000000000000077',
    name: 'Dangerous contract',
    symbol: 'TRAP',
    spamStatus: 'unknown',
    possibleSpam: null,
    securityStatus: 'blocked',
    securityReasons: ['honeypot-confirmed'],
    visibilityReasons: ['security-blocked'],
}

const blocklisted = {
    ...hidden,
    id: '56:0x0000000000000000000000000000000000000066',
    address: '0x0000000000000000000000000000000000000066',
    name: 'Blocked contract',
    symbol: 'BLOCK',
    spamStatus: 'unknown',
    possibleSpam: null,
    securityStatus: 'blocked',
    securityReasons: ['manual-blocklist'],
    visibilityReasons: ['manual-blocklist'],
}

const unverified = {
    ...hidden,
    id: '56:0x0000000000000000000000000000000000000088',
    address: '0x0000000000000000000000000000000000000088',
    name: 'New unverified token',
    symbol: 'NEW',
    spamStatus: 'clean',
    possibleSpam: false,
    visibility: 'unverified',
}

const recognizedCaution = {
    ...hidden,
    id: '56:0x0000000000000000000000000000000000000055',
    address: '0x0000000000000000000000000000000000000055',
    name: 'Issuer-controlled asset',
    symbol: 'ISSUER',
    recognitionStatus: 'recognized',
    spamStatus: 'clean',
    possibleSpam: false,
    verifiedContract: true,
    securityStatus: 'caution',
    securityReasons: ['transfer-control-capability', 'transfer-pausable'],
    visibility: 'primary',
    visibilityReasons: ['moralis-verified-contract'],
}

function renderSelector(overrides = {}) {
    return render(
        <TokenSelector
            side="sell"
            chainId={56}
            tokens={[]}
            walletTokens={[native, unverified, hidden, honeypot, blocklisted]}
            search=""
            loading={false}
            error={null}
            currentToken={native}
            oppositeToken={null}
            onSearchChange={vi.fn()}
            onSelect={vi.fn()}
            onClose={vi.fn()}
            {...overrides}
        />,
    )
}

describe('TokenSelector wallet rows', () => {
    beforeEach(() => {
        window.localStorage.clear()
        clearTokenLogoCacheForTest()
    })
    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('renders wallet USD above quantity and keeps selected styling separate', () => {
        const { container } = renderSelector()
        const row = screen.getByText('BNB', { selector: 'strong' })
            .closest('.ps-token-row')
        const values = row.querySelector('.ps-token-row-value')

        expect(values.children[0].textContent).toBe('$113')
        expect(values.children[1].textContent).toBe('2.07472')
        expect(row.classList.contains('ps-token-row-selected')).toBe(true)
        expect(container.textContent).not.toContain('Selected')
        expect(container.textContent).not.toContain('Switch')
        expect(row.textContent).not.toContain('0x0000...0000')
    })

    it('does not truncate primary wallet tokens to five', () => {
        const walletTokens = Array.from({ length: 7 }, (_, index) => ({
            ...native,
            id: `token-${index}`,
            address: `0x${String(index + 1).padStart(40, '0')}`,
            isNative: false,
            name: `Primary ${index}`,
            symbol: `P${index}`,
            recognitionStatus: 'recognized',
            recognitionReasons: ['coingecko-exact-contract'],
            verifiedContract: true,
            includeInPortfolioValue: true,
        }))
        const { container } = renderSelector({
            walletTokens,
            currentToken: null,
        })

        expect(container.querySelectorAll('.ps-token-row')).toHaveLength(7)
    })

    it('keeps wallet-owned tokens visible when the popular catalog is unavailable', () => {
        renderSelector({
            tokens: [],
            walletTokens: [native],
            catalogNotice: 'Popular tokens are temporarily unavailable.',
        })
        const walletSection = screen.getByText('Your tokens').closest('section')
        expect(within(walletSection).getByText('BNB', { selector: 'strong' }))
            .toBeTruthy()
        expect(screen.getByText('Popular tokens are temporarily unavailable.'))
            .toBeTruthy()
    })

    it('shows curated OP tokens and address search during a provider outage', () => {
        const common = ['WETH', 'USDC', 'USDT', 'OP', 'DAI', 'WBTC']
            .map((symbol, index) => ({
                ...native,
                id: `10:0x${String(index + 1).padStart(40, '0')}`,
                chainId: 10,
                address: `0x${String(index + 1).padStart(40, '0')}`,
                isNative: false,
                name: symbol,
                symbol,
                volume24hUsd: null,
                liquidityUsd: null,
                source: 'curated',
                catalogSection: 'common',
                verifiedContract: true,
                verificationStatus: 'established',
                visibility: 'primary',
                securityStatus: 'trusted',
            }))
        renderSelector({
            chainId: 10,
            tokens: [],
            commonTokens: common,
            walletTokens: [],
            currentToken: null,
            catalogNotice: 'Popular tokens are temporarily unavailable.',
        })

        expect(screen.getByText('Common tokens')).toBeTruthy()
        expect(screen.getByText('Common tokens').closest('.ps-token-section-heading')
            .querySelector('svg')).toBeNull()
        for (const symbol of common.map((token) => token.symbol)) {
            expect(screen.getByText(symbol, { selector: 'strong' })).toBeTruthy()
        }
        expect(screen.getByText('Popular tokens are temporarily unavailable.'))
            .toBeTruthy()
        expect(screen.getByRole('textbox')).toBeTruthy()
    })

    it('deduplicates wallet, ranked, and common rows by canonical identity', () => {
        const shared = {
            ...native,
            id: '56:0x0000000000000000000000000000000000000042',
            address: '0x0000000000000000000000000000000000000042',
            isNative: false,
            name: 'Shared Token',
            symbol: 'SHARED',
            verificationStatus: 'established',
            verificationReasons: ['coingecko-exact-contract', 'minimum-liquidity-met'],
            verifiedContract: true,
            volume24hUsd: 100000,
            liquidityUsd: 200000,
        }
        renderSelector({
            tokens: [shared],
            commonTokens: [{ ...shared, source: 'curated', catalogSection: 'common' }],
            walletTokens: [{ ...shared, balance: '1', visibility: 'primary' }],
            currentToken: null,
        })
        expect(screen.getAllByText('Shared Token', { selector: 'strong' }))
            .toHaveLength(1)
        expect(screen.queryByText('Common tokens')).toBeNull()
    })

    it('keeps unverified and risky wallet tokens in separate collapsed sections', () => {
        const onSelect = vi.fn()
        const first = renderSelector({ onSelect, hideUnknownTokens: false })

        expect(screen.queryByText(hidden.name)).toBeNull()
        expect(screen.queryByText(unverified.name)).toBeNull()
        const unverifiedSection = screen.getByText('Unverified tokens (1)').closest('section')
        fireEvent.click(within(unverifiedSection).getByRole('button', { name: 'Show' }))
        expect(screen.getByText(unverified.name)).toBeTruthy()
        const hiddenSection = screen.getByText('Hidden risky tokens (3)').closest('section')
        fireEvent.click(within(hiddenSection).getByRole('button', { name: 'Show' }))
        expect(screen.getByText(hidden.name).textContent).toBe(hidden.name)
        expect(screen.getByText(honeypot.name)).toBeTruthy()
        expect(screen.getByText(blocklisted.name)).toBeTruthy()
        expect(document.querySelectorAll('.ps-token-row')).toHaveLength(5)
        expect(screen.getByText(/spam or severe security warnings/i))
            .toBeTruthy()
        const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
        fireEvent.click(screen.getByText(hidden.name).closest('.ps-token-row'))
        expect(confirmation).toHaveBeenCalledWith(expect.stringContaining(
            'moralis-possible-spam',
        ))
        expect(onSelect).toHaveBeenCalledWith(hidden)
        first.unmount()
        renderSelector({ hideUnknownTokens: true })
        expect(screen.queryByText('Unverified tokens (1)')).toBeNull()
        expect(screen.queryByText('Hidden risky tokens (3)')).toBeNull()
        expect(screen.queryByText(hidden.name)).toBeNull()
        expect(screen.queryByText(unverified.name)).toBeNull()
    })

    it('never renders a hidden wallet token under Your tokens or featured market rows', () => {
        renderSelector({
            tokens: [{ ...hidden, visibility: 'primary', valueUSD: '500000' }],
            hideUnknownTokens: true,
        })
        const primarySection = screen.getByText('Your tokens').closest('section')
        expect(within(primarySection).queryByText(hidden.name)).toBeNull()
        expect(screen.queryByText(hidden.name)).toBeNull()
    })

    it('keeps a recognized clean caution token under Your tokens without a scam warning', () => {
        renderSelector({
            walletTokens: [recognizedCaution, hidden],
            currentToken: recognizedCaution,
            hideUnknownTokens: false,
        })
        const primarySection = screen.getByText('Your tokens').closest('section')
        const cautionRow = within(primarySection).getByText(recognizedCaution.name)
            .closest('.ps-token-row')
        expect(cautionRow).toBeTruthy()
        expect(within(cautionRow).queryByText('Potential risk')).toBeNull()
    })

    it('hides only the page scrollbar and preserves selector scrolling rules', () => {
        const pageCss = readFileSync(
            resolve('src/index.css'),
            'utf8',
        )
        const selectorCss = readFileSync(
            resolve('src/features/tokens/components/TokenSelector.css'),
            'utf8',
        )

        expect(pageCss).toMatch(/scrollbar-width:\s*none/)
        expect(pageCss).toMatch(/body::-webkit-scrollbar[\s\S]*display:\s*none/)
        expect(pageCss).not.toMatch(/body\s*\{[^}]*overflow:\s*hidden/)
        expect(selectorCss).toMatch(/\.ps-token-selector-scroll\s*\{[\s\S]*overflow-y:\s*auto/)
        expect(selectorCss).toMatch(/\.ps-token-selector-scroll\s*\{[\s\S]*scrollbar-width:\s*thin/)
    })

    it('finds a hidden honeypot token by exact contract while hiding unknown tokens', () => {
        renderSelector({
            search: honeypot.address,
            hideUnknownTokens: true,
        })
        expect(screen.getByText(honeypot.name)).toBeTruthy()
    })

    it('does not render a selected hidden token when unknown tokens are hidden', () => {
        renderSelector({
            currentToken: hidden,
            hideUnknownTokens: true,
        })
        expect(screen.queryByText(hidden.name)).toBeNull()
        expect(screen.queryByText('Selected token')).toBeNull()
        const primarySection = screen.queryByText('Your tokens')?.closest('section')
        expect(primarySection ? within(primarySection).queryByText(hidden.name) : null)
            .toBeNull()
        expect(screen.queryByText('Hidden risky tokens (3)')).toBeNull()
    })

    it('filters screenshot junk wallet tokens during normal browsing but reveals exact-address search', () => {
        const junk = [
            ['RETURN TO MEMES', 'RET', '0x0000000000000000000000000000000000000101'],
            ['Cash Doge', 'CDOGE', '0x0000000000000000000000000000000000000102'],
            ['everyone', 'EVERYONE', '0x0000000000000000000000000000000000000103'],
            ['CXMT', 'CXMT', '0x0000000000000000000000000000000000000104'],
            ['Token 0x7ca3...3690', '0x7ca3...3690', '0x7ca3000000000000000000000000000000003690'],
        ].map(([name, symbol, address]) => ({
            ...hidden,
            id: `56:${address}`,
            address,
            name,
            symbol,
            possibleSpam: false,
            spamStatus: 'clean',
            securityStatus: 'caution',
            priceUSD: '447000',
            marketPriceUSD: '447000',
            valueUSD: null,
            priceConfidence: 'untrusted',
            visibilityReasons: ['market-catalog-only', 'untrusted-market-price'],
        }))
        renderSelector({
            walletTokens: [native, recognizedCaution, ...junk],
            currentToken: null,
            hideUnknownTokens: true,
        })

        expect(screen.getByText('BNB', { selector: 'strong' })).toBeTruthy()
        expect(screen.getByText(recognizedCaution.name)).toBeTruthy()
        for (const token of junk) expect(screen.queryByText(token.name)).toBeNull()
        expect(document.body.textContent).not.toContain('$447,526.72')
        cleanup()

        renderSelector({
            walletTokens: [native, ...junk],
            currentToken: null,
            search: junk[0].address,
            hideUnknownTokens: true,
        })
        expect(screen.getByText('RETURN TO MEMES')).toBeTruthy()
    })

    it('persists the two collapsed-section states without touching other storage', () => {
        window.localStorage.setItem('unrelated-setting', 'keep')
        const first = renderSelector({ hideUnknownTokens: false })
        const unverifiedSection = screen.getByText('Unverified tokens (1)').closest('section')
        const riskySection = screen.getByText('Hidden risky tokens (3)').closest('section')
        fireEvent.click(within(unverifiedSection).getByRole('button', { name: 'Show' }))
        fireEvent.click(within(riskySection).getByRole('button', { name: 'Show' }))
        first.unmount()

        renderSelector({ hideUnknownTokens: false })
        expect(screen.getByText(unverified.name)).toBeTruthy()
        expect(screen.getByText(honeypot.name)).toBeTruthy()
        expect(window.localStorage.getItem('unrelated-setting')).toBe('keep')
    })

    it('renders a controlled accessible chain selector with zkEVM disabled', () => {
        const onChainChange = vi.fn()
        renderSelector({ onChainChange })

        const selector = screen.getByRole('button', { name: 'Token network' })
        expect(selector.textContent).toContain('BNB')
        fireEvent.click(selector)
        const listbox = screen.getByRole('listbox', { name: 'Token network' })
        const options = within(listbox).getAllByRole('option')
        expect(options.filter((option) => !option.disabled)).toHaveLength(25)
        expect(within(listbox).getByRole('option', {
            name: /Polygon zkEVM.*Unavailable/,
        }).disabled).toBe(true)
        expect(within(listbox).getByRole('option', {
            name: 'All Chains',
        }).textContent).toContain('∞')
        expect(listbox.querySelectorAll('.ps-chain-icon img')).toHaveLength(25)
        expect(screen.getByText(/Polygon zkEVM is temporarily unavailable/))
            .toBeTruthy()

        fireEvent.click(within(listbox).getByRole('option', {
            name: 'Ethereum',
        }))
        expect(onChainChange).toHaveBeenCalledWith(1)
        expect(selector.textContent).toContain('BNB')
    })

    it('filters concrete chains and keeps all-chain search results flat', () => {
        const ethereumToken = {
            ...native,
            id: '1:0x0000000000000000000000000000000000000001',
            chainId: 1,
            address: '0x0000000000000000000000000000000000000001',
            isNative: false,
            name: 'Ethereum token',
            symbol: 'ETHX',
            recognitionStatus: 'recognized',
            verificationStatus: 'recognized',
            recognitionReasons: ['coingecko-exact-contract'],
            verificationReasons: ['coingecko-exact-contract', 'minimum-liquidity-met'],
            verifiedContract: true,
            volume24hUsd: '100',
            liquidityUsd: '1000',
            possibleSpam: false,
            securityStatus: 'low',
            visibility: 'primary',
        }
        const bscToken = {
            ...ethereumToken,
            id: '56:0x0000000000000000000000000000000000000002',
            chainId: 56,
            address: '0x0000000000000000000000000000000000000002',
            name: 'BSC token',
            symbol: 'BSCX',
        }
        const first = renderSelector({
            chainId: 56,
            tokens: [ethereumToken, bscToken],
            walletTokens: [],
            currentToken: null,
            search: 'token',
        })
        expect(screen.queryByText('Ethereum token')).toBeNull()
        expect(screen.getByText('BSC token')).toBeTruthy()
        first.unmount()

        renderSelector({
            chainId: 'all',
            tokens: [ethereumToken, bscToken],
            walletTokens: [],
            currentToken: null,
            search: 'token',
        })
        expect(screen.getByText('Ethereum token')).toBeTruthy()
        expect(screen.getByText('BSC token')).toBeTruthy()
        expect(document.querySelectorAll('.ps-token-section-heading')).toHaveLength(0)
        expect(screen.queryByText('Ethereum')).toBeNull()
        expect(screen.queryByText('BNB Smart Chain')).toBeNull()
        expect(screen.getByLabelText('Ethereum network').title).toBe('Ethereum')
        expect(screen.getByLabelText('BNB Smart Chain network').title)
            .toBe('BNB Smart Chain')
    })

    it('renders a compact stale notice directly before the first global market row', () => {
        const market = {
            ...native,
            id: '1:0x0000000000000000000000000000000000000001',
            chainId: 1,
            address: '0x0000000000000000000000000000000000000001',
            isNative: false,
            name: 'One market token',
            symbol: 'ONE',
            volume24hUsd: '100',
            liquidityUsd: '1000',
            verificationStatus: 'established',
            verificationReasons: [
                'coingecko-exact-contract',
                'minimum-liquidity-met',
            ],
        }
        renderSelector({
            chainId: 'all',
            tokens: [market],
            walletTokens: [],
            currentToken: null,
            catalogNotice: 'Showing previously loaded market data.',
        })

        const status = screen.getByText('Showing previously loaded market data.')
        const row = screen.getByText('One market token').closest('.ps-token-row')
        expect(status.classList.contains('ps-token-inline-status')).toBe(true)
        expect(status.classList.contains('ps-token-message')).toBe(false)
        expect(status.nextElementSibling).toBe(row)
    })

    it('renders partial ranked rows instead of an unavailable state', () => {
        const market = {
            ...native,
            id: '56:0x0000000000000000000000000000000000000001',
            address: '0x0000000000000000000000000000000000000001',
            isNative: false,
            name: 'Available partial token',
            symbol: 'PART',
            volume24hUsd: '100',
            liquidityUsd: '1000',
            verificationStatus: 'recognized',
            verificationReasons: [
                'coingecko-exact-contract',
                'minimum-liquidity-met',
            ],
        }
        renderSelector({
            tokens: [market],
            walletTokens: [],
            currentToken: null,
            catalogNotice: 'Popular tokens are temporarily unavailable.',
        })

        expect(screen.getByText('Available partial token')).toBeTruthy()
        expect(screen.getByText('Some market data could not be refreshed.')).toBeTruthy()
        expect(screen.queryByText('Popular tokens are temporarily unavailable.')).toBeNull()
    })

    it('uses a fixed desktop height while preserving long-list scrolling and compact empty states', () => {
        const css = readFileSync(resolve('src/features/tokens/components/TokenSelector.css'), 'utf8')
        expect(css).toMatch(/\.ps-token-selector-dialog\s*\{[\s\S]*?height:\s*min\(650px, calc\(100dvh - 32px\)\);[\s\S]*?max-height:/)
        expect(css).toMatch(/\.ps-token-selector-scroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-y:\s*auto/)
        expect(css).toMatch(/\.ps-token-inline-status\s*\{[\s\S]*?padding:\s*4px 12px 8px/)
        expect(css).not.toMatch(/\.ps-token-inline-status\s*\{[^}]*min-height:/)
        expect(css).not.toMatch(/\.ps-token-(?:section|row)[^{]*\{[^}]*margin-top:\s*auto/)

        const single = renderSelector({
            chainId: 'all',
            tokens: [{
                ...native,
                volume24hUsd: '1000',
                liquidityUsd: '1000',
                verificationStatus: 'established',
                verificationReasons: [
                    'coingecko-exact-contract',
                    'minimum-liquidity-met',
                ],
            }],
            walletTokens: [],
            currentToken: null,
        })
        const singleDialogClass = single.container.querySelector('[role="dialog"]').className
        single.unmount()

        const manyTokens = Array.from({ length: 100 }, (_, index) => ({
            ...native,
            id: `1:0x${String(index + 1).padStart(40, '0')}`,
            chainId: 1,
            address: `0x${String(index + 1).padStart(40, '0')}`,
            isNative: false,
            name: `Market ${index}`,
            volume24hUsd: String(1000 - index),
            liquidityUsd: '1000',
            verificationStatus: 'established',
            verificationReasons: [
                'coingecko-exact-contract',
                'minimum-liquidity-met',
            ],
        }))
        const first = renderSelector({
            chainId: 'all',
            tokens: manyTokens,
            walletTokens: [],
            currentToken: null,
        })
        expect(first.container.querySelector('[role="dialog"]').className)
            .toBe(singleDialogClass)
        expect(first.container.querySelectorAll('.ps-token-row')).toHaveLength(100)
        first.unmount()

        renderSelector({ search: 'missing', tokens: [], walletTokens: [] })
        expect(screen.getByText('No matching tokens').classList.contains('ps-token-message'))
            .toBe(true)
    })

    it('uses circular uncropped badges with canonical accessible network identity', () => {
        const css = readFileSync(resolve('src/features/tokens/components/TokenSelector.css'), 'utf8')
        expect(css).toMatch(/\.ps-token-network-badge\s*\{[\s\S]*?border-radius:\s*50%/)
        expect(css).toMatch(/\.ps-token-network-badge img\s*\{[\s\S]*?object-fit:\s*contain/)
        expect(css).not.toMatch(/\.ps-token-network-badge img\s*\{[^}]*transform:/)

        renderSelector({ walletTokens: [native], tokens: [] })
        const row = screen.getByText('BNB', { selector: 'strong' }).closest('.ps-token-row')
        const badge = within(row).getByLabelText('BNB Smart Chain network')
        expect(badge.classList.contains('ps-token-network-badge')).toBe(true)
        expect(badge.title).toBe('BNB Smart Chain')
        expect(within(row).queryByText('BNB Smart Chain')).toBeNull()
        expect(row.querySelector('.ps-token-chain-label')).toBeNull()
    })

    it('renders wallet tokens first and globally sorts market tokens without chain headings', () => {
        const marketTokens = [
            { ...native, id: '56:0x0000000000000000000000000000000000000010', address: '0x0000000000000000000000000000000000000010', isNative: false, name: 'Lower BSC', symbol: 'SAME', volume24hUsd: '10', liquidityUsd: '100', verificationStatus: 'established', verificationReasons: ['coingecko-exact-contract', 'minimum-liquidity-met'] },
            { ...native, id: '1:0x0000000000000000000000000000000000000011', chainId: 1, address: '0x0000000000000000000000000000000000000011', isNative: false, name: 'Higher Ethereum', symbol: 'SAME', volume24hUsd: '100', liquidityUsd: '50', verificationStatus: 'established', verificationReasons: ['coingecko-exact-contract', 'minimum-liquidity-met'] },
            { ...native, id: '8453:0x0000000000000000000000000000000000000012', chainId: 8453, address: '0x0000000000000000000000000000000000000012', isNative: false, name: 'Middle Base', symbol: 'MID', volume24hUsd: '50', liquidityUsd: '75', verificationStatus: 'established', verificationReasons: ['coingecko-exact-contract', 'minimum-liquidity-met'] },
        ]
        renderSelector({
            chainId: 'all',
            tokens: marketTokens,
            walletTokens: [native],
            currentToken: null,
        })

        const walletSection = screen.getByText('Your tokens').closest('section')
        const marketSection = screen.getByText('Tokens by 24H volume').closest('section')
        expect(walletSection.compareDocumentPosition(marketSection) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy()
        expect([...marketSection.querySelectorAll('.ps-token-row strong')].map((node) => node.textContent))
            .toEqual(['Higher Ethereum', 'Middle Base', 'Lower BSC'])
        expect(screen.queryByText(/Featured on/)).toBeNull()
        expect(within(marketSection).queryByText('Celo', { selector: '.ps-token-section-heading' }))
            .toBeNull()
        expect(screen.getAllByText('SAME', { selector: '.ps-token-symbol' })).toHaveLength(2)
        expect(screen.getAllByLabelText(/network$/)).toEqual(expect.arrayContaining([
            expect.objectContaining({ title: 'Ethereum' }),
            expect.objectContaining({ title: 'BNB Smart Chain' }),
        ]))
        expect(within(marketSection).getByText('0x0000...0011')).toBeTruthy()
        expect(within(marketSection).getByText('0x0000...0010')).toBeTruthy()
        expect(marketSection.querySelector('.ps-token-chain-label')).toBeNull()
    })

    it('displays safe XAUT market valuation without issuing per-token requests', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        const xaut = {
            ...native,
            id: '56:0x21caef8a43163eea865baee23b9c2e327696a3bf',
            address: '0x21caef8a43163eea865baee23b9c2e327696a3bf',
            isNative: false,
            name: 'Tether Gold',
            symbol: 'XAUt',
            decimals: 6,
            rawBalance: '2500000',
            balance: '2.5',
            valueUSD: null,
            trustedPriceUSD: null,
            marketPriceUSD: '2400',
            priceConfidence: 'market',
            recognitionStatus: 'established',
            recognitionReasons: ['curated-official-contract'],
            verifiedContract: true,
            visibility: 'primary',
            possibleSpam: false,
            securityStatus: 'caution',
            logoURI: '/icons/tether-gold.png',
            logoCandidates: [
                '/icons/tether-gold.png',
                'https://example.com/trusted-xaut-fallback.png',
            ],
        }
        renderSelector({ walletTokens: [xaut], tokens: [] })
        const row = screen.getByText('Tether Gold').closest('.ps-token-row')
        expect(row.querySelector('.ps-token-row-value strong').textContent).toBe('$6,000')
        expect(row.querySelector('.ps-token-row-value span').textContent).toBe('2.5')
        expect(row.closest('section').textContent).toContain('Your tokens')
        expect(screen.queryByText(/Unverified tokens/)).toBeNull()
        const mainLogo = row.querySelector('.ps-token-main-logo')
        expect(mainLogo.getAttribute('src')).toBe('/icons/tether-gold.png')
        const badge = row.querySelector('.ps-token-network-badge')
        expect(badge.getAttribute('title')).toBe('BNB Smart Chain')
        expect(badge.getAttribute('aria-label')).toBe('BNB Smart Chain network')
        expect(badge.querySelector('img').getAttribute('src'))
            .toBe('/networkIcons/bsc.webp')
        fireEvent.error(mainLogo)
        expect(row.querySelector('.ps-token-main-logo').getAttribute('src'))
            .toBe('https://example.com/trusted-xaut-fallback.png')
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('resolves stale recent XAUt metadata to the refreshed wallet record', () => {
        const address = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
        window.localStorage.setItem(
            'pistachioswap:recent-token-searches:v3:56',
            JSON.stringify([{
                chainId: 56,
                address,
                name: 'Old unverified XAUT',
                symbol: 'XAUT',
                visibility: 'unverified',
                logoURI: '/icons/token-fallback.svg',
            }]),
        )
        renderSelector({
            walletTokens: [{
                ...native,
                id: `56:${address}`,
                address,
                isNative: false,
                name: 'Tether Gold',
                symbol: 'XAUt',
                decimals: 6,
                recognitionStatus: 'established',
                visibility: 'primary',
                logoURI: '/icons/tether-gold.png',
                logoCandidates: ['/icons/tether-gold.png'],
            }],
            tokens: [],
            currentToken: null,
        })
        const recent = screen.getByText('Recent searches').closest('section')
        expect(within(recent).getByText('Tether Gold')).toBeTruthy()
        expect(within(recent).queryByText('Old unverified XAUT')).toBeNull()
        expect(recent.querySelector('.ps-token-main-logo').getAttribute('src'))
            .toBe('/icons/tether-gold.png')
    })

    it('renders the Celo native balance and ERC-20 alias as one native row', () => {
        const shared = {
            ...native,
            chainId: 42220,
            name: 'Celo',
            symbol: 'CELO',
            balance: '4.2',
            rawBalance: '4200000000000000000',
        }
        renderSelector({
            chainId: 'all',
            tokens: [],
            walletTokens: [
                { ...shared, id: '42220:alias', address: '0x471ece3750da237f93b8e339c536989b8978a438', isNative: false },
                { ...shared, id: '42220:native', address: '0x0000000000000000000000000000000000000000', isNative: true },
            ],
        })
        expect(screen.getAllByText('Celo', { selector: 'strong' })).toHaveLength(1)
        const row = screen.getByText('CELO', { selector: '.ps-token-symbol' })
            .closest('.ps-token-row')
        expect(row.querySelector('.ps-token-contract')).toBeNull()
        expect(row.querySelector('.ps-token-row-value span').textContent).toBe('4.2')
    })

    it('drops malformed identities instead of producing NaN keys', () => {
        renderSelector({
            tokens: [{
                chainId: 'bad',
                address: 'bad',
                name: 'Malformed',
                symbol: 'BAD',
            }],
            walletTokens: [],
            currentToken: null,
        })
        expect(screen.queryByText('Malformed')).toBeNull()
        const storageKeys = Array.from(
            { length: window.localStorage.length },
            (_, index) => window.localStorage.key(index),
        )
        expect(storageKeys.some((key) => key.includes('NaN'))).toBe(false)
    })
})
