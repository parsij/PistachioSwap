import { describe, expect, it } from 'vitest'

import {
    getPrimaryActionPresentation,
    getWalletBalanceNotice,
} from './swapViewModel.js'

describe('getWalletBalanceNotice', () => {
    it('does not surface unrelated all-chain refresh failures on the active swap card', () => {
        expect(getWalletBalanceNotice({
            activeChainId: 56,
            backendWalletTokens: [{ chainId: 56 }],
            walletTokenFailedChainIds: [25, 146, 204, 1088, 1284, 5000, 34443, 167000],
        })).toBeNull()
    })

    it('surfaces a refresh failure when the active swap network itself failed', () => {
        expect(getWalletBalanceNotice({
            activeChainId: 56,
            backendWalletTokens: [{ chainId: 56 }],
            walletTokenFailedChainIds: [25, 56, 146],
        })).toBe('Some network balances could not be refreshed: BNB Smart Chain.')
    })

    it('preserves full wallet-load and stale-balance notices', () => {
        expect(getWalletBalanceNotice({
            activeChainId: 56,
            walletTokenError: 'upstream failed',
            backendWalletTokens: [],
        })).toBe('Wallet balances could not be loaded.')

        expect(getWalletBalanceNotice({
            activeChainId: 56,
            walletTokenStale: true,
            backendWalletTokens: [{ chainId: 56 }],
            walletTokenFailedChainIds: [56],
        })).toBe('Showing previously loaded balances.')
    })
})

describe('getPrimaryActionPresentation', () => {
    const reviewAction = {
        type: 'swap',
        label: 'Review Gas Assisted Swap',
        enabled: true,
    }

    it('shows a disabled progress action while the Gas Assist review is opening', () => {
        expect(getPrimaryActionPresentation({
            action: reviewAction,
            crossChainGasAssistExpected: true,
            crossChainGasAssistStatus: 'loading',
        })).toEqual({
            type: 'gas-assist-loading',
            label: 'Preparing Gas Assist…',
            enabled: false,
            loading: true,
        })
    })

    it('preserves the normal action outside cross-chain Gas Assist loading', () => {
        expect(getPrimaryActionPresentation({
            action: reviewAction,
            crossChainGasAssistExpected: true,
            crossChainGasAssistStatus: 'success',
        })).toBe(reviewAction)
    })
})
