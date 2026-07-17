import {
    createPublicClient,
    decodeEventLog,
    encodeFunctionData,
    http,
    isAddressEqual,
    keccak256,
    parseTransaction,
    recoverTransactionAddress,
    type Address,
    type Hex,
} from 'viem'
import { bsc } from 'viem/chains'

import { getApiConfig } from '../../config.js'
import { getNativeBnbPrice } from '../../providers/alchemy/token-prices.js'
import { GasAssistError } from '../errors.js'
import { ceilDiv, parseFixed } from './fixed-point.js'

export const transferAbi = [{
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
}] as const

export const erc20ReadAbi = [
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export const transferEventAbi = [{
    type: 'event',
    name: 'Transfer',
    inputs: [
        { indexed: true, name: 'from', type: 'address' },
        { indexed: true, name: 'to', type: 'address' },
        { indexed: false, name: 'value', type: 'uint256' },
    ],
}] as const

function publicClient() {
    const rpcUrl = getApiConfig().quotes.pancakeSwap.rpcUrl
    if (!rpcUrl) throw new GasAssistError('RPC_NOT_CONFIGURED', 'BSC RPC is not configured.', 503)
    return createPublicClient({ chain: bsc, transport: http(rpcUrl) })
}

export function buildPaymentTransfer(treasury: Address, amount: bigint) {
    if (amount <= 0n) throw new GasAssistError('INVALID_PAYMENT_AMOUNT', 'The sponsorship payment must be positive.')
    return encodeFunctionData({
        abi: transferAbi,
        functionName: 'transfer',
        args: [treasury, amount],
    })
}

export function createPrepaidChainClient() {
    return {
        async getCode(address: Address) {
            return publicClient().getCode({ address })
        },
        async getTokenDecimals(address: Address) {
            return Number(await publicClient().readContract({
                address,
                abi: erc20ReadAbi,
                functionName: 'decimals',
            }))
        },
        async getBalance(token: Address, wallet: Address) {
            return publicClient().readContract({
                address: token,
                abi: erc20ReadAbi,
                functionName: 'balanceOf',
                args: [wallet],
            })
        },
        async getAllowance(token: Address, owner: Address, spender: Address) {
            return publicClient().readContract({
                address: token,
                abi: erc20ReadAbi,
                functionName: 'allowance',
                args: [owner, spender],
            })
        },
        async estimateSponsoredAction({
            wallet,
            to,
            data,
            maximumGas,
        }: {
            wallet: Address
            to: Address
            data: Hex
            maximumGas: bigint
        }) {
            const client = publicClient()
            await client.call({ account: wallet, to, data, value: 0n, gasPrice: 0n })
            const estimated = await client.estimateGas({ account: wallet, to, data, value: 0n, gasPrice: 0n })
            const gasLimit = ceilDiv(estimated * 12_000n, 10_000n)
            if (gasLimit > maximumGas) {
                throw new GasAssistError('SPONSORED_GAS_CAP_EXCEEDED', 'The simulated transaction exceeds its gas cap.', 409)
            }
            const [gasPrice, bnbPrice] = await Promise.all([
                client.getGasPrice(),
                getNativeBnbPrice(),
            ])
            if (!bnbPrice) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'A fresh trusted BNB price is unavailable.', 503)
            const bnbPriceUsdMicros = parseFixed(bnbPrice)
            const gasUsdMicros = ceilDiv(gasLimit * gasPrice * bnbPriceUsdMicros, 10n ** 18n)
            return {
                gasLimit,
                currentGasPrice: gasPrice,
                gasUsdMicros,
                observedAt: new Date(),
            }
        },
        async getReceipt(hash: Hex) {
            return publicClient().getTransactionReceipt({ hash })
        },
        async getTransaction(hash: Hex) {
            return publicClient().getTransaction({ hash })
        },
        async getBlockNumber() {
            return publicClient().getBlockNumber()
        },
    }
}

export type StoredIntentTemplate = {
    walletAddress: Address
    transactionTo: Address
    transactionData: Hex
    transactionDataHash: Hex
    nativeValue: string
    chainId: number
    nonce: string
    transactionType: string
    gasLimit: string
    gasPrice: string
    maxFeePerGas: string | null
    maxPriorityFeePerGas: string | null
}

export async function validateSignedIntent(
    signedRawTransaction: Hex,
    template: StoredIntentTemplate,
) {
    let parsed: ReturnType<typeof parseTransaction>
    let signer: Address
    try {
        parsed = parseTransaction(signedRawTransaction)
        signer = await recoverTransactionAddress({
            serializedTransaction: signedRawTransaction as Parameters<
                typeof recoverTransactionAddress
            >[0]['serializedTransaction'],
        })
    } catch {
        throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed transaction is invalid.')
    }

    const matches =
        isAddressEqual(signer, template.walletAddress) &&
        parsed.chainId === template.chainId &&
        parsed.type === template.transactionType &&
        parsed.nonce === Number(BigInt(template.nonce)) &&
        parsed.to !== null && parsed.to !== undefined && isAddressEqual(parsed.to, template.transactionTo) &&
        (parsed.data ?? '0x').toLowerCase() === template.transactionData.toLowerCase() &&
        keccak256((parsed.data ?? '0x') as Hex) === template.transactionDataHash &&
        (parsed.value ?? 0n) === BigInt(template.nativeValue) &&
        (parsed.gasPrice ?? 0n) === BigInt(template.gasPrice) &&
        (parsed.maxFeePerGas ?? null) === (template.maxFeePerGas === null ? null : BigInt(template.maxFeePerGas)) &&
        (parsed.maxPriorityFeePerGas ?? null) === (template.maxPriorityFeePerGas === null ? null : BigInt(template.maxPriorityFeePerGas)) &&
        parsed.gas !== undefined && parsed.gas === BigInt(template.gasLimit) &&
        (!parsed.accessList || parsed.accessList.length === 0)

    if (!matches) {
        throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed transaction does not match the authorized intent.')
    }
    return {
        signer,
        parsed,
        transactionHash: keccak256(signedRawTransaction),
    }
}

export function verifyExactTransferReceipt({
    receipt,
    transactionFrom,
    transactionTo,
    wallet,
    token,
    treasury,
    requiredAmount,
}: {
    receipt: { status: string; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] }
    transactionFrom: Address
    transactionTo: Address | null
    wallet: Address
    token: Address
    treasury: Address
    requiredAmount: bigint
}) {
    if (receipt.status !== 'success' || !isAddressEqual(transactionFrom, wallet) ||
        !transactionTo || !isAddressEqual(transactionTo, token)) {
        throw new GasAssistError('PAYMENT_RECEIPT_INVALID', 'The payment transaction did not confirm as authorized.', 409)
    }
    const tokenTransfers = receipt.logs.flatMap((log) => {
        if (!isAddressEqual(log.address, token)) return []
        try {
            const decoded = decodeEventLog({
                abi: transferEventAbi,
                data: log.data,
                topics: [...log.topics] as [Hex, ...Hex[]],
            })
            if (decoded.eventName !== 'Transfer') return []
            const { from, to, value } = decoded.args
            return [{ from, to, value }]
        } catch {
            return []
        }
    })
    if (tokenTransfers.length !== 1 ||
        !isAddressEqual(tokenTransfers[0]!.from, wallet) ||
        !isAddressEqual(tokenTransfers[0]!.to, treasury) ||
        tokenTransfers[0]!.value < requiredAmount) {
        throw new GasAssistError('PAYMENT_RECEIPT_SHORT', 'The treasury did not receive the exact required payment.', 409)
    }
    return tokenTransfers[0]!.value
}
