// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import WalletAssetList from './WalletAssetList.jsx'

const primary = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000001',
    name: 'Established token',
    symbol: 'EST',
    balance: '2',
    valueUSD: '4',
    recognitionStatus: 'recognized',
    recognitionReasons: ['coingecko-exact-contract'],
    possibleSpam: false,
    verifiedContract: true,
    securityStatus: 'low',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
}
const hidden = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000002',
    name: 'Unknown token',
    symbol: 'UNKNOWN',
    balance: '5',
    valueUSD: null,
    marketPriceUSD: '100000',
    priceConfidence: 'market',
    securityStatus: 'high',
    visibility: 'hidden',
}
const unverified = {
    ...hidden,
    address: '0x0000000000000000000000000000000000000003',
    name: 'Unverified token',
    symbol: 'UNVERIFIED',
    possibleSpam: false,
    securityStatus: 'low',
    visibility: 'unverified',
}

describe('WalletAssetList security presentation', () => {
    beforeEach(() => window.localStorage.clear())
    afterEach(cleanup)

    it('keeps unknown holdings behind one collapsed Hidden tokens entry', () => {
        render(<WalletAssetList
            tokens={[primary, unverified, hidden]}
            settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
        />)

        expect(screen.getByText('Established token')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Hidden tokens (2)' })).toBeTruthy()
        expect(screen.queryByText('Unknown token')).toBeNull()
        expect(screen.queryByText('Unverified token')).toBeNull()
    })

    it('reveals hidden holdings only after an explicit click and never trusts their values', () => {
        render(<WalletAssetList
            tokens={[primary, unverified, hidden]}
            settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
        />)

        fireEvent.click(screen.getByRole('button', { name: 'Hidden tokens (2)' }))

        expect(screen.getByText('Unknown token')).toBeTruthy()
        expect(screen.getByText('Unverified token')).toBeTruthy()
        expect(screen.getByText('Potential risk')).toBeTruthy()
        expect(screen.getByText('Unverified')).toBeTruthy()
        expect(screen.getAllByText('—')).toHaveLength(2)
        expect(screen.getByText('5 UNKNOWN')).toBeTruthy()
        expect(screen.getByText(
            'Unknown, low-confidence, and risky tokens are excluded from your portfolio balance. Interact only when you trust the exact contract.',
        )).toBeTruthy()
    })

    it('preserves separate unverified and risky sections when unknown-token hiding is disabled', () => {
        render(<WalletAssetList
            tokens={[primary, unverified, hidden]}
            settings={{ hideUnknownTokens: false, hideSmallBalances: false }}
        />)

        expect(screen.queryByText('Unknown token')).toBeNull()
        expect(screen.queryByText('Unverified token')).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Unverified tokens (1)' }))
        expect(screen.getByText('Unverified token')).toBeTruthy()
        expect(screen.getByText('These tokens are not recognized by trusted asset sources.'))
            .toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Hidden risky tokens (1)' }))
        expect(screen.getByText('Unknown token')).toBeTruthy()
        expect(screen.getByText('Potential risk')).toBeTruthy()
        expect(screen.getAllByText('—')).toHaveLength(2)
    })

    it('treats missing visibility as non-primary', () => {
        render(<WalletAssetList
            tokens={[primary, { ...hidden, visibility: undefined }]}
            settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
        />)

        expect(screen.getByText('Established token')).toBeTruthy()
        expect(screen.queryByText('Unknown token')).toBeNull()
    })

    it('switches presentation without deleting the complete token array', () => {
        const tokens = [primary, unverified, hidden]
        const view = render(<WalletAssetList
            tokens={tokens}
            settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
        />)

        expect(screen.getByText('Hidden tokens (2)')).toBeTruthy()
        expect(screen.queryByText('Unverified tokens (1)')).toBeNull()

        view.rerender(<WalletAssetList
            tokens={tokens}
            settings={{ hideUnknownTokens: false, hideSmallBalances: false }}
        />)

        expect(screen.queryByText('Hidden tokens (2)')).toBeNull()
        expect(screen.getByText('Unverified tokens (1)')).toBeTruthy()
        expect(screen.getByText('Hidden risky tokens (1)')).toBeTruthy()
        expect(tokens).toHaveLength(3)
    })
})
