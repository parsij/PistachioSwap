// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
    dismissPendingUserOperation,
    pendingUserOperations,
    persistPendingUserOperation,
    removePendingUserOperation,
} from './pendingUserOperations.js'

const wallet = '0x1111111111111111111111111111111111111111'
const base = {
    orderId: 'order-1',
    walletAddress: wallet,
    chainId: 137,
    userOpHash: `0x${'ab'.repeat(32)}`,
    routeId: '11111111-1111-4111-8111-111111111111',
    timestamp: Date.now(),
}
const reviewDisplay = {
    grossInputAmountRaw: '1200000',
    expectedOutputRaw: '1193997',
    paymentAmountRaw: '3954',
    sellTokenDecimals: 6,
    buyTokenDecimals: 6,
    paymentTokenDecimals: 6,
    sellTokenSymbol: 'USDC',
    buyTokenSymbol: 'USDC',
    paymentTokenSymbol: 'USDC',
    totalPrepaymentUsdMicros: '3954',
    sellTokenChainId: 137,
    sellTokenAddress: '0x3333333333333333333333333333333333333333',
    sellTokenLogoURI: '/icons/usdc.svg',
    buyTokenChainId: 8453,
    buyTokenAddress: '0x4444444444444444444444444444444444444444',
    buyTokenLogoURI: 'https://assets.example.com/usdt.png',
}

afterEach(() => localStorage.clear())

describe('public operation recovery state', () => {
    it('preserves final reviewed amounts and a deliberate dismiss across hash updates', () => {
        const initial = persistPendingUserOperation({ ...base, reviewDisplay, ambiguous: true })
        expect(pendingUserOperations(wallet)[0].reviewDisplay).toEqual(reviewDisplay)
        expect(dismissPendingUserOperation(base.orderId, wallet)).toBe(true)
        const persisted = pendingUserOperations(wallet)[0]
        expect(persisted.dismissed).toBe(true)

        // A late bundler acknowledgement may still hold a stale snapshot.
        persistPendingUserOperation({ ...initial, ambiguous: false })
        expect(pendingUserOperations(wallet)).toEqual([
            expect.objectContaining({
                orderId: base.orderId,
                userOpHash: base.userOpHash,
                reviewDisplay,
                dismissed: true,
                ambiguous: false,
            }),
        ])
        removePendingUserOperation(base.orderId)
        expect(pendingUserOperations(wallet)).toHaveLength(0)
    })

    it('cannot dismiss another wallet or change any transaction data', () => {
        persistPendingUserOperation(base)
        expect(dismissPendingUserOperation(base.orderId,
            '0x2222222222222222222222222222222222222222')).toBe(false)
        expect(pendingUserOperations(wallet)[0]).toMatchObject({
            dismissed: false,
            userOpHash: base.userOpHash,
            orderId: base.orderId,
        })
    })

    it('drops malformed display data without losing the public recovery identifiers', () => {
        const entry = persistPendingUserOperation({
            ...base,
            reviewDisplay: { ...reviewDisplay, paymentAmountRaw: '<script>alert(1)</script>' },
        })
        expect(entry.reviewDisplay).toBeNull()
        expect(pendingUserOperations(wallet)[0].orderId).toBe(base.orderId)
    })

    it('rejects unsafe or mismatched icon data without losing the amounts', () => {
        const entry = persistPendingUserOperation({
            ...base,
            reviewDisplay: {
                ...reviewDisplay,
                sellTokenAddress: '0xwrong',
                sellTokenLogoURI: 'https://assets.example.com/wrong.svg',
                buyTokenLogoURI: 'javascript:alert(1)',
            },
        })
        expect(entry.reviewDisplay.grossInputAmountRaw).toBe('1200000')
        expect(entry.reviewDisplay.sellTokenAddress).toBeUndefined()
        expect(entry.reviewDisplay.sellTokenChainId).toBeUndefined()
        expect(entry.reviewDisplay.sellTokenLogoURI).toBeUndefined()
        expect(entry.reviewDisplay.buyTokenAddress).toBe(reviewDisplay.buyTokenAddress)
        expect(entry.reviewDisplay.buyTokenLogoURI).toBeUndefined()
    })

    it('supports legacy display snapshots without token identity', () => {
        const legacy = Object.fromEntries(Object.entries(reviewDisplay)
            .filter(([key]) => !/^(sell|buy)Token(ChainId|Address|LogoURI)$/.test(key)))
        localStorage.setItem('pistachioswap:pending-userops:v1', JSON.stringify([
            { ...base, reviewDisplay: legacy },
        ]))
        expect(pendingUserOperations(wallet)[0].reviewDisplay).toEqual(legacy)
    })

    it('supports old pending operations that do not have display fields', () => {
        localStorage.setItem('pistachioswap:pending-userops:v1', JSON.stringify([base]))
        expect(pendingUserOperations(wallet)[0]).toMatchObject({
            dismissed: false, reviewDisplay: null, orderId: base.orderId,
        })
    })
})
