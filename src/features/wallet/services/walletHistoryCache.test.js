// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import {
    deleteWalletHistoryCache,
    readWalletHistoryCache,
    writeWalletHistoryCache,
} from './walletHistoryCache.js'

const wallet = '0x0000000000000000000000000000000000000001'

beforeEach(async () => {
    await deleteWalletHistoryCache({ walletAddress: wallet, chainId: 56 })
    await deleteWalletHistoryCache({ walletAddress: wallet, chainId: 1 })
})

describe('walletHistoryCache', () => {
    it('persists activity and scan checkpoints per wallet and chain', async () => {
        const stored = await writeWalletHistoryCache({
            walletAddress: wallet,
            chainId: 56,
            activities: [{ hash: `0x${'11'.repeat(32)}`, type: 'sent' }],
            lastScannedBlock: 12345,
            lastRefreshAt: 987654,
            classifierVersion: 3,
            truncated: true,
        })
        expect(stored).toBe(true)

        expect(await readWalletHistoryCache({ walletAddress: wallet, chainId: 56 }))
            .toMatchObject({
                walletAddress: wallet,
                chainId: 56,
                lastScannedBlock: 12345,
                lastRefreshAt: 987654,
                classifierVersion: 3,
                truncated: true,
                activities: [{ type: 'sent' }],
            })
        expect(await readWalletHistoryCache({ walletAddress: wallet, chainId: 1 }))
            .toBeNull()
    })

    it('normalizes the wallet address in the cache key', async () => {
        await writeWalletHistoryCache({
            walletAddress: wallet.toUpperCase().replace('0X', '0x'),
            chainId: 56,
            activities: [],
            classifierVersion: 1,
        })
        expect(await readWalletHistoryCache({ walletAddress: wallet, chainId: 56 }))
            .not.toBeNull()
    })

    it('deletes one wallet-chain cache without affecting another', async () => {
        await writeWalletHistoryCache({
            walletAddress: wallet,
            chainId: 56,
            activities: [],
            classifierVersion: 1,
        })
        await writeWalletHistoryCache({
            walletAddress: wallet,
            chainId: 1,
            activities: [],
            classifierVersion: 1,
        })

        expect(await deleteWalletHistoryCache({ walletAddress: wallet, chainId: 56 }))
            .toBe(true)
        expect(await readWalletHistoryCache({ walletAddress: wallet, chainId: 56 }))
            .toBeNull()
        expect(await readWalletHistoryCache({ walletAddress: wallet, chainId: 1 }))
            .not.toBeNull()
    })
})
