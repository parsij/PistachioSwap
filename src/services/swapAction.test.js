import { describe, expect, it } from 'vitest'

import { getSwapActionState } from './swapAction.js'

const READY_STATE = {
    isConnected: true,
    isCorrectNetwork: true,
    hasSellToken: true,
    hasBuyToken: true,
    hasAmount: true,
    quoteStatus: 'success',
    quoteReady: true,
    transactionStatus: 'idle',
}

describe('swap action state', () => {
    it('opens connection before considering quote state', () => {
        expect(
            getSwapActionState({
                ...READY_STATE,
                isConnected: false,
                quoteReady: false,
            }),
        ).toEqual({
            type: 'connect',
            label: 'Connect wallet',
            enabled: true,
        })
    })

    it('blocks quoting and swapping on the wrong chain', () => {
        expect(
            getSwapActionState({
                ...READY_STATE,
                isCorrectNetwork: false,
            }),
        ).toEqual({
            type: 'switch-network',
            label: 'Switch to BNB Chain',
            enabled: true,
        })
    })

    it('enables the normal swap action on chain 56 with a quote', () => {
        expect(
            getSwapActionState(READY_STATE),
        ).toEqual({
            type: 'swap',
            label: 'Swap',
            enabled: true,
        })
    })
})
