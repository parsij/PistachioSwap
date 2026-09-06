// @vitest-environment jsdom

import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TokenSelector from './TokenSelector.jsx'

function renderSelector(overrides = {}) {
    const onChainChange = vi.fn()
    const view = render(
        <TokenSelector
            side="sell"
            chainId={56}
            tokens={[]}
            commonTokens={[]}
            fallbackTokens={[]}
            walletTokens={[]}
            search=""
            loading={false}
            error={null}
            currentToken={null}
            oppositeToken={null}
            onSearchChange={vi.fn()}
            onSelect={vi.fn()}
            onClose={vi.fn()}
            onChainChange={onChainChange}
            {...overrides}
        />,
    )
    return { ...view, onChainChange }
}

describe('TokenSelector opening scope', () => {
    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('defaults to All Chains when the opposite side has no token', () => {
        const { onChainChange, queryByLabelText } = renderSelector()

        expect(onChainChange).toHaveBeenCalledTimes(1)
        expect(onChainChange).toHaveBeenCalledWith('all')
        expect(queryByLabelText('Quick tokens')).toBeNull()
    })

    it('defaults to the opposite token chain when one side is already selected', () => {
        const { onChainChange } = renderSelector({
            oppositeToken: {
                chainId: 137,
                address: '0x0000000000000000000000000000000000000001',
                symbol: 'USDC',
                decimals: 6,
            },
        })

        expect(onChainChange).toHaveBeenCalledTimes(1)
        expect(onChainChange).toHaveBeenCalledWith(137)
    })
})
