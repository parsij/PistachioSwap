import { describe, expect, it } from 'vitest'
import { mergeWalletActivity } from './mergeWalletActivity.js'
import { normalizeWalletActivity } from './walletActivity.js'

const walletAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const base = { walletAddress, chainId: 56, hash: `0x${'a'.repeat(64)}`, timestamp: '2026-09-01T00:00:00Z' }
describe('wallet history merge', () => {
    it('keeps a local swap when the provider calls the same transaction a send', () => {
        const local = normalizeWalletActivity({ ...base, type: 'swapped', sellAmount: '2', sellToken: { symbol: 'A' } })
        const remote = normalizeWalletActivity({ ...base, chainId: '56', hash: base.hash.toUpperCase(), type: 'sent', source: 'remote', blockNumber: '123' })
        const merged = mergeWalletActivity([local], [remote])
        expect(merged).toHaveLength(1)
        expect(merged[0]).toMatchObject({ type: 'swapped', source: 'merged', sellAmount: '2', blockNumber: '123' })
    })
    it('lets authoritative failure evidence override a local successful swap', () => {
        expect(mergeWalletActivity([{ ...base, type: 'swapped' }], [{ ...base, type: 'contract', source: 'remote', status: 'failed' }])[0].type).toBe('contract')
    })
    it('sorts newest first and keeps identical hashes on separate chains', () => {
        const result = mergeWalletActivity([{ ...base, type: 'sent' }], [{ ...base, chainId: 1, type: 'sent', timestamp: '2026-09-02T00:00:00Z' }])
        expect(result.map(item => item.chainId)).toEqual([1, 56])
    })
})
