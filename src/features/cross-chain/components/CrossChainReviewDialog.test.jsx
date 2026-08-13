// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CrossChainReviewDialog from './CrossChainReviewDialog.jsx'

afterEach(() => {
    cleanup()
    document.body.replaceChildren()
})

const route = {
    publicRouteId: '00000000-0000-0000-0000-000000000001',
    inputAmount: '1000000000000000000',
    outputAmount: '950000',
    minimumOutputAmount: '940000',
    sourceChainId: 56,
    destinationChainId: 137,
    durationSeconds: 90,
    expiresAt: null,
}

function renderDialog(gasAssist) {
    const onStart = vi.fn()
    const shell = document.createElement('main')
    shell.className = 'app-shell'
    document.body.append(shell)
    render(<CrossChainReviewDialog
        open
        route={route}
        reducedMotion
        activeAmountSide="sell"
        sellToken={{ symbol: 'SELL', decimals: 18 }}
        buyToken={{ symbol: 'BUY', decimals: 6 }}
        costs={{ total: '$0.03', route: null, sourceGas: null, provider: null, appFee: null, nativeSymbol: 'BNB' }}
        preparation={{ status: 'ready', gasEstimateUnavailable: false, insufficientNativeGas: Boolean(gasAssist?.required) }}
        routeError={null}
        executionError={null}
        confirmDisabled={false}
        gasAssist={gasAssist ? { ...gasAssist, onStart } : null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
    />)
    return { onStart, shell }
}

describe('CrossChainReviewDialog', () => {
    it('directly owns the stylesheet required to render as a modal', () => {
        const source = readFileSync(
            'src/features/cross-chain/components/CrossChainReviewDialog.jsx',
            'utf8',
        )
        expect(source).toContain("import './crossChain.css'")
    })

    it('uses Gas Assist review and execution wording for sponsored cross-chain swaps', () => {
        const { onStart, shell } = renderDialog({ required: true, available: true, status: 'success' })

        expect(screen.getByRole('dialog').classList.contains('cross-chain-review-dialog')).toBe(true)
        expect(screen.getByText('Review Gas Assisted Swap')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Swap using Gas Assist' }))
        expect(onStart).toHaveBeenCalledOnce()

        shell.remove()
    })

    it('uses the Gas Assist review title while exact source gas is still being prepared', () => {
        const { shell } = renderDialog({ expected: true, required: false, available: false, status: 'loading' })
        expect(screen.getByText('Review Gas Assisted Swap')).toBeTruthy()
        shell.remove()
    })

    it('preserves normal cross-chain wording when sponsorship is unnecessary', () => {
        const { shell } = renderDialog(null)
        expect(screen.getByText('Review cross-chain swap')).toBeTruthy()
        shell.remove()
    })
})
