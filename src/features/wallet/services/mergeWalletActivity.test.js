import { describe, expect, it } from 'vitest'
import { mergeWalletActivity } from './mergeWalletActivity.js'
import { normalizeWalletActivity } from './walletActivity.js'

const walletAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const base = { walletAddress, chainId: 56, hash: `0x${'a'.repeat(64)}`, timestamp: '2026-09-01T00:00:00Z' }
const tokenA = '0x1111111111111111111111111111111111111111'
const tokenB = '0x2222222222222222222222222222222222222222'
const routerA = '0x3333333333333333333333333333333333333333'
const routerB = '0x4444444444444444444444444444444444444444'

describe('wallet history merge', () => {
    it('keeps a local swap when the provider calls the same transaction a send', () => {
        const local = normalizeWalletActivity({ ...base, type: 'swapped', sellAmount: '2', sellToken: { symbol: 'A' } })
        const remote = normalizeWalletActivity({ ...base, chainId: '56', hash: base.hash.toUpperCase(), type: 'sent', source: 'remote', blockNumber: '123' })
        const merged = mergeWalletActivity([local], [remote])
        expect(merged).toHaveLength(1)
        expect(merged[0]).toMatchObject({ type: 'swapped', source: 'merged', sellAmount: '2', blockNumber: '123' })
    })

    it('shows a submitted semantic swap as confirmed when its on-chain receipt is confirmed', () => {
        const local = normalizeWalletActivity({
            ...base, chainId: 8453, type: 'swapped', status: 'pending',
            sellToken: { symbol: 'CBBTC' }, buyToken: { symbol: 'USDT' },
            sellAmount: '0.000004', buyAmount: '0.398659',
        })
        const remote = normalizeWalletActivity({
            ...base, chainId: 8453, type: 'sent', status: 'confirmed',
            source: 'remote', blockNumber: '456',
        })
        const [activity] = mergeWalletActivity([local], [remote])
        expect(activity).toMatchObject({
            type: 'swapped', status: 'confirmed', sellAmount: '0.000004',
            buyAmount: '0.398659', blockNumber: '456',
        })
    })

    it('labels a cross-chain source receipt as source-confirmed, not a complete bridge', () => {
        const local = normalizeWalletActivity({
            ...base, chainId: 56, destinationChainId: 8453,
            type: 'swapped', status: 'pending', sellAmount: '1',
        })
        const source = normalizeWalletActivity({
            ...base, type: 'sent', status: 'confirmed', source: 'remote',
        })
        expect(mergeWalletActivity([local], [source])[0]).toMatchObject({
            type: 'swapped', status: 'source-confirmed', destinationChainId: 8453,
        })
    })

    it('never hides destination receipts merely because a source-only swap is still pending', () => {
        const swap = normalizeWalletActivity({
            ...base, destinationChainId: 8453,
            type: 'swapped', status: 'source-confirmed',
            buyToken: { address: tokenB, symbol: 'USDC', decimals: 6 },
            buyAmount: '1.337088',
        })
        const received = normalizeWalletActivity({
            ...base, chainId: 8453, hash: `0x${'b'.repeat(64)}`,
            type: 'received', status: 'confirmed',
            token: { address: tokenB, symbol: 'USDC', decimals: 6 },
            amount: '1.337088', timestamp: '2026-09-01T00:00:25Z',
        })
        expect(mergeWalletActivity([swap], [received])).toHaveLength(2)
    })

    it('lets authoritative failure evidence override a local successful swap', () => {
        expect(mergeWalletActivity([{ ...base, type: 'swapped' }], [{ ...base, type: 'contract', source: 'remote', status: 'failed' }])[0].type).toBe('contract')
    })

    it('sorts newest first and keeps identical hashes on separate chains', () => {
        const result = mergeWalletActivity([{ ...base, type: 'sent' }], [{ ...base, chainId: 1, type: 'sent', timestamp: '2026-09-02T00:00:00Z' }])
        expect(result.map(item => item.chainId)).toEqual([1, 56])
    })

    it('suppresses a destination receive already represented by a semantic cross-chain swap', () => {
        const swap = normalizeWalletActivity({
            ...base,
            type: 'swapped',
            destinationChainId: 8453,
            sellToken: { address: tokenA, symbol: 'USDD', decimals: 18 },
            buyToken: { address: tokenB, symbol: 'USDC', decimals: 6 },
            sellAmount: '0.137938',
            buyAmount: '0.11291',
            source: 'local',
        })
        const destinationReceive = normalizeWalletActivity({
            ...base,
            id: '8453:receive',
            hash: `0x${'b'.repeat(64)}`,
            chainId: 8453,
            type: 'received',
            token: { address: tokenB, symbol: 'USDC', decimals: 6 },
            amount: '0.11291',
            source: 'remote',
            timestamp: '2026-09-01T00:00:20Z',
            to: routerB,
        })

        const merged = mergeWalletActivity([swap], [destinationReceive])
        expect(merged).toHaveLength(1)
        expect(merged[0]).toMatchObject({
            type: 'swapped',
            destinationChainId: 8453,
            sellAmount: '0.137938',
            buyAmount: '0.11291',
        })
    })

    it('collapses historical cross-chain contract send and receive into one swap', () => {
        const sent = normalizeWalletActivity({
            ...base,
            type: 'sent',
            token: { address: tokenA, symbol: 'USDD', decimals: 18 },
            amount: '0.137938',
            source: 'remote',
            to: routerA,
        })
        const received = normalizeWalletActivity({
            ...base,
            id: '8453:receive',
            hash: `0x${'c'.repeat(64)}`,
            chainId: 8453,
            type: 'received',
            token: { address: tokenB, symbol: 'USDC', decimals: 6 },
            amount: '0.11291',
            source: 'remote',
            timestamp: '2026-09-01T00:00:35Z',
            to: routerB,
        })

        const merged = mergeWalletActivity([], [sent, received])
        expect(merged).toHaveLength(1)
        expect(merged[0]).toMatchObject({
            type: 'swapped',
            chainId: 56,
            destinationChainId: 8453,
            sellAmount: '0.137938',
            buyAmount: '0.11291',
            provider: 'Cross-chain',
        })
    })

    it('does not collapse an ordinary ERC20 send with an unrelated receive', () => {
        const sent = normalizeWalletActivity({
            ...base,
            type: 'sent',
            token: { address: tokenA, symbol: 'USDD', decimals: 18 },
            amount: '1',
            source: 'remote',
            to: tokenA,
        })
        const received = normalizeWalletActivity({
            ...base,
            hash: `0x${'d'.repeat(64)}`,
            chainId: 8453,
            type: 'received',
            token: { address: tokenB, symbol: 'USDC', decimals: 6 },
            amount: '1',
            source: 'remote',
            timestamp: '2026-09-01T00:00:30Z',
            to: routerB,
        })

        expect(mergeWalletActivity([], [sent, received])).toHaveLength(2)
    })
})
