import { formatUnits, parseUnits } from 'viem'

export const NETWORK_FEE_TTL_MS = 45_000
const max = (...values) => values.reduce((a, b) => a > b ? a : b, 0n)
const ceil = (value, numerator, denominator = 100n) => (value * numerator + denominator - 1n) / denominator
const quantity = (value) => typeof value === 'bigint' && value >= 0n

export function parseGwei(value, { allowZero = false } = {}) {
    const text = String(value ?? '').trim()
    if (text.length > 60 || !/^\d+(?:\.\d{1,9})?$/.test(text)) {
        throw new Error('Enter a Gwei amount with up to 9 decimal places.')
    }
    const wei = parseUnits(text, 9)
    if (wei < 0n || (!allowZero && wei === 0n) || wei >= 2n ** 256n) {
        throw new Error('Enter a positive network fee.')
    }
    return wei
}

export const formatGwei = (wei) => formatUnits(wei, 9)

/** Reads the selected source RPC, honoring viem's chain-specific fee estimator. */
export async function fetchNetworkFees(publicClient, chainId, now = Date.now, request) {
    if (!publicClient || Number(publicClient.chain?.id) !== Number(chainId)) {
        throw new Error('Network fee client does not match the sell network.')
    }
    if (Number(await publicClient.getChainId()) !== Number(chainId)) {
        throw new Error('Network fee RPC returned a different network.')
    }
    const block = await publicClient.getBlock({ blockTag: 'latest' })
    const estimate = await publicClient.estimateFeesPerGas({ block, ...(request ? { request } : {}) }).catch(() => null)
    const baseFee = block.baseFeePerGas
    if (quantity(baseFee) && quantity(estimate?.maxFeePerGas) && quantity(estimate?.maxPriorityFeePerGas)) {
        const history = await publicClient.getFeeHistory?.({
            blockCount: 5, blockTag: 'latest', rewardPercentiles: [10, 50, 90],
        }).catch(() => null)
        const median = (index) => {
            const values = (history?.reward ?? []).map(row => row[index]).filter(quantity)
                .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
            return values.length ? values[Math.floor(values.length / 2)] : 0n
        }
        // Never go below the chain/RPC recommendation (some networks impose a minimum tip).
        const minimumTip = estimate.maxPriorityFeePerGas
        const tips = [max(minimumTip, median(0)), max(minimumTip, median(1)), max(minimumTip, median(2))]
        const presets = Object.fromEntries(['less', 'standard', 'high'].map((name, index) => {
            const maxPriorityFeePerGas = tips[index]
            const maxFeePerGas = max(estimate.maxFeePerGas,
                ceil(baseFee, [120n, 150n, 200n][index]) + maxPriorityFeePerGas)
            return [name, { maxFeePerGas, maxPriorityFeePerGas }]
        }))
        return { chainId: Number(chainId), type: 'eip1559', baseFeePerGas: baseFee,
            presets, observedAt: now(), blockNumber: block.number }
    }
    // An EIP-1559 RPC outage is not evidence that a network uses legacy fees.
    if (quantity(baseFee)) throw new Error('Live priority fees are unavailable. Retry or use automatic network cost.')
    const gasPrice = estimate?.gasPrice ?? await publicClient.getGasPrice()
    if (!quantity(gasPrice) || gasPrice === 0n) throw new Error('Live gas price is unavailable.')
    return { chainId: Number(chainId), type: 'legacy', presets: {
        less: { gasPrice }, standard: { gasPrice }, high: { gasPrice: ceil(gasPrice, 110n) },
    }, observedAt: now(), blockNumber: block.number }
}

export function resolveNetworkFeeSelection(snapshot, selection, chainId, now = Date.now()) {
    if (!snapshot || snapshot.chainId !== Number(chainId) || now - snapshot.observedAt > NETWORK_FEE_TTL_MS) {
        throw new Error('Network fees expired. Refresh the estimate before confirming.')
    }
    if (!selection || selection.chainId !== Number(chainId)) throw new Error('Choose fees for the current sell network.')
    const fields = selection.mode === 'custom' ? selection.fields : snapshot.presets[selection.mode]
    if (!fields) throw new Error('Choose a valid network fee option.')
    if (snapshot.type === 'legacy') {
        if (!quantity(fields.gasPrice) || fields.gasPrice === 0n || fields.maxFeePerGas !== undefined ||
            fields.maxPriorityFeePerGas !== undefined) throw new Error('Enter a positive gas price for this network.')
        return { gasPrice: fields.gasPrice }
    }
    if (!quantity(fields.maxPriorityFeePerGas) || !quantity(fields.maxFeePerGas) || fields.maxFeePerGas === 0n ||
        fields.gasPrice !== undefined) throw new Error('Enter valid maximum and priority fees.')
    if (fields.maxPriorityFeePerGas > fields.maxFeePerGas) throw new Error('Priority fee cannot exceed the maximum fee.')
    if (fields.maxFeePerGas < snapshot.baseFeePerGas + fields.maxPriorityFeePerGas) {
        throw new Error('Maximum fee must cover the current base fee plus the priority fee.')
    }
    return { maxFeePerGas: fields.maxFeePerGas, maxPriorityFeePerGas: fields.maxPriorityFeePerGas }
}

export function networkFeeCap(fields) {
    return fields?.maxFeePerGas ?? fields?.gasPrice ?? null
}

/** Applies only the whitelisted fee fields after simulation, keeping calldata and value intact. */
export async function prepareNetworkFeeTransaction({ publicClient, transaction, account, snapshot, selection, chainId }) {
    const fields = resolveNetworkFeeSelection(snapshot, selection, chainId)
    if (Number(transaction.chainId ?? chainId) !== Number(chainId)) throw new Error('Transaction fee network changed.')
    const { gasPrice: _gasPrice, maxFeePerGas: _maxFee, maxPriorityFeePerGas: _tip, ...request } = transaction
    const gas = request.gas ?? ceil(await publicClient.estimateGas({ ...request, ...fields, account }), 120n)
    if (!quantity(gas) || gas === 0n) throw new Error('Transaction gas estimate is unavailable.')
    const balance = await publicClient.getBalance({ address: account })
    if (balance < BigInt(request.value ?? 0n) + gas * networkFeeCap(fields)) {
        throw new Error('Insufficient native balance for the selected network fee. Lower the fee or the amount.')
    }
    return { ...request, ...fields, gas }
}
