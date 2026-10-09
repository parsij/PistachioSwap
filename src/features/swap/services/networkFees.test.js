import { describe, expect, it, vi } from 'vitest'
import { CURATED_EVM_CHAINS } from '../../../web3/curatedEvmChains.js'
import { fetchNetworkFees, fetchPendingNonce, networkFeeWarning, parseTransactionNonce, parseGwei, prepareNetworkFeeTransaction, resolveNetworkFeeSelection } from './networkFees.js'

function client(chainId = 10, legacy = false) {
    return { chain: { id: chainId }, getChainId: vi.fn().mockResolvedValue(chainId),
        getBlock: vi.fn().mockResolvedValue({ number: 100n, baseFeePerGas: legacy ? null : 100n }),
        estimateFeesPerGas: vi.fn().mockResolvedValue(legacy ? { gasPrice: 7n } : { maxFeePerGas: 122n, maxPriorityFeePerGas: 2n }),
        getFeeHistory: vi.fn().mockResolvedValue({ reward: [[1n, 3n, 8n], [1n, 3n, 8n], [1n, 3n, 8n]] }),
        getGasPrice: vi.fn().mockResolvedValue(7n), estimateGas: vi.fn().mockResolvedValue(100n),
        getTransactionCount: vi.fn().mockResolvedValue(0),
        getBalance: vi.fn().mockResolvedValue(10n ** 20n),
    }
}
const select = (chainId, fields) => ({ chainId, mode: 'custom', fields })

describe('live native network fees', () => {
    it.each(CURATED_EVM_CHAINS.map(chain => [chain.name, chain.id]))('binds live estimates to %s (%s)', async (_name, chainId) => {
        const rpc = client(chainId)
        const result = await fetchNetworkFees(rpc, chainId)
        expect(result.chainId).toBe(chainId)
        expect(rpc.getChainId).toHaveBeenCalledOnce()
        expect(result.presets.less).toEqual({ maxFeePerGas: 122n, maxPriorityFeePerGas: 2n })
        expect(result.presets.standard).toEqual({ maxFeePerGas: 153n, maxPriorityFeePerGas: 3n })
        expect(result.presets.high).toEqual({ maxFeePerGas: 208n, maxPriorityFeePerGas: 8n })
    })
    it('uses live legacy gas prices and does not invent priority fees', async () => {
        const result = await fetchNetworkFees(client(25, true), 25)
        expect(result.type).toBe('legacy')
        expect(result.presets.standard).toEqual({ gasPrice: 7n })
        expect(result.presets.high).toEqual({ gasPrice: 8n })
        expect(resolveNetworkFeeSelection(result, select(25, { gasPrice: 9n }), 25)).toEqual({ gasPrice: 9n })
    })
    it('keeps chain-specific recommended fees when history is unavailable', async () => {
        const rpc = client(137)
        rpc.getFeeHistory.mockRejectedValue(new Error('not supported'))
        rpc.estimateFeesPerGas.mockResolvedValue({ maxFeePerGas: 9_000_000n, maxPriorityFeePerGas: 8_000_000n })
        const result = await fetchNetworkFees(rpc, 137)
        expect(result.presets.less.maxPriorityFeePerGas).toBe(8_000_000n)
        expect(result.presets.high.maxFeePerGas).toBe(9_000_000n)
    })
    it('rejects wrong RPC/client networks and EIP-1559 estimator outages', async () => {
        const rpc = client()
        await expect(fetchNetworkFees(rpc, 8453)).rejects.toThrow('sell network')
        rpc.getChainId.mockResolvedValue(8453)
        await expect(fetchNetworkFees(rpc, 10)).rejects.toThrow('different network')
        rpc.getChainId.mockResolvedValue(10)
        rpc.estimateFeesPerGas.mockRejectedValue(new Error('RPC unavailable'))
        await expect(fetchNetworkFees(rpc, 10)).rejects.toThrow('priority fees are unavailable')
        expect(rpc.getGasPrice).not.toHaveBeenCalled()
    })
    it('parses tiny fees exactly and rejects malformed or rounded values', () => {
        expect(parseGwei('0.000000001')).toBe(1n)
        expect(parseGwei('0', { allowZero: true })).toBe(0n)
        expect(parseGwei('2.15')).toBe(2_150_000_000n)
        for (const invalid of ['0', '-1', 'NaN', '1e3', '0.0000000001', '', '1.2.3', '9'.repeat(70)]) {
            expect(() => parseGwei(invalid)).toThrow()
        }
    })
    it('validates chain, staleness and priority/max relationship without requiring the full tip', async () => {
        const snapshot = await fetchNetworkFees(client(), 10, () => 1000)
        const fields = { maxFeePerGas: 150n, maxPriorityFeePerGas: 2n }
        expect(() => resolveNetworkFeeSelection(snapshot, select(10, fields), 8453, 1000)).toThrow('expired')
        expect(() => resolveNetworkFeeSelection(snapshot, select(10, fields), 10, 46001)).toThrow('expired')
        expect(() => resolveNetworkFeeSelection(snapshot, select(8453, fields), 10, 1000)).toThrow('sell network')
        expect(() => resolveNetworkFeeSelection(snapshot, select(10, { maxFeePerGas: 150n, maxPriorityFeePerGas: 151n }), 10, 1000)).toThrow('cannot exceed')
        const clipped = { maxFeePerGas: 101n, maxPriorityFeePerGas: 2n }
        expect(resolveNetworkFeeSelection(snapshot, select(10, clipped), 10, 1000)).toEqual(clipped)
        expect(networkFeeWarning(snapshot, clipped)).toContain('reduce the priority fee')
        expect(() => resolveNetworkFeeSelection(snapshot, select(10, { ...fields, gasPrice: 1n }), 10, 1000)).toThrow('valid maximum')
    })
    it('accepts the screenshot low cap exactly, warns about inclusion and estimates without underpriced fees', async () => {
        const rpc = client(1)
        rpc.getBlock.mockResolvedValue({ number: 100n, baseFeePerGas: parseGwei('0.128105061') })
        const snapshot = await fetchNetworkFees(rpc, 1)
        const fields = { maxFeePerGas: parseGwei('0.102553251'), maxPriorityFeePerGas: parseGwei('0.01') }
        expect(resolveNetworkFeeSelection(snapshot, select(1, fields), 1)).toEqual(fields)
        expect(networkFeeWarning(snapshot, fields)).toContain('below the current base fee')
        expect(networkFeeWarning({ ...snapshot, type: 'legacy' }, { gasPrice: 1n })).toBeNull()
        rpc.estimateGas.mockImplementation(async request => {
            if (request.maxFeePerGas < snapshot.baseFeePerGas) throw new Error('max fee less than block base fee')
            return 100n
        })
        const transaction = { to: '0x0000000000000000000000000000000000000001', data: '0x1234', value: 8n,
            maxFeePerGas: 999n, maxPriorityFeePerGas: 1n, gasPrice: 999n }
        const result = await prepareNetworkFeeTransaction({ publicClient: rpc, transaction, account: transaction.to,
            snapshot, selection: select(1, fields), chainId: 1 })
        expect(rpc.estimateGas).toHaveBeenCalledWith({ to: transaction.to, data: '0x1234', value: 8n, account: transaction.to })
        expect(result).toEqual({ to: transaction.to, data: '0x1234', value: 8n, gas: 120n, ...fields })
    })
    it('uses only validated custom fields, preserves simulated gas and checks native affordability', async () => {
        const rpc = client()
        const snapshot = await fetchNetworkFees(rpc, 10)
        const transaction = { to: '0x0000000000000000000000000000000000000001', data: '0x1234', value: 8n, gas: 100n, chainId: 10, gasPrice: 999n }
        const fields = { maxFeePerGas: 150n, maxPriorityFeePerGas: 2n, to: 'bad', value: 12345n, gas: 1n }
        const result = await prepareNetworkFeeTransaction({ publicClient: rpc, transaction, account: transaction.to, snapshot, selection: select(10, fields), chainId: 10 })
        expect(result).toEqual({ to: transaction.to, data: '0x1234', value: 8n, gas: 100n, chainId: 10, maxFeePerGas: 150n, maxPriorityFeePerGas: 2n })
        expect(rpc.estimateGas).not.toHaveBeenCalled()
        rpc.getBalance.mockResolvedValue(15007n)
        await expect(prepareNetworkFeeTransaction({ publicClient: rpc, transaction, account: transaction.to, snapshot, selection: select(10, fields), chainId: 10 })).rejects.toThrow('Insufficient native balance')
    })
    it('accepts automatic and nonce zero without rounding invalid input', () => {
        expect(parseTransactionNonce('')).toBeUndefined()
        expect(parseTransactionNonce('  ')).toBeUndefined()
        expect(parseTransactionNonce('0')).toBe(0)
        expect(parseTransactionNonce('42')).toBe(42)
        expect(parseTransactionNonce('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
        for (const value of ['-1', '1.5', '1e3', 'NaN', '0x10', '9007199254740992', '9'.repeat(100)]) {
            expect(() => parseTransactionNonce(value)).toThrow('whole-number nonce')
        }
    })
    it('reads the pending nonce from the selected account and rejects a different RPC chain', async () => {
        const rpc = client(10)
        const account = '0x0000000000000000000000000000000000000001'
        rpc.getTransactionCount.mockResolvedValue(7)
        expect(await fetchPendingNonce(rpc, 10, account)).toBe(7)
        expect(rpc.getTransactionCount).toHaveBeenCalledWith({ address: account, blockTag: 'pending' })
        rpc.getChainId.mockResolvedValue(8453)
        await expect(fetchPendingNonce(rpc, 10, account)).rejects.toThrow('sell network')
        expect(rpc.getTransactionCount).toHaveBeenCalledTimes(1)
    })
    it.each([0, 7, 10])('submits explicit nonce %s, including replacements and queued transactions', async nonce => {
        const rpc = client(10)
        rpc.getTransactionCount.mockResolvedValue(0)
        const snapshot = await fetchNetworkFees(rpc, 10)
        const result = await prepareNetworkFeeTransaction({ publicClient: rpc, chainId: 10, account: 'wallet',
            transaction: { gas: 100n, data: '0x1234' }, snapshot,
            selection: select(10, { ...snapshot.presets.standard, nonce }) })
        expect(result.nonce).toBe(nonce)
        expect(result.data).toBe('0x1234')
        expect(rpc.getTransactionCount).toHaveBeenCalledWith({ address: 'wallet', blockTag: 'latest' })
    })
    it('rejects mined nonces and leaves approvals or blank nonces automatic', async () => {
        const rpc = client(10)
        rpc.getTransactionCount.mockResolvedValue(8)
        const snapshot = await fetchNetworkFees(rpc, 10)
        const options = { publicClient: rpc, chainId: 10, account: 'wallet', transaction: { gas: 100n }, snapshot,
            selection: select(10, { ...snapshot.presets.standard, nonce: 7 }) }
        await expect(prepareNetworkFeeTransaction(options)).rejects.toThrow('already been used')
        const approval = await prepareNetworkFeeTransaction({ ...options, applyNonce: false })
        expect(approval).not.toHaveProperty('nonce')
        const automatic = await prepareNetworkFeeTransaction({ ...options, selection: select(10, snapshot.presets.standard) })
        expect(automatic).not.toHaveProperty('nonce')
        expect(rpc.getTransactionCount).toHaveBeenCalledTimes(1)
        rpc.getTransactionCount.mockResolvedValue(undefined)
        await expect(prepareNetworkFeeTransaction(options)).rejects.toThrow('Cannot verify')
    })

})
