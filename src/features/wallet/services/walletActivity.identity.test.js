// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
    recordWalletActivity,
    readWalletActivity,
    transitionExistingWalletActivity,
} from './walletActivity.js'

const walletAddress = '0x3333333333333333333333333333333333333333'
const hash = `0x${'a'.repeat(64)}`
const otherHash = `0x${'b'.repeat(64)}`
const polygonUsdc = {
    chainId: 137, address: '0x1111111111111111111111111111111111111111',
    symbol: 'USDC', decimals: 6,
}
const baseUsdc = {
    chainId: 8453, address: '0x2222222222222222222222222222222222222222',
    symbol: 'USDC', decimals: 6,
}

afterEach(() => localStorage.clear())

describe('submitted swap identity', () => {
    it('never reassigns an existing receipt hash to the newly selected token amounts or current time', () => {
        const first = {
            walletAddress, chainId: 137, destinationChainId: 8453, hash,
            timestamp: '2026-11-09T04:51:00.000Z',
            type: 'swapped', status: 'pending', provider: 'Gas Assist',
            sellToken: polygonUsdc, buyToken: baseUsdc,
            sellAmount: '1.4', buyAmount: '1.393304',
        }
        recordWalletActivity(first)
        recordWalletActivity({
            ...first,
            timestamp: '2026-11-09T06:22:00.000Z',
            sellToken: baseUsdc, buyToken: polygonUsdc,
            sellAmount: '1.2', buyAmount: '1.187993',
        })
        expect(readWalletActivity({ walletAddress })).toEqual([
            expect.objectContaining({
                hash, status: 'pending',
                timestamp: first.timestamp,
                sellAmount: '1.4', buyAmount: '1.393304',
                chainId: 137, destinationChainId: 8453,
                sellToken: expect.objectContaining({ address: polygonUsdc.address }),
                buyToken: expect.objectContaining({ address: baseUsdc.address }),
            }),
        ])
    })

    it('advances only the existing chain and receipt without synthesizing activity', () => {
        expect(transitionExistingWalletActivity({
            walletAddress, chainId: 137, transactionHash: otherHash,
            status: 'confirmed',
        })).toBeNull()
        expect(readWalletActivity({ walletAddress })).toHaveLength(0)

        recordWalletActivity({
            walletAddress, chainId: 137, destinationChainId: 8453,
            hash, type: 'swapped', status: 'pending',
            sellToken: polygonUsdc, buyToken: baseUsdc,
            sellAmount: '1.35', buyAmount: '1.337088',
            timestamp: '2026-11-09T06:22:00.000Z',
        })
        transitionExistingWalletActivity({
            walletAddress, chainId: 137, transactionHash: hash,
            status: 'source-confirmed',
        })
        expect(readWalletActivity({ walletAddress })[0]).toMatchObject({
            status: 'source-confirmed', sellAmount: '1.35',
        })
        transitionExistingWalletActivity({
            walletAddress, chainId: 137, transactionHash: hash,
            status: 'confirmed',
        })
        recordWalletActivity({
            walletAddress, chainId: 137, hash,
            type: 'swapped', status: 'pending',
            sellToken: baseUsdc, buyToken: polygonUsdc,
            sellAmount: '99', buyAmount: '98',
        })
        expect(readWalletActivity({ walletAddress })).toEqual([
            expect.objectContaining({
                status: 'confirmed',
                sellAmount: '1.35',
                buyAmount: '1.337088',
                timestamp: '2026-11-09T06:22:00.000Z',
            }),
        ])
    })
})
