import { randomUUID } from 'node:crypto'

import {
    decodeFunctionData,
    encodeFunctionData,
    zeroAddress,
} from 'viem'

import { isCuratedEvmChainId } from '../chains.js'
import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../lib/address.js'
import { isRecord } from '../lib/http.js'
import type {
    CrossChainQuote,
    CrossChainRequest,
    CrossChainTransaction,
    ProviderCapabilities,
} from './types.js'

const UINT_PATTERN = /^(?:0|[1-9]\d*)$/
const HEX_DATA_PATTERN = /^0x(?:[a-fA-F0-9]{2})*$/
const APPROVE_SELECTOR = '0x095ea7b3'
const APPROVE_DATA_LENGTH = 138
const APPROVE_ABI = [{
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
}] as const

export class CrossChainValidationError extends Error {
    constructor(readonly code: string, message: string) {
        super(message)
        this.name = 'CrossChainValidationError'
    }
}

function requireAddress(value: unknown, field: string) {
    const address = normalizeAddress(value)
    if (!address) throw new Error(`${field} must be an EVM address.`)
    return address
}

export function validateCrossChainRequest(value: unknown): CrossChainRequest {
    if (!isRecord(value)) throw new Error('Cross-chain request must be an object.')

    const canonical = isRecord(value.sourceAsset) && isRecord(value.destinationAsset)
    const allowedFields = new Set(canonical
        ? [
              'mode',
              'sourceAsset',
              'destinationAsset',
              'amount',
              'ownerAddress',
              'recipient',
              'slippageBps',
              'walletCapabilities',
          ]
        : [
              'mode',
              'sourceChainId',
              'destinationChainId',
              'sourceToken',
              'destinationToken',
              'amount',
              'account',
              'recipient',
              'slippageBps',
              'walletCapabilities',
          ])
    if (Object.keys(value).some((key) => !allowedFields.has(key))) {
        throw new Error('Cross-chain request contains unsupported fields.')
    }
    const sourceAsset = canonical ? value.sourceAsset as Record<string, unknown> : {
        chainId: value.sourceChainId,
        address: value.sourceToken,
    }
    const destinationAsset = canonical ? value.destinationAsset as Record<string, unknown> : {
        chainId: value.destinationChainId,
        address: value.destinationToken,
    }
    const sourceChainId = Number(sourceAsset.chainId)
    const destinationChainId = Number(destinationAsset.chainId)
    if (!isCuratedEvmChainId(sourceChainId)) throw new Error('Source chain is not enabled.')
    if (!isCuratedEvmChainId(destinationChainId)) throw new Error('Destination chain is not enabled.')
    if (sourceChainId === destinationChainId) throw new Error('Cross-chain quote requires different chains.')

    const amount = String(value.amount ?? '')
    if (!UINT_PATTERN.test(amount) || BigInt(amount) <= 0n) {
        throw new Error('amount must be a positive integer string.')
    }
    const slippageBps = value.slippageBps === undefined ? 50 : Number(value.slippageBps)
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
        throw new Error('slippageBps must be an integer from 0 through 10000.')
    }
    const mode = value.mode ?? 'exactIn'
    if (mode !== 'exactIn') throw new Error('Only mode=exactIn is supported.')
    const ownerAddress = requireAddress(
        value.ownerAddress ?? value.account,
        'ownerAddress',
    )
    const capabilities = isRecord(value.walletCapabilities)
        ? value.walletCapabilities
        : {}
    const readCapability = (name: string, fallback: boolean) => {
        const candidate = capabilities[name]
        if (candidate === undefined) return fallback
        if (typeof candidate !== 'boolean') {
            throw new Error(`walletCapabilities.${name} must be boolean.`)
        }
        return candidate
    }

    return {
        mode,
        sourceAsset: normalizeAsset(sourceAsset, sourceChainId, 'sourceAsset'),
        destinationAsset: normalizeAsset(destinationAsset, destinationChainId, 'destinationAsset'),
        amount,
        ownerAddress,
        recipient: requireAddress(value.recipient ?? ownerAddress, 'recipient'),
        slippageBps,
        walletCapabilities: {
            evmTransaction: readCapability('evmTransaction', true),
            depositChannel: readCapability('depositChannel', true),
            vaultSwap: readCapability('vaultSwap', false),
        },
    }
}

function normalizeAsset(
    value: Record<string, unknown>,
    chainId: number,
    field: string,
) {
    const symbol = value.symbol
    const decimals = value.decimals
    if (symbol != null && (typeof symbol !== 'string' || symbol.length > 32)) {
        throw new Error(`${field}.symbol is invalid.`)
    }
    if (
        decimals != null &&
        (!Number.isInteger(Number(decimals)) || Number(decimals) < 0 || Number(decimals) > 36)
    ) throw new Error(`${field}.decimals is invalid.`)
    return {
        chainId,
        address: requireAddress(value.address, `${field}.address`),
        symbol: typeof symbol === 'string' ? symbol : null,
        decimals: decimals == null ? null : Number(decimals),
    }
}

export function normalizeUint(value: unknown, field: string) {
    const text = String(value ?? '')
    if (!UINT_PATTERN.test(text)) throw new Error(`Provider returned invalid ${field}.`)
    return BigInt(text).toString()
}

export function validateProviderTransaction(
    value: unknown,
    request: CrossChainRequest,
    capabilities: ProviderCapabilities,
    expectedChainId = request.sourceAsset.chainId,
): CrossChainTransaction {
    if (!isRecord(value)) throw new Error('Provider returned no transaction.')
    const to = requireAddress(value.to, 'transaction.to')
    const route = capabilities.routes.find((candidate) =>
        candidate.sourceChainId === expectedChainId,
    )
    if (!route || !route.transactionTargets.map((item) => item.toLowerCase()).includes(to)) {
        throw new Error('Provider transaction target is not in capability metadata.')
    }
    if (value.chainId === undefined || Number(value.chainId) !== expectedChainId) {
        throw new Error('Provider transaction is for the wrong chain.')
    }
    const data = String(value.data ?? '')
    if (!HEX_DATA_PATTERN.test(data)) throw new Error('Provider returned invalid transaction data.')

    const gasEstimate = optionalGasEstimate(value.gas ?? value.gasLimit)
    return {
        chainId: expectedChainId,
        to,
        data,
        value: normalizeUint(value.value ?? '0', 'transaction value'),
        allowanceTarget: null,
        ...(gasEstimate === null ? {} : { gasEstimate }),
    }
}

type ExactApprovalOptions = {
    chainId: number
    token: string
    spenders: readonly string[]
    amount: string
    providerCodePrefix?: 'ACROSS' | 'RELAY'
}

function approvalError(code: string, message: string): never {
    throw new CrossChainValidationError(code, message)
}

export function validateExactApprovalTransaction(
    value: unknown,
    options: ExactApprovalOptions,
): CrossChainTransaction {
    const code = (suffix: string) =>
        `${options.providerCodePrefix ?? 'RELAY'}_${suffix}`
    if (options.token === NATIVE_TOKEN_ADDRESS) {
        approvalError(
            code('ROUTE_MALFORMED'),
            'Native input assets must not have approval transactions.',
        )
    }
    if (!isRecord(value)) {
        approvalError(code('ROUTE_MALFORMED'), 'Provider returned an invalid approval transaction.')
    }
    if (value.chainId === undefined || Number(value.chainId) !== options.chainId) {
        approvalError(code('ROUTE_MALFORMED'), 'Approval transaction is for the wrong chain.')
    }
    const token = requireAddress(value.to, 'approval transaction.to')
    if (token !== options.token) {
        approvalError(
            code('APPROVAL_TARGET_INVALID'),
            'Approval transaction target does not match the source token.',
        )
    }
    const valueAmount = normalizeUint(value.value ?? '0', 'approval transaction value')
    if (valueAmount !== '0') {
        approvalError(code('APPROVAL_AMOUNT_INVALID'), 'Approval transaction value must be zero.')
    }

    const data = String(value.data ?? '')
    if (
        !HEX_DATA_PATTERN.test(data) ||
        data.length !== APPROVE_DATA_LENGTH ||
        data.slice(0, 10).toLowerCase() !== APPROVE_SELECTOR
    ) approvalError(
        code('ROUTE_MALFORMED'),
        'Approval transaction must call approve(address,uint256).',
    )

    let decoded: ReturnType<typeof decodeFunctionData<typeof APPROVE_ABI>>
    try {
        decoded = decodeFunctionData({
            abi: APPROVE_ABI,
            data: data as `0x${string}`,
        })
    } catch {
        approvalError(
            code('ROUTE_MALFORMED'),
            'Approval transaction must call approve(address,uint256).',
        )
    }
    if (decoded.functionName !== 'approve') {
        approvalError(
            code('ROUTE_MALFORMED'),
            'Approval transaction must call approve(address,uint256).',
        )
    }
    const [rawSpender, approvedAmount] = decoded.args
    const spender = requireAddress(rawSpender, 'approval spender')
    const canonicalData = encodeFunctionData({
        abi: APPROVE_ABI,
        functionName: 'approve',
        args: [spender as `0x${string}`, approvedAmount],
    })
    if (canonicalData !== data.toLowerCase()) {
        approvalError(code('ROUTE_MALFORMED'), 'Approval transaction calldata is not canonical.')
    }
    const authoritativeSpenders = options.spenders.map((candidate) =>
        requireAddress(candidate, 'authoritative approval spender'))
    if (
        spender === zeroAddress ||
        !authoritativeSpenders.includes(spender)
    ) approvalError(
        code('APPROVAL_TARGET_INVALID'),
        'Approval spender is not authoritative for the source chain.',
    )
    const expectedAmount = normalizeUint(options.amount, 'approval amount')
    if (approvedAmount !== BigInt(expectedAmount)) {
        approvalError(
            code('APPROVAL_AMOUNT_INVALID'),
            'Approval amount does not exactly match the required amount.',
        )
    }

    const gasEstimate = optionalGasEstimate(value.gas ?? value.gasLimit)
    return {
        chainId: options.chainId,
        to: token,
        data: data.toLowerCase(),
        value: '0',
        allowanceTarget: spender,
        ...(gasEstimate === null ? {} : { gasEstimate }),
    }
}

function optionalGasEstimate(value: unknown) {
    if (value === undefined || value === null || value === '') return null

    const text = String(value).trim()
    let gas: bigint
    try {
        gas = /^0x[0-9a-fA-F]+$/.test(text)
            ? BigInt(text)
            : BigInt(normalizeUint(text, 'transaction gas estimate'))
    } catch {
        throw new Error('Provider returned an invalid transaction gas estimate.')
    }

    // Some providers use zero as a sentinel for “estimate unavailable”.
    // Never forward it as a wallet gas limit; the frontend estimates gas from
    // the validated transaction before submission.
    return gas === 0n ? null : gas.toString()
}

export function createExactApprovalTransaction(
    options: Omit<ExactApprovalOptions, 'spenders'> & { spender: string },
): CrossChainTransaction {
    const spender = requireAddress(options.spender, 'approval spender')
    const token = requireAddress(options.token, 'approval token')
    const amount = normalizeUint(options.amount, 'approval amount')
    const data = encodeFunctionData({
        abi: APPROVE_ABI,
        functionName: 'approve',
        args: [spender as `0x${string}`, BigInt(amount)],
    })
    return validateExactApprovalTransaction({
        chainId: options.chainId,
        to: token,
        data,
        value: '0',
    }, {
        chainId: options.chainId,
        token,
        spenders: [spender],
        amount,
    })
}

export function assertExactQuote(
    quote: Omit<CrossChainQuote, 'quoteId'>,
    request: CrossChainRequest,
): CrossChainQuote {
    if (
        quote.request.sourceAsset.chainId !== request.sourceAsset.chainId ||
        quote.request.destinationAsset.chainId !== request.destinationAsset.chainId ||
        quote.request.sourceAsset.address !== request.sourceAsset.address ||
        quote.request.destinationAsset.address !== request.destinationAsset.address ||
        quote.request.amount !== request.amount ||
        quote.request.ownerAddress !== request.ownerAddress ||
        quote.request.recipient !== request.recipient
    ) {
        throw new Error('Provider quote does not exactly match the request.')
    }
    const buyAmount = normalizeUint(quote.buyAmount, 'buy amount')
    const minimumBuyAmount = normalizeUint(quote.minimumBuyAmount, 'minimum buy amount')
    if (BigInt(minimumBuyAmount) > BigInt(buyAmount)) {
        throw new Error('Provider minimum output exceeds quoted output.')
    }
    return {
        ...quote,
        buyAmount,
        minimumBuyAmount,
        quoteId: randomUUID(),
    }
}

export function routeSupportsRequest(
    capabilities: ProviderCapabilities,
    request: CrossChainRequest,
) {
    return capabilities.available && capabilities.routes.some((route) => {
        const sells = route.sellTokens?.map((token) => token.toLowerCase())
        const buys = route.buyTokens?.map((token) => token.toLowerCase())
        return route.sourceChainId === request.sourceAsset.chainId &&
            route.destinationChainId === request.destinationAsset.chainId &&
            (!sells || sells.includes(request.sourceAsset.address)) &&
            (!buys || buys.includes(request.destinationAsset.address))
    })
}
