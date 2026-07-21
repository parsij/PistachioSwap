from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    "export function createUniswapProvider(): QuoteProvider {\n",
    "export function createUniswapProvider({ applyPlatformFee = true }: { applyPlatformFee?: boolean } = {}): QuoteProvider {\n",
)
replace_once(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    "            const integratorFee = resolveUniswapIntegratorFee()\n",
    "            const integratorFee = applyPlatformFee ? resolveUniswapIntegratorFee() : null\n",
)

Path("apps/api/src/gas-assist/prepaid/normal-swap.ts").write_text("""import { isAddressEqual, type Address, type Hex } from 'viem'

import { getApiConfig } from '../../config.js'
import { createUniswapProvider } from '../../features/quotes/providers/uniswap-provider.js'
import { ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN, createZeroXProvider } from '../../features/quotes/providers/zero-x-provider.js'
import type { NormalizedQuote, QuoteProvider, QuoteRequest } from '../../features/quotes/types/types.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'
import { GasAssistError } from '../errors.js'

const HEX_DATA = /^0x(?:[0-9a-f]{2})+$/i
const UNISWAP_SPONSORED_PROXY_TARGETS = new Set([
    '0x0000000085e102724e78ecd2f45dc9ca239affad',
    '0x02e5be68d46dac0b524905bff209cf47ee6db2a9',
])

export type ExactSponsoredQuote = NormalizedQuote & {
    provider: 'uniswap' | '0x'
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
    if (!normalized) throw new GasAssistError('SPONSORED_QUOTE_INVALID', `The provider returned an invalid ${field}.`, 409)
    return normalized as Address
}

function positiveRaw(value: string, field: string) {
    if (!/^[1-9]\d*$/.test(value)) throw new GasAssistError('SPONSORED_QUOTE_INVALID', `The provider returned an invalid ${field}.`, 409)
    return BigInt(value)
}

function validateBaseQuote({
    quote,
    sellToken,
    buyToken,
    sellAmount,
}: {
    quote: NormalizedQuote
    sellToken: Address
    buyToken: string
    sellAmount: bigint
}) {
    const allowanceTarget = exactAddress(String(quote.allowanceTarget ?? ''), 'allowance target')
    const transactionTo = exactAddress(String(quote.transaction?.to ?? ''), 'swap target')
    const normalizedBuy = buyToken === NATIVE_TOKEN_ADDRESS ? NATIVE_TOKEN_ADDRESS : exactAddress(buyToken, 'buy token')

    if (!['uniswap', '0x'].includes(quote.provider) || quote.billingMode !== 'normal-provider-fee' ||
        quote.chainId !== 56 || quote.mode !== 'EXACT_INPUT' ||
        !isAddressEqual(exactAddress(quote.sellToken, 'sell token'), sellToken) ||
        (normalizedBuy === NATIVE_TOKEN_ADDRESS
            ? quote.buyToken !== NATIVE_TOKEN_ADDRESS
            : !isAddressEqual(exactAddress(quote.buyToken, 'buy token'), normalizedBuy as Address)) ||
        BigInt(quote.sellAmount) !== sellAmount || quote.maximumSellAmount !== quote.sellAmount) {
        throw new GasAssistError('SPONSORED_QUOTE_MISMATCH', 'The quote does not match the exact sponsored request.', 409)
    }
    if (!HEX_DATA.test(String(quote.transaction?.data ?? '')) || String(quote.transaction?.data).length < 10) {
        throw new GasAssistError('SPONSORED_QUOTE_INVALID', 'The provider returned invalid swap calldata.', 409)
    }
    if (!/^\d+$/.test(String(quote.transaction?.value ?? '')) || BigInt(quote.transaction!.value) !== 0n) {
        throw new GasAssistError('SPONSORED_QUOTE_INVALID', 'The sponsored BEP-20 swap must have zero native value.', 409)
    }
    if (quote.platformFee.amount !== '0' || quote.platformFee.bps !== 0 || quote.permitData !== null) {
        throw new GasAssistError('SPONSORED_FEE_MODE_INVALID', 'The prepaid quote must not include a provider-integrator fee or permit payload.', 409)
    }
    if (Date.parse(quote.expiresAt) <= Date.now() + 5_000) {
        throw new GasAssistError('SPONSORED_QUOTE_EXPIRED', 'The sponsored quote is too close to expiration.', 409)
    }
    positiveRaw(quote.buyAmount, 'buy amount')
    positiveRaw(quote.minimumBuyAmount, 'minimum buy amount')
    if (BigInt(quote.minimumBuyAmount) > BigInt(quote.buyAmount)) {
        throw new GasAssistError('SPONSORED_QUOTE_INVALID', 'The minimum output exceeds the expected output.', 409)
    }
    return { allowanceTarget, transactionTo, normalizedBuy }
}

export function validateExactSponsoredQuote({
    quote,
    sellToken,
    buyToken,
    sellAmount,
}: {
    quote: NormalizedQuote
    sellToken: Address
    buyToken: string
    sellAmount: bigint
}): ExactSponsoredQuote {
    const config = getApiConfig().sponsorship
    const { allowanceTarget, transactionTo, normalizedBuy } = validateBaseQuote({ quote, sellToken, buyToken, sellAmount })

    if (quote.provider === '0x') {
        const expectedAllowanceHolder = ZERO_X_ALLOWANCE_HOLDER_BY_CHAIN.get(56)
        if (!expectedAllowanceHolder || !isAddressEqual(allowanceTarget, expectedAllowanceHolder as Address) ||
            !config.zeroXSafeApprovalTargets.has(allowanceTarget) ||
            config.zeroXSettlerAddress === allowanceTarget) {
            throw new GasAssistError('UNSAFE_APPROVAL_TARGET', '0x returned an unauthorized allowance target.', 409)
        }
        if (!config.zeroXSettlerAddress || !isAddressEqual(transactionTo, config.zeroXSettlerAddress as Address)) {
            throw new GasAssistError('UNSAFE_SWAP_TARGET', '0x returned a swap target that is not the configured Settler.', 409)
        }
    } else if (quote.provider === 'uniswap') {
        if (!UNISWAP_SPONSORED_PROXY_TARGETS.has(allowanceTarget) ||
            !UNISWAP_SPONSORED_PROXY_TARGETS.has(transactionTo) ||
            !isAddressEqual(allowanceTarget, transactionTo)) {
            throw new GasAssistError('UNSAFE_SWAP_TARGET', 'Uniswap returned an unauthorized proxy approval or swap target.', 409)
        }
        if (quote.approval?.mode !== 'erc20' ||
            !isAddressEqual(exactAddress(String(quote.approval.spender ?? ''), 'approval spender'), allowanceTarget) ||
            !isAddressEqual(exactAddress(String(quote.approval.token ?? ''), 'approval token'), sellToken) ||
            String(quote.approval.requiredAmount ?? '') !== sellAmount.toString()) {
            throw new GasAssistError('UNSAFE_APPROVAL_TARGET', 'Uniswap returned inconsistent exact approval metadata.', 409)
        }
    } else {
        throw new GasAssistError('SPONSORED_PROVIDER_UNSUPPORTED', 'The provider is not supported for exact sponsorship.', 409)
    }

    return {
        ...quote,
        provider: quote.provider,
        sellToken,
        buyToken: normalizedBuy,
        allowanceTarget,
        transaction: {
            to: transactionTo,
            data: quote.transaction!.data as Hex,
            value: quote.transaction!.value,
            ...(quote.transaction!.gas ? { gas: quote.transaction!.gas } : {}),
        },
    } as ExactSponsoredQuote
}

function providerList(provided?: QuoteProvider[]) {
    if (provided) return provided
    const config = getApiConfig()
    const requested = new Set(config.sponsorship.sponsoredSwapProviders)
    const providers: QuoteProvider[] = []
    if (requested.has('uniswap') && config.quotes.uniswap.enabled) {
        providers.push(createUniswapProvider({ applyPlatformFee: false }))
    }
    if (requested.has('0x') && config.quotes.zeroX.enabled) {
        providers.push(createZeroXProvider({ applyPlatformFee: false }))
    }
    return providers
}

export async function getExactSponsoredQuote({
    wallet,
    sellToken,
    buyToken,
    sellAmount,
    sellTokenDecimals,
    buyTokenDecimals,
    slippageBps,
    signal,
    providers,
}: {
    wallet: Address
    sellToken: Address
    buyToken: string
    sellAmount: bigint
    sellTokenDecimals: number
    buyTokenDecimals: number
    slippageBps: number
    signal?: AbortSignal
    providers?: QuoteProvider[]
}) {
    const request: QuoteRequest = {
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
    }
    const failures: string[] = []
    for (const provider of providerList(providers)) {
        try {
            const quote = await provider.getQuote(request, signal)
            return validateExactSponsoredQuote({ quote, sellToken, buyToken, sellAmount })
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? String((error as { code?: unknown }).code ?? 'PROVIDER_FAILED')
                : 'PROVIDER_FAILED'
            failures.push(`${provider.name}:${code}`)
        }
    }
    throw new GasAssistError(
        'SPONSORED_ROUTE_UNAVAILABLE',
        'Uniswap and the configured sponsored fallback providers could not return a safe executable route.',
        409,
        { providers: failures },
    )
}

export const getExactSponsoredZeroXQuote = getExactSponsoredQuote
export const validateExactSponsoredZeroXQuote = validateExactSponsoredQuote
export type ExactSponsoredZeroXQuote = ExactSponsoredQuote

export function quoteGasLimit(quote: ExactSponsoredQuote) {
    const value = quote.transaction.gas ?? quote.estimatedGas
    if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
        throw new GasAssistError('SPONSORED_GAS_ESTIMATE_MISSING', 'The provider did not return a usable swap gas estimate.', 409)
    }
    return BigInt(value)
}

export function quoteSelector(quote: ExactSponsoredQuote) {
    return quote.transaction.data.slice(0, 10).toLowerCase()
}
""")

replace_once(
    "apps/api/src/config.ts",
    """            normalSwapSponsorEnabled: readBoolean(
                'MEGAFUEL_NORMAL_SWAP_SPONSOR_ENABLED',
                false,
            ),
""",
    """            normalSwapSponsorEnabled: readBoolean(
                'MEGAFUEL_NORMAL_SWAP_SPONSOR_ENABLED',
                false,
            ),
            sponsoredSwapProviders: (process.env.MEGAFUEL_SPONSORED_SWAP_PROVIDERS ?? 'uniswap,0x')
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean),
""",
)
replace_once(
    "apps/api/src/config.ts",
    """    const validSponsorshipBillingModes = new Set(['prepaid'])
    const validApprovalModes = new Set(['exact', 'bounded-reusable'])
""",
    """    const validSponsorshipBillingModes = new Set(['prepaid'])
    const validApprovalModes = new Set(['exact', 'bounded-reusable'])
    const validSponsoredSwapProviders = new Set(['uniswap', '0x'])
""",
)
replace_once(
    "apps/api/src/config.ts",
    """    if (!validApprovalModes.has(config.sponsorship.approvalMode)) {
        throw new Error('MEGAFUEL_APPROVAL_MODE is invalid.')
    }
""",
    """    if (!validApprovalModes.has(config.sponsorship.approvalMode)) {
        throw new Error('MEGAFUEL_APPROVAL_MODE is invalid.')
    }
    if (config.sponsorship.sponsoredSwapProviders.length === 0 ||
        config.sponsorship.sponsoredSwapProviders.some((provider) => !validSponsoredSwapProviders.has(provider))) {
        throw new Error('MEGAFUEL_SPONSORED_SWAP_PROVIDERS must contain only uniswap and/or 0x.')
    }
""",
)

replace_once(
    "apps/api/.env.megafuel.example",
    """MEGAFUEL_NORMAL_SWAP_SPONSOR_ENABLED=true
MEGAFUEL_APPROVAL_MODE=exact
""",
    """MEGAFUEL_NORMAL_SWAP_SPONSOR_ENABLED=true
# Exact sponsored routing tries Uniswap first and uses 0x only as a fallback.
# PancakeSwap is excluded until its Permit2 authorization is implemented as an exact sponsored intent.
MEGAFUEL_SPONSORED_SWAP_PROVIDERS=uniswap,0x
MEGAFUEL_APPROVAL_MODE=exact
""",
)

replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    "import { gaslessService } from '../gasless-service.js'\n",
    "",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """    getExactSponsoredZeroXQuote,
    quoteGasLimit,
    type ExactSponsoredZeroXQuote,
""",
    """    getExactSponsoredQuote,
    quoteGasLimit,
    type ExactSponsoredQuote,
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    "type PrepaidGaslessProbe = Awaited<ReturnType<ReturnType<typeof gaslessService>['probePrepaid']>>\n\n",
    "",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """    probeGasless(input: {
        chainId: number
        walletAddress: string
        sellToken: string
        buyToken: string
        sellAmount: string
        slippageBps: number
        clientIp: string
    }): Promise<PrepaidGaslessProbe>
""",
    "",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    "): Promise<ExactSponsoredZeroXQuote>\n",
    "): Promise<ExactSponsoredQuote>\n",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """        probeGasless: (input) => gaslessService().probePrepaid(input),
        quoteNormal: getExactSponsoredZeroXQuote,
""",
    """        quoteNormal: getExactSponsoredQuote,
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """        const initialProbe = await dependencies.probeGasless({
            chainId: 56,
            walletAddress,
            sellToken: input.sellToken,
            buyToken: input.buyToken,
            sellAmount: input.grossInputAmount.toString(),
            slippageBps: input.slippageBps,
            clientIp,
        })
        if (initialProbe.route === 'direct') {
            throw new GasAssistError('DIRECT_GASLESS_AVAILABLE', '0x Gasless can execute directly; prepaid sponsorship is not required.', 409)
        }
        if (initialProbe.route !== 'onchain-approval') {
            throw new GasAssistError('NO_SPONSORED_ROUTE', 'The selected trade does not require the exact prepaid approval flow.', 409)
        }
""",
    "",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    "        const spender = assertSafeZeroXSpender(initialQuote.allowanceTarget)\n",
    "        const spender = initialQuote.allowanceTarget\n",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """                      $20,'0x',$21,$22,$23::jsonb,$24::jsonb,$25,$26,true,$27,$28,
                      'normal-sponsored-swap','prepaid-megafuel',$29,$30,$31)
""",
    """                      $20,$21,$22,$23,$24::jsonb,$25::jsonb,$26,$27,true,$28,$29,
                      'normal-sponsored-swap','prepaid-megafuel',$30,$31,$32)
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """                config.sponsorship.gasMultiplierBps,
                finalQuote.quoteId,
""",
    """                config.sponsorship.gasMultiplierBps,
                finalQuote.provider,
                finalQuote.quoteId,
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """                    route: '0x-normal-sponsored-swap',
                    slippageBps: input.slippageBps,
                    quote: {
                        quoteId: finalQuote.quoteId,
""",
    """                    route: `${finalQuote.provider}-normal-sponsored-swap`,
                    slippageBps: input.slippageBps,
                    quote: {
                        provider: finalQuote.provider,
                        quoteId: finalQuote.quoteId,
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/order-service.ts",
    """                        quoteId: finalConversion.quote.quoteId,
                        expiresAt: finalConversion.quote.expiresAt,
""",
    """                        provider: finalConversion.quote.provider,
                        quoteId: finalConversion.quote.quoteId,
                        expiresAt: finalConversion.quote.expiresAt,
""",
)

replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    "import { getExactSponsoredZeroXQuote, quoteGasLimit, quoteSelector } from './normal-swap.js'\n",
    "import { getExactSponsoredQuote, quoteGasLimit, quoteSelector } from './normal-swap.js'\n",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    "    quoteNormal: typeof getExactSponsoredZeroXQuote\n",
    "    quoteNormal: typeof getExactSponsoredQuote\n",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    "        quoteNormal: getExactSponsoredZeroXQuote,\n",
    "        quoteNormal: getExactSponsoredQuote,\n",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    """        if (!isAddressEqual(currentQuote.allowanceTarget, order.approvalSpender) ||
            BigInt(currentQuote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError('ORDER_REQUOTE_REQUIRED', 'The 0x route changed; review a fresh sponsorship order.', 409)
        }
""",
    """        const reviewedQuote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
        if (currentQuote.provider !== String(reviewedQuote?.provider ?? '') ||
            !isAddressEqual(currentQuote.allowanceTarget, order.approvalSpender) ||
            BigInt(currentQuote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError('ORDER_REQUOTE_REQUIRED', 'The sponsored route changed; review a fresh sponsorship order.', 409)
        }
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    """                throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed swap does not match the fresh authorized 0x quote.', 409)
            }
            const config = getApiConfig().sponsorship
            if (!config.zeroXSettlerAddress ||
                !isAddressEqual(intent.transactionTo, config.zeroXSettlerAddress as Address)) {
                throw new GasAssistError('UNSAFE_SWAP_TARGET', 'The sponsored swap target is not the configured 0x Settler.', 409)
            }
""",
    """                throw new GasAssistError('SIGNED_TRANSACTION_MISMATCH', 'The signed swap does not match the fresh authorized sponsored quote.', 409)
            }
            if (!['uniswap', '0x'].includes(String(quote?.provider ?? ''))) {
                throw new GasAssistError('SPONSORED_PROVIDER_UNSUPPORTED', 'The stored sponsored provider is unsupported.', 409)
            }
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    """                const config = getApiConfig().sponsorship
                if (!isAddressEqual(transaction.from, order.walletAddress) || !transaction.to ||
                    !config.zeroXSettlerAddress || !isAddressEqual(transaction.to, config.zeroXSettlerAddress as Address)) {
""",
    """                const quote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
                const expectedTransaction = quote?.transaction as Record<string, unknown> | undefined
                const expectedTarget = String(expectedTransaction?.to ?? '')
                if (!isAddressEqual(transaction.from, order.walletAddress) || !transaction.to ||
                    !normalizeAddress(expectedTarget) || !isAddressEqual(transaction.to, expectedTarget as Address)) {
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    "import { NATIVE_TOKEN_ADDRESS } from '../../lib/address.js'\n",
    "import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../../lib/address.js'\n",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    """        if (!isAddressEqual(quote.allowanceTarget, order.approvalSpender) ||
            BigInt(quote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError('FRESH_QUOTE_OUTSIDE_SLIPPAGE', 'The fresh 0x quote moved beyond the reviewed minimum output.', 409)
        }
""",
    """        const reviewedQuote = order.providerQuoteSnapshot.quote as Record<string, unknown> | undefined
        if (quote.provider !== String(reviewedQuote?.provider ?? '') ||
            !isAddressEqual(quote.allowanceTarget, order.approvalSpender) ||
            BigInt(quote.minimumBuyAmount) < BigInt(order.minimumOutputRaw)) {
            throw new GasAssistError('FRESH_QUOTE_OUTSIDE_SLIPPAGE', 'The fresh sponsored quote moved beyond the reviewed route or minimum output.', 409)
        }
""",
)
replace_once(
    "apps/api/src/gas-assist/prepaid/intent-service.ts",
    """            quote: {
                quoteId: quote.quoteId,
""",
    """            quote: {
                provider: quote.provider,
                quoteId: quote.quoteId,
""",
)

Path("apps/api/test/megafuel-normal-swap.test.ts").write_text("""import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalizedQuote, QuoteProvider } from '../src/features/quotes/types/types.js'
import {
    getExactSponsoredQuote,
    validateExactSponsoredQuote,
} from '../src/gas-assist/prepaid/normal-swap.js'

const wallet = '0x1111111111111111111111111111111111111111' as Address
const sellToken = '0x2222222222222222222222222222222222222222' as Address
const buyToken = '0x3333333333333333333333333333333333333333' as Address
const allowanceHolder = '0x0000000000001ff3684f28c67538d4d072c22734'
const settler = '0x00000000000004533fe15556b1e086bb1a72ceae'
const uniswapProxy = '0x0000000085e102724e78ecd2f45dc9ca239affad'

function zeroXQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
    return {
        provider: '0x', billingMode: 'normal-provider-fee', quoteId: 'zero-x-1', chainId: 56,
        sellToken, buyToken, mode: 'EXACT_INPUT', sellAmount: '1000', buyAmount: '900',
        minimumBuyAmount: '850', maximumSellAmount: '1000', estimatedGas: '210000', estimatedGasUsd: null,
        allowanceTarget: allowanceHolder,
        transaction: { to: settler, data: '0x12345678aabbccdd', value: '0', gas: '210000' },
        platformFee: { amount: '0', token: null, bps: 0 }, approval: null, route: [], permitData: null,
        executable: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides,
    }
}

function uniswapQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
    return {
        provider: 'uniswap', billingMode: 'normal-provider-fee', quoteId: 'uniswap-1', chainId: 56,
        sellToken, buyToken, mode: 'EXACT_INPUT', sellAmount: '1000', buyAmount: '910',
        minimumBuyAmount: '860', maximumSellAmount: '1000', estimatedGas: '240000', estimatedGasUsd: null,
        allowanceTarget: uniswapProxy,
        transaction: { to: uniswapProxy, data: '0x2894adf9aabbccdd', value: '0', gas: '240000' },
        platformFee: { amount: '0', token: null, bps: 0 },
        approval: { mode: 'erc20', contract: uniswapProxy, spender: uniswapProxy, token: sellToken, requiredAmount: '1000' },
        route: [], permitData: null, executable: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides,
    }
}

function provider(name: QuoteProvider['name'], getQuote: QuoteProvider['getQuote']): QuoteProvider {
    return { name, supportsChain: () => true, supportsQuoteMode: () => true, getQuote }
}

describe('exact MegaFuel-sponsored quote validation', () => {
    beforeEach(() => {
        process.env.MEGAFUEL_ZEROX_SAFE_APPROVAL_TARGETS_56 = allowanceHolder
        process.env.MEGAFUEL_ZEROX_SETTLER_ADDRESS_56 = settler
    })

    it('accepts an exact fee-free Uniswap proxy quote', () => {
        const result = validateExactSponsoredQuote({ quote: uniswapQuote(), sellToken, buyToken, sellAmount: 1000n })
        expect(result.provider).toBe('uniswap')
        expect(result.transaction.to).toBe(uniswapProxy)
        expect(result.allowanceTarget).toBe(uniswapProxy)
    })

    it('accepts an exact fee-free 0x AllowanceHolder quote', () => {
        const result = validateExactSponsoredQuote({ quote: zeroXQuote(), sellToken, buyToken, sellAmount: 1000n })
        expect(result.provider).toBe('0x')
        expect(result.transaction.to).toBe(settler)
    })

    it('prefers Uniswap and never calls 0x when Uniswap returns a safe route', async () => {
        const uniswap = provider('uniswap', vi.fn().mockResolvedValue(uniswapQuote()))
        const zeroX = provider('0x', vi.fn().mockRejectedValue(Object.assign(new Error('legal restriction'), { code: 'SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE' })))
        const result = await getExactSponsoredQuote({
            wallet, sellToken, buyToken, sellAmount: 1000n, sellTokenDecimals: 6,
            buyTokenDecimals: 18, slippageBps: 50, providers: [uniswap, zeroX],
        })
        expect(result.provider).toBe('uniswap')
        expect(uniswap.getQuote).toHaveBeenCalledOnce()
        expect(zeroX.getQuote).not.toHaveBeenCalled()
    })

    it('falls back to 0x only when Uniswap cannot provide a route', async () => {
        const uniswap = provider('uniswap', vi.fn().mockRejectedValue(Object.assign(new Error('no route'), { code: 'UNISWAP_NO_ROUTE' })))
        const zeroX = provider('0x', vi.fn().mockResolvedValue(zeroXQuote()))
        const result = await getExactSponsoredQuote({
            wallet, sellToken, buyToken, sellAmount: 1000n, sellTokenDecimals: 6,
            buyTokenDecimals: 18, slippageBps: 50, providers: [uniswap, zeroX],
        })
        expect(result.provider).toBe('0x')
        expect(zeroX.getQuote).toHaveBeenCalledOnce()
    })

    it.each([
        ['provider fee', uniswapQuote({ platformFee: { amount: '1', token: buyToken, bps: 1 } })],
        ['permit payload', uniswapQuote({ permitData: { typedData: {} } })],
        ['wrong Uniswap proxy', uniswapQuote({ allowanceTarget: wallet, transaction: { to: wallet, data: '0x2894adf9aabbccdd', value: '0', gas: '240000' } })],
        ['nonzero native value', uniswapQuote({ transaction: { to: uniswapProxy, data: '0x2894adf9aabbccdd', value: '1', gas: '240000' } })],
    ])('rejects %s before creating a sponsored transaction intent', (_label, candidate) => {
        expect(() => validateExactSponsoredQuote({ quote: candidate, sellToken, buyToken, sellAmount: 1000n })).toThrow()
    })
})
""")
