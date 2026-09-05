// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import TransactionStatusDialog, { blockscanTransactionUrl } from './TransactionStatusDialog.jsx'

const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('TransactionStatusDialog', () => {
    afterEach(cleanup)

    it('uses the multichain Blockscan transaction URL instead of a chain-specific label', () => {
        expect(blockscanTransactionUrl(hash)).toBe(`https://blockscan.com/tx/${hash}`)

        render(<TransactionStatusDialog status="sent" hash={hash} />)
        const link = screen.getByRole('link', { name: /view on blockscan/i })
        expect(link.getAttribute('href')).toBe(`https://blockscan.com/tx/${hash}`)
        expect(document.body.textContent).not.toContain('BscScan')
    })

    it('shows the moving progress surface while a send is pending', () => {
        render(<TransactionStatusDialog status="submitted" hash={hash} />)
        const status = screen.getByRole('status')
        expect(screen.getByText('Waiting for confirmation')).toBeTruthy()
        expect(status.style.position).toBe('relative')
        expect(status.style.overflow).toBe('hidden')
        expect(status.querySelector('span[aria-hidden="true"]')).toBeTruthy()
    })
})
