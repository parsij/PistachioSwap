import { describe, expect, it } from 'vitest'

import { normalizeWalletState } from './useWalletState.js'

const ADDRESS = '0x0000000000000000000000000000000000000001'

describe('normalizeWalletState', () => {
    it('evaluates the wallet network against the token execution chain', () => {
        expect(normalizeWalletState({
            address: ADDRESS,
            isConnected: true,
            chainId: 8453,
            expectedChainId: 8453,
        })).toMatchObject({
            chainId: 8453,
            isCorrectNetwork: true,
        })

        expect(normalizeWalletState({
            address: ADDRESS,
            isConnected: true,
            chainId: 56,
            expectedChainId: 8453,
        })).toMatchObject({
            chainId: 56,
            isCorrectNetwork: false,
        })
    })

    it('keeps BSC as the compatibility default', () => {
        expect(normalizeWalletState({
            address: ADDRESS,
            isConnected: true,
            chainId: 56,
        }).isCorrectNetwork).toBe(true)
    })
})
