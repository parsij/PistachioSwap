// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import GasAssistBanner from './GasAssistBanner.jsx'

describe('Gas Assist banner', () => {
    it('explains low-BNB prepaid sponsorship and the higher fee before signing', () => {
        render(<GasAssistBanner
            sellToken={{ symbol: 'XAUT', decimals: 6 }}
            buyToken={{ symbol: 'USDT', decimals: 18 }}
        />)

        expect(screen.getByText('Gas Assist · Quoted sponsorship')).toBeTruthy()
        expect(screen.getByText(/XAUT → USDT needs Gas Assist because this wallet does not have enough BNB/)).toBeTruthy()
        expect(screen.getByText(/sponsor one BNB Chain transaction/)).toBeTruthy()
        expect(screen.getByText(/can exceed actual network gas, and PistachioSwap retains the difference/)).toBeTruthy()
        expect(screen.getByText(/exact fee and minimum output are shown before you sign anything/)).toBeTruthy()
        expect(screen.queryByText(/Powered by 0x/)).toBeNull()
    })
})
