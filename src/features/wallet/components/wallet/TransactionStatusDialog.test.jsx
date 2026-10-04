// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CURATED_EVM_CHAINS } from '../../../../web3/curatedEvmChains.js'
import TransactionStatusDialog, { transactionExplorerUrl } from './TransactionStatusDialog.jsx'

const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const bnb = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    isNative: true,
}

describe('TransactionStatusDialog', () => {
    afterEach(cleanup)

    it('uses the selected chain explorer instead of Blockscan', () => {
        const base = CURATED_EVM_CHAINS.find((chain) => chain.id === 8453)
        const explorerUrl = base.blockExplorers.default.url
        const explorerName = base.blockExplorers.default.name

        expect(transactionExplorerUrl(explorerUrl, hash))
            .toBe(`${explorerUrl}/tx/${hash}`)

        render(
            <TransactionStatusDialog
                status="sent"
                hash={hash}
                explorerUrl={explorerUrl}
                explorerName={explorerName}
            />,
        )
        const link = screen.getByRole('link', {
            name: new RegExp(`view on ${explorerName}`, 'i'),
        })
        expect(link.getAttribute('href')).toBe(`${explorerUrl}/tx/${hash}`)
        expect(link.getAttribute('href')).not.toContain('blockscan.com')
    })

    it('builds a transaction URL from every curated chain explorer', () => {
        for (const chain of CURATED_EVM_CHAINS) {
            const explorerUrl = chain.blockExplorers?.default?.url
            expect(explorerUrl).toBeTruthy()
            expect(transactionExplorerUrl(explorerUrl, hash))
                .toBe(`${String(explorerUrl).replace(/\/+$/u, '')}/tx/${hash}`)
        }
    })

    it('does not invent a Blockscan fallback when explorer metadata is missing', () => {
        render(<TransactionStatusDialog status="sent" hash={hash} />)
        expect(screen.queryByRole('link')).toBeNull()
        expect(document.body.textContent).not.toContain('Blockscan')
    })

    it('shows the token artwork and moving progress surface while a send is pending', () => {
        const { container } = render(
            <TransactionStatusDialog status="submitted" hash={hash} token={bnb} />,
        )
        const status = screen.getByRole('status')
        const tokenLogo = container.querySelector('.ps-token-main-logo')
        expect(screen.getByText('Waiting for confirmation')).toBeTruthy()
        expect(tokenLogo?.getAttribute('src')).toBe('/assets/bnb-logo-Ujb8xjX_.png')
        expect(status.style.position).toBe('relative')
        expect(status.style.overflow).toBe('hidden')
        expect(status.querySelector('span[aria-hidden="true"]')).toBeTruthy()
    })
})
