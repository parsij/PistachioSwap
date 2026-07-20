import { isAddressEqual, type Address, type Hex } from 'viem'

import { getApiConfig } from '../../config.js'
import { ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN, createZeroXProvider } from '../../features/quotes/providers/zero-x-provider.js'
import type { NormalizedQuote } from '../../features/quotes/types/types.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import { GasAssistError } from '../errors.js'

const HEX_DATA = /^0x(?:[0-9a-f]{2})+$/i

export type ExactSponsoredZeroXQuote = NormalizedQuote & {
    transaction: {
        to: Address
        data: Hex
        value: string
        gas?: string
    }
    allowanceTarget: Address
}

function exactAddress(value: string, field: string) {
    const normalized = normalizeAddress(value)
    if (!normalized) throw new GasAssistError('ZEROX_QUOTE_INVALID', `0x returned an invalid ${field}.`, 409)
    return normalized as Address
}

function positiveRaw(value: string, field: string) {
    if (!/^[1-9]\d*$/.test(value)) throw new GasAssistError('ZEROX_QUOTE_INVALID', `0x returned an invalid ${field}.`, 409)
    return BigInt(value)
}

export function validateExactSponsoredZeroXQuote({
    quote,
    sellToken,
    buyToken,
    sellAmount,
}: {
    quote: NormalizedQuote
    sellToken: Address
    buyToken: string
    sellAmount: bigint
}): ExactSponsoredZeroXQuote {
    const config = getApiConfig().sponsorship
    const expectedAllowanceHolder = ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.get(56)
    const allowanceTarget = exactAddress(String(quote.allowanceTarget ?? ''), 'allowance target')
    const transactionTo = exactAddress(String(quote.transaction?.to ?? ''), 'swap target')
    const normalizedBuy = buyToken === NATIVE_TOKEN_ADDRESS ? NATIVE_TOKEN_ADDRESS : exactAddress(buyToken, 'buy token')

    if (quote.provider !== '0x' || quote.billingMode !== 'normal-provider-fee' ||
        quote.chainId !== 56 || quote.mode !== 'EXACT_INPUT' ||
        !isAddressEqual(exactAddress(quote.sellToken, 'sell token'), sellToken) ||
        (normalizedBuy === NATIVE_TOKEN_ADDRESS
            ? quote.buyToken !== NATIVE_TOKEN_ADDRESS
            : !isAddressEqual(exactAddress(quote.buyToken, 'buy token'), normalizedBuy as Address)) ||
        BigInt(quote.sellAmount) !== sellAmount || quote.maximumSellAmount !== quote.sellAmount) {
        throw new GasAssistError('ZEROX_QUOTE_MISMATCH', '0x quote does not match the exact sponsored request.', 409)
    }
    if (!expectedAllowanceHolder || !isAddressEqual(allowanceTarget, expectedAllowanceHolder as Address) ||
        !config.zeroXSafeApprovalTargets.has(allowanceTarget) ||
        config.zeroXSettlerAddress === allowanceTarget) {
        throw new GasAssistError('UNSAFE_APPROVAL_TARGET', '0x returned an unauthorized allowance target.', 409)
    }
    if (!config.zeroXSettlerAddress || !isAddressEqual(transactionTo, config.zeroXSettlerAddress as Address)) {
        throw new GasAssistError('UNSAFE_SWAP_TARGET', '0x returned a swap target that is not the configured Settler.', 409)
    }
    if (!HEX_DATA.test(String(quote.transaction.data ?? '')) || String(quote.transaction.data).length < 10) {
        throw new GasAssistError('ZEROX_QUOTE_INVALID', '0x returned invalid swap calldata.', 409)
    }
    if (!/^\d+$/.test(String(quote.transaction.value ?? '')) || BigInt(quote.transaction.value) !== 0n) {
        throw new GasAssistError('ZEROX_QUOTE_INVALID', 'The sponsored BEP-20 swap must have zero native value.', 409)
    }
    if (quote.platformFee.amount !== '0' || quote.platformFee.bps !== 0 || quote.permitData !== null) {
        throw new GasAssistError('ZEROX_FEE_MODE_INVALID', 'The prepaid 0x quote must have no provider-integrator fee or permit payload.', 409)
    }
    if (Date.parse(quote.expiresAt) <= Date.now() + 5_000) {
        throw new GasAssistError('ZEROX_QUOTE_EXPIRED', 'The 0x quote is too close to expiration.', 409)
    }
    positiveRaw(quote.buyAmount, 'buy amount')
    positiveRaw(quote.minimumBuyAmount, 'minimum buy amount')
    if (BigInt(quote.minimumBuyAmount) > BigInt(quote.buyAmount)) {
        throw new GasAssistError('ZEROX_QUOTE_INVALID', '0x minimum output exceeds expected output.', 409)
    }

    return {
        ...quote,
        sellToken,
        buyToken: normalizedBuy,
        allowanceTarget,
        transaction: {
            to: transactionTo,
            data: quote.transaction.data as Hex,
            value: quote.transaction.value,
            ...(quote.transaction.gas ? { gas: quote.transaction.gas } : {}),
        },
    }
}

export async function getExactSponsoredZeroXQuote({
    wallet,
    sellToken,
    buyToken,
    sellAmount,
    sellTokenDecimals,
    buyTokenDecimals,
    slippageBps,
    signal,
}: {
    wallet: Address
    sellToken: Address
    buyToken: string
    sellAmount: bigint
    sellTokenDecimals: number
    buyTokenDecimals: number
    slippageBps: number
    signal?: AbortSignal
}) {
    const quote = await createZeroXProvider({ applyPlatformFee: false }).getQuote({
        chainId: 56,
        sellToken,
        buyToken,
        mode: 'EXACT_INPUT',
        sellAmount: sellAmount.toString(),
        buyAmount: null,
        sellTokenDecimals,
        buyTokenDecimals,
        takerAddress: wallet,
        slippageBps,
    }, signal)
    return validateExactSponsoredZeroXQuote({ quote, sellToken, buyToken, sellAmount })
}

export function quoteGasLimit(quote: ExactSponsoredZeroXQuote) {
    const value = quote.transaction.gas ?? quote.estimatedGas
    if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
        throw new GasAssistError('ZEROX_GAS_ESTIMATE_MISSING', '0x did not provide a usable swap gas estimate.', 409)
    }
    return BigInt(value)
}

export function quoteSelector(quote: ExactSponsoredZeroXQuote) {
    return quote.transaction.data.slice(0, 10).toLowerCase()
}
