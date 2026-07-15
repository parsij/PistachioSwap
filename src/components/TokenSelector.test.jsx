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

const native = {
    classificationVersion: 3,
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
    spamStatus: 'clean',
    possibleSpam: false,
    verifiedContract: null,
    securityStatus: 'trusted',
    priceConfidence: 'trusted',
    visibility: 'primary',
    logoURI: '/icons/bnb.svg',
}

const hidden = {
    classificationVersion: 3,
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
    beforeEach(() => window.localStorage.clear())
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
        }))
        const { container } = renderSelector({
            walletTokens,
            currentToken: null,
        })

        expect(container.querySelectorAll('.ps-token-row')).toHaveLength(7)
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
            resolve('src/components/TokenSelector.css'),
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

    it('keeps a selected hidden token visible', () => {
        renderSelector({
            currentToken: hidden,
            hideUnknownTokens: true,
        })
        expect(screen.getByText(hidden.name)).toBeTruthy()
        const selectedSection = screen.getByText('Selected token').closest('section')
        expect(within(selectedSection).getByText(hidden.name)).toBeTruthy()
        const primarySection = screen.queryByText('Your tokens')?.closest('section')
        expect(primarySection ? within(primarySection).queryByText(hidden.name) : null)
            .toBeNull()
        expect(screen.queryByText('Hidden risky tokens (3)')).toBeNull()
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
})
