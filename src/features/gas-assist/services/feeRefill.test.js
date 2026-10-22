import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, encodeFunctionResult, erc20Abi, getAddress, keccak256 } from 'viem'
import { FEE_REFILL_ABI, feeRefillPolicyCalls, verifyFeeRefillDeployment } from './feeRefill.js'
import { encodeSelfHostedBatch, validateSelfHostedPrepared } from './selfHostedPaymaster.js'
const a = n => getAddress(`0x${n.toString(16).padStart(40, '0')}`)
function fixture() {
    const code = '0x6000'
    const plan = { settlement: a(5), codeHash: keccak256(code), chainId: 56, token: a(6), amountRaw: '100',
        router: a(7), spender: a(7), minimumNativeOutputRaw: '1000', deadline: Math.floor(Date.now() / 1000) + 60,
        routeData: '0x12345678', bundler: a(3), paymaster: a(2), treasury: a(4),
        thresholdWei: '6700000000000000', entryPoint: getAddress('0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108') }
    plan.expiresAt = new Date(plan.deadline * 1000).toISOString()
    const settings = { chainId: 56, entryPoint: plan.entryPoint, paymaster: a(2), delegate: a(10), feeRefill: plan }
    const order = { id: 'order', paymentToken: a(6), sellToken: a(6), paymentAmountRaw: '100', netSwapAmountRaw: '900', approvalSpender: a(8), treasuryAddress: a(4) }
    const approve = (spender, amount) => ({ target: a(6), value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) })
    const calls = [approve(a(5), 0n), approve(a(5), 100n), { target: a(5), value: 0n,
        data: encodeFunctionData({ abi: FEE_REFILL_ABI, functionName: 'settle', args: [a(6), 100n, a(7), a(7), 1000n, BigInt(plan.deadline), plan.routeData] }) },
        approve(a(5), 0n), approve(a(8), 0n), approve(a(8), 900n), { target: a(8), value: 0n, data: '0x12345678' }, approve(a(8), 0n)]
    const prepared = { provider: 'pistachio-paymaster-v08', execution: 'erc4337-v08-eip7702-direct',
        stage: 'direct', paymentMode: 'sponsored', chainId: 56, orderId: order.id,
        entryPoint: plan.entryPoint, paymaster: a(2), delegate: a(10), eip7702Factory: '0x7702000000000000000000000000000000000000',
        expiresAt: plan.expiresAt, pistachioFeeAmountRaw: '100', feeRefill: plan,
        transactions: calls.map(c => ({ to: c.target, data: c.data, value: '0x0' })) }
    return { code, plan, settings, order, calls, prepared }
}
describe('reviewed fee replenishment', () => {
    it('validates and encodes all eight calls without changing the user fee or swap principal', () => {
        const { calls, plan, order, settings, prepared } = fixture()
        expect(feeRefillPolicyCalls(calls, plan, settings, order)).toHaveLength(5)
        expect(validateSelfHostedPrepared(prepared, order, settings)).toEqual(calls)
        expect(encodeSelfHostedBatch(calls)).toMatch(/^0x/)
    })
    it.each(['settlement','bundler','treasury','paymaster','entryPoint','token'])('rejects changed %s', field => {
        const { calls, plan, order, settings } = fixture()
        expect(() => feeRefillPolicyCalls(calls, { ...plan, [field]: a(99) }, settings, order)).toThrow(/changed/)
    })
    it('rejects changed fee, missing metadata, extra calls, unlimited approval, and absent resets', () => {
        const { calls, plan, order, settings, prepared } = fixture()
        expect(() => feeRefillPolicyCalls(calls, { ...plan, amountRaw: '101' }, settings, order)).toThrow()
        expect(() => feeRefillPolicyCalls(calls, null, settings, order)).toThrow()
        expect(() => validateSelfHostedPrepared({ ...prepared, transactions: [...prepared.transactions, prepared.transactions[0]] }, order, settings)).toThrow()
        for (const index of [0, 1, 2, 3, 4, 5, 7]) {
            const changed = structuredClone(prepared)
            changed.transactions[index].data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [a(5), (1n << 256n) - 1n] })
            expect(() => validateSelfHostedPrepared(changed, order, settings)).toThrow()
        }
    })
    it('rejects expired routes, zero minimum output and native value in the account batch', () => {
        const { calls, plan, order, settings, prepared } = fixture()
        expect(() => feeRefillPolicyCalls(calls, { ...plan, deadline: 1 }, settings, order)).toThrow()
        expect(() => feeRefillPolicyCalls(calls, { ...plan, minimumNativeOutputRaw: '0' }, settings, order)).toThrow()
        prepared.transactions[2].value = '0x1'
        expect(() => validateSelfHostedPrepared(prepared, order, settings)).toThrow(/native/)
    })
    it('verifies on-chain code and immutable recipients before signing', async () => {
        const { code, plan } = fixture()
        const encoded = encodeFunctionResult({ abi: FEE_REFILL_ABI, functionName: 'settings',
            result: [plan.entryPoint, plan.paymaster, plan.bundler, plan.treasury, BigInt(plan.thresholdWei)] })
        const routeData = encodeFunctionData({ abi: FEE_REFILL_ABI, functionName: 'routeAllowed', args: [plan.router, plan.spender] })
        const allowed = encodeFunctionResult({ abi: FEE_REFILL_ABI, functionName: 'routeAllowed', result: true })
        const rpc = vi.fn(async (method, params) => method === 'eth_getCode' ? code : params[0].data === routeData ? allowed : encoded)
        await verifyFeeRefillDeployment(plan, rpc)
        expect(rpc).toHaveBeenCalledTimes(3)
        await expect(verifyFeeRefillDeployment({ ...plan, codeHash: keccak256('0x6001') }, rpc)).rejects.toThrow()
        await expect(verifyFeeRefillDeployment({ ...plan, treasury: a(99) }, rpc)).rejects.toThrow()
        rpc.mockImplementation(async (method, params) => method === 'eth_getCode' ? code : params[0].data === routeData
            ? encodeFunctionResult({ abi: FEE_REFILL_ABI, functionName: 'routeAllowed', result: false }) : encoded)
        await expect(verifyFeeRefillDeployment(plan, rpc)).rejects.toThrow()
    })
})
