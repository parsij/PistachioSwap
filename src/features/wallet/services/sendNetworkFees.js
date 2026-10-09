import { encodeFunctionData } from 'viem'

/** Keep fee preparation tied to the exact transfer calldata/value. */
export function sendPlanTransaction(plan) {
    const { account, chainId, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce } = plan.request
    return { account, chainId, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce,
        ...(plan.kind === 'native' ? { to: plan.request.to, value: plan.amountWei } : {
            to: plan.request.address, value: 0n,
            data: encodeFunctionData(plan.request),
        }),
    }
}

export function sendPlanWithFees(plan, transaction) {
    const fields = Object.fromEntries(['gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce']
        .filter(key => transaction[key] !== undefined).map(key => [key, transaction[key]]))
    return { ...plan, request: { ...plan.request, ...fields } }
}
