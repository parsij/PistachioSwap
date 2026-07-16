// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import GasAssistBanner from './GasAssistBanner.jsx'

describe('Gas Assist banner', () => {
    it('discloses automatic Gasless selection, fee schedule, network cost, and minimum output', () => {
        render(<GasAssistBanner
            sellToken={{ symbol: 'USDT', decimals: 6 }}
            buyToken={{ symbol: 'USDC', decimals: 6 }}
            quote={{
                minBuyAmount: '900000',
                fee: { dynamicFeeBps: 367, estimatedFeeUsd: '0.367' },
                fees: {
                    integratorFee: { amount: '367000' },
                    gasFee: { amount: '1000' },
                },
            }}
        />)
        expect(screen.getByText('Gas Assist · Powered by 0x')).toBeTruthy()
        expect(screen.getByText('You have no native token to pay for gas, but we’ve got you.')).toBeTruthy()
        expect(screen.getByText(/Network costs are included in the quote/)).toBeTruthy()
        expect(screen.getByText('PistachioSwap fee: 3% + $0.067, capped at $5')).toBeTruthy()
        expect(screen.getByText('0x gas/network cost')).toBeTruthy()
        expect(screen.getByText('Minimum output')).toBeTruthy()
    })
})
