// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import TokenIcon from './TokenIcon.jsx'

const completeDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'complete',
)
const naturalWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'naturalWidth',
)

function restoreImageProperty(name, descriptor) {
    if (descriptor) {
        Object.defineProperty(HTMLImageElement.prototype, name, descriptor)
        return
    }
    delete HTMLImageElement.prototype[name]
}

afterEach(() => {
    restoreImageProperty('complete', completeDescriptor)
    restoreImageProperty('naturalWidth', naturalWidthDescriptor)
})

describe('TokenIcon', () => {
    it('reveals an already decoded cached image even when onLoad was missed', async () => {
        Object.defineProperty(HTMLImageElement.prototype, 'complete', {
            configurable: true,
            get: () => true,
        })
        Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
            configurable: true,
            get: () => 250,
        })

        const { container } = render(
            <TokenIcon
                showChainBadge={false}
                token={{
                    chainId: 8453,
                    address: '0xd9aaec86b65d86f6a7b5a0b1c42ffa531710b6ca',
                    name: 'Bridged USDC (Base)',
                    symbol: 'USDbC',
                    logoURI: 'https://assets.example.test/usdbc.png',
                }}
            />,
        )

        const image = container.querySelector('.ps-token-main-logo')
        expect(image).not.toBeNull()

        await waitFor(() => {
            expect(image.classList.contains('ps-token-main-logo-loaded')).toBe(true)
        })
        expect(container.querySelector('.ps-token-logo-skeleton')).toBeNull()
    })
})
