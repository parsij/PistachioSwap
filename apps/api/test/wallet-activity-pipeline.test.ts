import { describe, expect, it, vi, beforeEach } from 'vitest'
import { encodeFunctionData, erc20Abi, toEventSelector } from 'viem'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), batch: vi.fn(), moralis: vi.fn() }))
vi.mock('../src/providers/alchemy/alchemy-client.js', () => ({ alchemyRpc: mocks.rpc, alchemyRpcBatch: mocks.batch }))
vi.mock('../src/providers/moralis/wallet-history.js', () => ({ moralisWalletHistoryRequest: mocks.moralis }))
vi.mock('../src/providers/alchemy/wallet-tokens.js', () => ({ getWalletTokens: async () => [] }))
vi.mock('../src/token-discovery/fallback-token-catalog.js', () => ({ getFallbackTokensForChain: async () => [] }))

import Fastify from 'fastify'
import { walletActivityInternals, walletActivityRoutes } from '../src/modules/wallet-activity.js'
import { alchemyWalletHistoryRequest, receiptHistoryRow } from '../src/providers/alchemy/wallet-history.js'

const wallet = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const router = '0x0000000000000000000000000000000000000002'
const tokenA = '0x0000000000000000000000000000000000000003'
const tokenB = '0x0000000000000000000000000000000000000004'
const hash = `0x${'1'.repeat(64)}`
const transfer = (incoming = false, address = incoming ? tokenB : tokenA, value = '1000000') => ({
    address, token_decimals: 6, value, value_formatted: '1',
    from_address: incoming ? router : wallet, to_address: incoming ? wallet : router,
})
const row = (overrides = {}) => ({ hash, from_address: wallet, to_address: router,
    receipt_status: '1', block_timestamp: '2026-09-01T00:00:00Z', category: 'Send',
    input: '0x12345678', erc20_transfers: [], ...overrides })
const normalize = (overrides = {}, address = wallet) => walletActivityInternals.normalizeMoralisActivity(56, address, row(overrides))

describe('receipt-backed wallet classification', () => {
    it.each(['swap', 'Send', 'contract interaction'])('classifies %s from actual swap flows', category => {
        expect(normalize({ category, swap_evidence: true, erc20_transfers: [transfer(), transfer(true)] })?.type).toBe('swapped')
    })
    it.each(['0x517b6c94da086f3f69dc725d7d70cdba7c4a9b62', '0x21331d393a0622eeddffce3e9db29448b6110bc6'])('recognizes delegated Gas Assist %s only with flows', executor => {
        const base = { to_address: wallet, authorization_list: [{ address: executor }] }
        expect(normalize({ ...base, erc20_transfers: [transfer(), transfer(true)] })?.type).toBe('swapped')
        expect(normalize(base)?.type).toBe('contract')
    })
    it.each([false, true])('retains plain ERC20 movement incoming=%s', incoming => {
        expect(normalize({ from_address: incoming ? router : wallet, erc20_transfers: [transfer(incoming)] })?.type).toBe(incoming ? 'received' : 'sent')
    })
    it.each([false, true])('retains native BNB movement incoming=%s', incoming => {
        expect(normalize({ from_address: incoming ? router : wallet, to_address: incoming ? wallet : router,
            value: '1000000000000000000', input: '0x' })?.type).toBe(incoming ? 'received' : 'sent')
    })
    it('decodes approval without relying on label', () => {
        expect(normalize({ to_address: tokenA, input: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [router, 1n] }) })?.type).toBe('approved')
    })
    it('does not infer swaps from random calls, self transfers or failed receipts', () => {
        expect(normalize()?.type).toBe('contract')
        expect(normalize({ to_address: wallet, erc20_transfers: [{ ...transfer(), to_address: wallet }], category: 'swap' })?.type).toBe('contract')
        expect(normalize({ receipt_status: '0', swap_evidence: true, erc20_transfers: [transfer(), transfer(true)] })).toBeNull()
    })
    it('normalizes checksum casing and does not trust a contradictory direction label', () => {
        expect(normalize({ erc20_transfers: [{ ...transfer(), direction: 'incoming' }] }, wallet.toUpperCase().replace('0X', '0x'))?.type).toBe('sent')
    })
    it('keeps missing token metadata and does not round large amounts', () => {
        const item = normalize({ swap_evidence: true, erc20_transfers: [
            { ...transfer(), value: '9007199254740993123456', token_symbol: null, token_logo: null }, transfer(true),
        ] })
        expect(item?.sellAmount).toBe('9007199254740993.123456')
        expect(item?.type).toBe('swapped')
    })
    it('nets refunds and aggregates same-token logs', () => {
        expect(normalize({ swap_evidence: true, erc20_transfers: [transfer(), transfer(), transfer(true, tokenA, '500000'), transfer(true)] })?.sellAmount).toBe('1.5')
    })
    it('rejects forged outbound logs from an untrusted token when the wallet did not initiate the transaction', () => {
        const item = normalize({ from_address: router, erc20_transfers: [transfer()] })!
        expect(walletActivityInternals.activityPassesTrustPolicy(item, new Map())).toBe(false)
    })
    it('does not treat wrapping BNB as exchanging materially different assets', () => {
        expect(normalize({ swap_evidence: true, value: '1000000000000000000',
            erc20_transfers: [transfer(true, '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c')],
        })?.type).not.toBe('swapped')
    })
})

describe('history discovery and API fallback', () => {
    beforeEach(() => vi.resetAllMocks())
    it('follows page 2 and obtains all transaction flows from receipt logs', async () => {
        const indexed = { uniqueId: 'log:1', hash, blockNum: '0x1', category: 'erc20', rawContract: { address: tokenA, decimal: '0x6' }, metadata: { blockTimestamp: '2026-09-01T00:00:00Z' } }
        mocks.rpc.mockImplementation(async ({ params }) => params[0].fromAddress && params[0].category[0] === 'external'
            ? params[0].pageKey ? { transfers: [indexed] } : { transfers: [], pageKey: 'page-two' }
            : { transfers: [] })
        const topic = (address: string) => `0x${address.slice(2).padStart(64, '0')}`
        const receipt = { status: '0x1', logs: [
            { address: tokenB, topics: [toEventSelector('Transfer(address,address,uint256)'), topic(router), topic(wallet)], data: '0x01' },
        ] }
        mocks.batch.mockResolvedValue(new Map([
            [`${hash}:tx`, { result: { hash, from: wallet, to: router, value: '0x0', blockNumber: '0x1' } }],
            [`${hash}:receipt`, { result: receipt }],
        ]))
        const result = await alchemyWalletHistoryRequest({ chainId: 56, walletAddress: wallet })
        expect(result.result).toHaveLength(1)
        expect(result.result[0].erc20_transfers[0]).toMatchObject({ address: tokenB, value: '1', token_decimals: null })
        expect(mocks.rpc).toHaveBeenCalledTimes(5)
    })
    it('fails explicitly on repeated cursors', async () => {
        mocks.rpc.mockResolvedValue({ transfers: [], pageKey: 'repeated' })
        await expect(alchemyWalletHistoryRequest({ chainId: 56, walletAddress: wallet })).rejects.toThrow()
        expect(mocks.rpc).toHaveBeenCalledTimes(2)
    })
    it('paginates Moralis and retains page-two activity', async () => {
        mocks.moralis.mockResolvedValueOnce({ result: [], cursor: 'next' })
            .mockResolvedValueOnce({ result: [row({ erc20_transfers: [transfer()] })] })
        const app = Fastify()
        await app.register(walletActivityRoutes)
        try {
            const response = await app.inject(`/v1/wallet-activity?address=${wallet}&chainIds=56`)
            expect(response.json().items).toHaveLength(1)
            expect(mocks.moralis.mock.calls[1][0].cursor).toBe('next')
        } finally { await app.close() }
    })
    it('uses Alchemy when Moralis is paused and does not silently return empty history on total failure', async () => {
        mocks.moralis.mockRejectedValue(new Error('paused'))
        mocks.rpc.mockResolvedValue({ transfers: [] })
        const app = Fastify()
        await app.register(walletActivityRoutes)
        try {
            const response = await app.inject(`/v1/wallet-activity?address=${wallet}&chainIds=56`)
            expect(response.json().source).toBe('alchemy-receipts')
            mocks.rpc.mockRejectedValue(new Error('unavailable'))
            expect((await app.inject(`/v1/wallet-activity?address=${wallet}&chainIds=56`)).statusCode).toBe(503)
        } finally { await app.close() }
    })
    it('checks receipt evidence when Moralis itself mislabels a two-sided swap as Send', async () => {
        mocks.moralis.mockResolvedValue({ result: [row({ erc20_transfers: [transfer(), transfer(true)] })] })
        mocks.batch.mockResolvedValue(new Map([[hash, { result: { status: '0x1', logs: [
            { topics: [toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)')] },
        ] } }]]))
        const app = Fastify()
        await app.register(walletActivityRoutes)
        try {
            const response = await app.inject(`/v1/wallet-activity?address=${wallet}&chainIds=56`)
            expect(response.json().items[0].type).toBe('swapped')
            expect(response.json().source).toBe('moralis-wallet-history')
        } finally { await app.close() }
    })
    it('retains Moralis history and reports incomplete verification when supplemental RPC fails', async () => {
        mocks.moralis.mockResolvedValue({ result: [row({ erc20_transfers: [transfer(), transfer(true)] })] })
        mocks.batch.mockRejectedValue(new Error('Receipt service unavailable'))
        const app = Fastify()
        await app.register(walletActivityRoutes)
        try {
            const response = await app.inject(`/v1/wallet-activity?address=${wallet}&chainIds=56`)
            expect(response.statusCode).toBe(200)
            expect(response.json()).toMatchObject({ partial: true, source: 'moralis-wallet-history', items: [{ hash }] })
            expect(response.json().coverage[0].limitations).toContain('swap-receipt-verification-unavailable')
            expect(mocks.rpc).not.toHaveBeenCalled()
        } finally { await app.close() }
    })
    it('builds one transaction from multiple logs and ignores NFT Transfer events', () => {
        const result = receiptHistoryRow({ hash, from: wallet, value: '0x0' }, { status: '0x1', logs: [
            { address: tokenA, topics: [toEventSelector('Transfer(address,address,uint256)'), '0x0', '0x0', '0x1'], data: '0x' },
        ] }, [], wallet)
        expect(result.erc20_transfers).toEqual([])
    })
})
