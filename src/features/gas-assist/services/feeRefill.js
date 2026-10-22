import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi } from 'viem'

export const FEE_REFILL_ABI = parseAbi([
    'function settle(address token,uint256 amount,address router,address spender,uint256 minimumNativeOutput,uint256 deadline,bytes routeData)',
    'function settings() view returns (address,address,address,address,uint256)',
])
function reject() {
    throw Object.assign(new Error('The fee conversion or its funding destinations changed. Request a new quote.'), { code: 'PAYMASTER_FEE_REFILL_INVALID' })
}

/** Validate all eight calls, then expose a synthetic payment solely for legacy order checks. */
export function feeRefillPolicyCalls(calls, plan, settings, order) {
    if (!plan) { if (calls.length !== 5) reject(); return calls }
    try {
        const config = settings.feeRefill
        if (calls.length !== 8 || !config || Number(plan.chainId) !== Number(settings.chainId) ||
            getAddress(plan.settlement) !== getAddress(config.settlement) ||
            plan.codeHash.toLowerCase() !== config.codeHash.toLowerCase() ||
            getAddress(plan.paymaster) !== getAddress(settings.paymaster) ||
            getAddress(plan.entryPoint) !== getAddress(settings.entryPoint) ||
            getAddress(plan.bundler) !== getAddress(config.bundler) ||
            getAddress(plan.treasury) !== getAddress(config.treasury) ||
            BigInt(plan.thresholdWei) !== BigInt(config.thresholdWei) ||
            getAddress(plan.token) !== getAddress(order.paymentToken) ||
            BigInt(plan.amountRaw) !== BigInt(order.paymentAmountRaw) || BigInt(plan.amountRaw) <= 0n ||
            BigInt(plan.minimumNativeOutputRaw) <= 0n || !Number.isSafeInteger(plan.deadline) ||
            plan.deadline * 1000 <= Date.now() + 5_000 || !Number.isFinite(Date.parse(plan.expiresAt)) ||
            plan.deadline !== Math.floor(Date.parse(plan.expiresAt) / 1000)) reject()
        const approve = amount => encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [plan.settlement, amount] })
        const feeCalls = [
            { target: plan.token, data: approve(0n) },
            { target: plan.token, data: approve(BigInt(plan.amountRaw)) },
            { target: plan.settlement, data: encodeFunctionData({ abi: FEE_REFILL_ABI, functionName: 'settle', args: [
                plan.token, BigInt(plan.amountRaw), plan.router, plan.spender, BigInt(plan.minimumNativeOutputRaw), BigInt(plan.deadline), plan.routeData,
            ] }) },
            { target: plan.token, data: approve(0n) },
        ]
        if (!feeCalls.every((expected, index) => getAddress(calls[index].target) === getAddress(expected.target) &&
            calls[index].data.toLowerCase() === expected.data.toLowerCase() && calls[index].value === 0n)) reject()
        return [{ target: getAddress(plan.token), value: 0n,
            data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [plan.treasury, BigInt(plan.amountRaw)] }) }, ...calls.slice(4)]
    } catch { return reject() }
}

/** Independently inspect the pinned deployment before any wallet authorization. */
export async function verifyFeeRefillDeployment(plan, rpc) {
    if (!plan) return
    const [code, encoded] = await Promise.all([
        rpc('eth_getCode', [plan.settlement, 'latest']),
        rpc('eth_call', [{ to: plan.settlement, data: encodeFunctionData({ abi: FEE_REFILL_ABI, functionName: 'settings' }) }, 'latest']),
    ])
    try {
        if (code === '0x' || keccak256(code).toLowerCase() !== plan.codeHash.toLowerCase()) reject()
        const actual = decodeFunctionResult({ abi: FEE_REFILL_ABI, functionName: 'settings', data: encoded })
        if (![plan.entryPoint, plan.paymaster, plan.bundler, plan.treasury].every((value, i) => getAddress(value) === getAddress(actual[i])) ||
            actual[4] !== BigInt(plan.thresholdWei)) reject()
    } catch { reject() }
}
