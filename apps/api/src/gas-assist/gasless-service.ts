import type { Pool, PoolClient } from 'pg'
import {
    createPublicClient,
    http,
    isAddress,
    isAddressEqual,
    isHash,
    keccak256,
    stringToHex,
    zeroAddress,
    type Address,
} from 'viem'
import { bsc } from 'viem/chains'

import { getApiConfig } from '../config.js'
import { getPool } from '../db/client.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../lib/address.js'
import { getTokenPrices, getNativeBnbPrice } from '../providers/alchemy/token-prices.js'
import {
    createZeroXGaslessClient,
    zeroXGaslessClient,
    type GaslessRequest,
} from '../providers/zero-x/gasless-client.js'
import { GasAssistError } from './errors.js'
import {
    hashZeroXTypedData,
    splitZeroXSignature,
    verifyZeroXSignature,
} from './signature-verification.js'
import {
    UINT256_MAX,
    ZEROX_NATIVE_TOKEN,
    type StoredGaslessQuote,
    type ZeroXSigningObject,
    type ZeroXTypedData,
} from './types.js'

const erc20Abi = [
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

export type GaslessInput = {
    chainId: number
    walletAddress: string
    sellToken: string
    buyToken: string
    sellAmount: string
    slippageBps?: number
    clientIp: string
}

type Dependencies = {
    database: Pool
    client: ReturnType<typeof createZeroXGaslessClient>
    now: () => Date
    getBalanceAndDecimals: (wallet: Address, token: Address) => Promise<{ balance: bigint; decimals: number }>
    getTokenPrice: (token: string) => Promise<string | null>
    getTokenDecimals: (token: Address) => Promise<number>
}

function publicClient() {
    const rpcUrl = getApiConfig().quotes.pancakeSwap.rpcUrl
    if (!rpcUrl) throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', 'BSC RPC is not configured for balance and decimal reads.', 503)
    return createPublicClient({ chain: bsc, transport: http(rpcUrl) })
}

function defaults(database: Pool): Dependencies {
    return {
        database,
        client: zeroXGaslessClient,
        now: () => new Date(),
        async getBalanceAndDecimals(wallet, token) {
            const client = publicClient()
            const [balance, decimals] = await Promise.all([
                client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
                client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
            ])
            return { balance, decimals: Number(decimals) }
        },
        async getTokenPrice(token) {
            if (token === ZEROX_NATIVE_TOKEN) return getNativeBnbPrice()
            return (await getTokenPrices({ addresses: [token] })).get(token) ?? null
        },
        async getTokenDecimals(token) {
            const client = publicClient()
            return Number(await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }))
        },
    }
}

function exactPositiveInteger(value: unknown, code = 'INVALID_AMOUNT') {
    const normalized = String(value ?? '')
    if (!/^[1-9]\d*$/.test(normalized)) {
        throw new GasAssistError(code, 'The sell amount must be a positive base-unit integer.')
    }
    return normalized
}

function decimalScale(value: string, scale = 18) {
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('invalid decimal')
    const [whole, fraction = ''] = value.split('.')
    return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.slice(0, scale).padEnd(scale, '0'))
}

function usdValue(raw: string, decimals: number, price: string) {
    return BigInt(raw) * decimalScale(price) / 10n ** BigInt(decimals)
}

type FeePlan = {
    sellValueUsd: bigint
    targetFeeUsd: bigint
    dynamicFeeBps: number
    expectedFeeRaw: string
    estimatedFeeUsd: bigint
    sellPrice: string
    priceTimestamp: string
}

type FeeSchedule = {
    feePercentBps: number
    fixedFeeUsd: string
    maximumFeeUsd: string
}

function formatScaled(value: bigint, scale = 18) {
    const base = 10n ** BigInt(scale)
    const whole = value / base
    const fraction = (value % base).toString().padStart(scale, '0').replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole.toString()
}

function calculateFeePlan(
    sellAmount: string,
    decimals: number,
    sellPrice: string,
    schedule: FeeSchedule = getApiConfig().gasAssist,
    priceTimestamp = new Date().toISOString(),
): FeePlan {
    let sellValueUsd: bigint
    try {
        sellValueUsd = usdValue(sellAmount, decimals, sellPrice)
    } catch {
        throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'The trusted sell-token price is malformed.', 503)
    }
    if (sellValueUsd <= 0n) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'The trusted sell-token price is not usable.', 503)
    const percentage = sellValueUsd * BigInt(schedule.feePercentBps) / 10_000n
    const uncapped = percentage + decimalScale(schedule.fixedFeeUsd)
    const maximum = decimalScale(schedule.maximumFeeUsd)
    const targetFeeUsd = uncapped < maximum ? uncapped : maximum
    const dynamicFeeBpsBigInt = targetFeeUsd * 10_000n / sellValueUsd
    if (dynamicFeeBpsBigInt < 0n || dynamicFeeBpsBigInt > 1_000n) {
        throw new GasAssistError('GAS_ASSIST_FEE_NOT_REPRESENTABLE', 'The Gas Assist fee cannot be represented safely.', 409)
    }
    const dynamicFeeBps = Number(dynamicFeeBpsBigInt)
    const expectedFeeRaw = (BigInt(sellAmount) * dynamicFeeBpsBigInt / 10_000n).toString()
    const estimatedFeeUsd = usdValue(expectedFeeRaw, decimals, sellPrice)
    if (estimatedFeeUsd > targetFeeUsd || estimatedFeeUsd > maximum) {
        throw new GasAssistError('GAS_ASSIST_FEE_NOT_REPRESENTABLE', 'The Gas Assist fee exceeds its configured cap.', 409)
    }
    return { sellValueUsd, targetFeeUsd, dynamicFeeBps, expectedFeeRaw, estimatedFeeUsd, sellPrice, priceTimestamp }
}

function publicFee(plan: FeePlan) {
    return {
        sellValueUsd: formatScaled(plan.sellValueUsd),
        targetFeeUsd: formatScaled(plan.targetFeeUsd),
        dynamicFeeBps: plan.dynamicFeeBps,
        expectedFeeTokenAmount: plan.expectedFeeRaw,
        estimatedFeeUsd: formatScaled(plan.estimatedFeeUsd),
        trustedPrice: plan.sellPrice,
        trustedPriceSource: 'alchemy-token-prices',
        trustedPriceTimestamp: plan.priceTimestamp,
    }
}

function assertAtLeast(value: bigint, configured: string, code: string, message: string) {
    if (value < decimalScale(configured)) throw new GasAssistError(code, message, 400)
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function signingObject(value: unknown): ZeroXSigningObject | null {
    const object = record(value)
    const eip712 = record(object?.eip712)
    if (!object || typeof object.type !== 'string' || !eip712) return null
    const types = record(eip712.types)
    const domain = record(eip712.domain)
    const message = record(eip712.message)
    if (!types || !domain || !message || typeof eip712.primaryType !== 'string') return null
    for (const fields of Object.values(types)) {
        if (!Array.isArray(fields) || fields.some((field) => {
            const item = record(field)
            return !item || typeof item.name !== 'string' || typeof item.type !== 'string'
        })) return null
    }
    return {
        type: object.type,
        ...(typeof object.hash === 'string' ? { hash: object.hash } : {}),
        eip712: {
            types: types as ZeroXTypedData['types'],
            domain,
            message,
            primaryType: eip712.primaryType,
        },
    }
}

function sameAddress(value: unknown, expected: unknown) {
    return typeof value === 'string' && typeof expected === 'string' && isAddress(value) && isAddress(expected) &&
        isAddressEqual(value as Address, expected as Address)
}

function deadlineSeconds(value: unknown) {
    const text = String(value ?? '')
    return /^\d+$/.test(text) ? BigInt(text) : null
}

function getTradeParts(trade: ZeroXSigningObject) {
    const message = trade.eip712.message
    const permitted = record(message.permitted)
    const slippage = record(message.slippageAndActions) ?? record(message.slippage)
    return { message, permitted, slippage }
}

function feeAmount(value: unknown) {
    const item = record(value)
    return item && typeof item.amount === 'string' && /^\d+$/.test(item.amount)
        ? BigInt(item.amount)
        : 0n
}

function validateIntegratorFee(fees: Record<string, unknown>, input: ReturnType<typeof normalizeInput>, feePlan: FeePlan) {
    const integratorFees = Array.isArray(fees.integratorFees)
        ? fees.integratorFees
        : [fees.integratorFee]
    const integratorTotal = integratorFees.reduce((sum, fee) => sum + feeAmount(fee), 0n)
    if (
        integratorFees.some((fee) => feeAmount(fee) > 0n && !sameAddress(record(fee)?.token, input.sellToken)) ||
        (feePlan.dynamicFeeBps > 0 && integratorTotal === 0n) ||
        integratorTotal !== BigInt(feePlan.expectedFeeRaw)
    ) {
        throw new GasAssistError('GAS_ASSIST_INTEGRATOR_FEE_MISMATCH', '0x returned an inconsistent PistachioSwap fee.', 502)
    }
}

function validateNoIntegratorFee(fees: Record<string, unknown>) {
    const integratorFees = [
        ...(Array.isArray(fees.integratorFees) ? fees.integratorFees : []),
        fees.integratorFee,
    ]
    if (integratorFees.some((fee) => feeAmount(fee) !== 0n)) {
        throw new GasAssistError('BILLING_MODE_CONFLICT', '0x returned an integrator fee for a prepaid order.', 502)
    }
}

function validateProviderQuote(payload: Record<string, unknown>, input: ReturnType<typeof normalizeInput>, feePlan?: FeePlan) {
    const config = getApiConfig()
    if (payload.liquidityAvailable !== true) {
        throw new GasAssistError('ZEROX_NO_LIQUIDITY', '0x found no Gasless liquidity for this trade.')
    }
    const issues = record(payload.issues)
    const allowanceIssue = issues?.allowance ?? null
    const approvalRequired = allowanceIssue !== null
    const approval = payload.approval === null ? null : signingObject(payload.approval)
    const trade = signingObject(payload.trade)
    if (!issues || !trade || trade.type !== 'settler_metatransaction') {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an unsupported Gasless quote.', 502)
    }
    if (approvalRequired && !sameAddress(record(allowanceIssue)?.spender, payload.allowanceTarget)) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an allowance issue without a valid spender.', 502)
    }
    if (issues.balance !== null && issues.balance !== undefined) {
        throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', '0x reports an insufficient token balance.')
    }
    if (issues.simulationIncomplete === true) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x could not complete quote simulation.', 409)
    }
    if (approvalRequired && !approval) {
        throw new GasAssistError(
            'ONCHAIN_APPROVAL_REQUIRED',
            'This token requires a one-time on-chain approval before it can be swapped gaslessly.',
            409,
        )
    }
    if (!approvalRequired && approval) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an inconsistent approval state.', 502)
    }
    if (
        !sameAddress(payload.sellToken, input.sellToken) ||
        !sameAddress(payload.buyToken, input.buyToken) ||
        (payload.taker !== undefined && !sameAddress(payload.taker, input.walletAddress)) ||
        (payload.recipient !== undefined && !sameAddress(payload.recipient, input.walletAddress))
    ) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned different quote tokens.', 502)
    }
    const quotedSellAmount = exactPositiveInteger(payload.sellAmount)
    const buyAmount = exactPositiveInteger(payload.buyAmount)
    const minimumBuyAmount = exactPositiveInteger(payload.minBuyAmount)
    if (BigInt(quotedSellAmount) > BigInt(input.sellAmount) || BigInt(minimumBuyAmount) > BigInt(buyAmount)) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned incoherent quote amounts.', 502)
    }
    const { message, permitted, slippage } = getTradeParts(trade)
    if (
        Number(trade.eip712.domain.chainId) !== 56 ||
        !permitted ||
        !sameAddress(permitted.token, input.sellToken) ||
        String(permitted.amount) !== input.sellAmount ||
        !slippage ||
        !sameAddress(slippage.recipient, input.walletAddress) ||
        !sameAddress(slippage.buyToken, input.buyToken) ||
        String(slippage.minAmountOut) !== minimumBuyAmount ||
        !deadlineSeconds(message.deadline)
    ) {
        throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned unsafe trade typed data.', 502)
    }

    let approvalAmount: string | null = null
    let approvalUnlimited = false
    if (approval) {
        const message = approval.eip712.message
        const allowance = record(allowanceIssue)
        if (
            approval.type !== 'permit' ||
            approval.eip712.primaryType !== 'Permit' ||
            Number(approval.eip712.domain.chainId) !== 56 ||
            !sameAddress(approval.eip712.domain.verifyingContract, input.sellToken) ||
            !sameAddress(message.owner, input.walletAddress) ||
            !sameAddress(message.spender, allowance?.spender) ||
            !sameAddress(payload.allowanceTarget, allowance?.spender)
        ) {
            throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned unsafe approval typed data.', 502)
        }
        approvalAmount = exactPositiveInteger(message.value)
        if (BigInt(approvalAmount) < BigInt(input.sellAmount)) {
            throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', 'The gasless permit is below the requested sell amount.', 502)
        }
        approvalUnlimited = approvalAmount === UINT256_MAX
        if (approvalUnlimited && config.gasAssist.rejectUnlimitedPermits) {
            throw new GasAssistError('UNLIMITED_PERMIT_NOT_ALLOWED', 'Unlimited gasless permits are disabled by policy.', 403)
        }
    }

    const fees = record(payload.fees) ?? {}
    if (feePlan) validateIntegratorFee(fees, input, feePlan)
    const route = record(payload.route) ?? {}
    const ttlDeadline = [deadlineSeconds(trade.eip712.message.deadline), approval ? deadlineSeconds(approval.eip712.message.deadline) : null]
        .filter((value): value is bigint => value !== null)
        .reduce((minimum, value) => value < minimum ? value : minimum)
    const providerExpiresAt = new Date(Number(ttlDeadline) * 1_000)
    return {
        zid: typeof payload.zid === 'string' ? payload.zid : null,
        quotedSellAmount,
        buyAmount,
        minimumBuyAmount,
        fees,
        route,
        approval,
        trade,
        approvalRequired,
        approvalAmount,
        approvalUnlimited,
        providerExpiresAt,
    }
}

function normalizeInput(input: GaslessInput) {
    const walletAddress = normalizeAddress(input.walletAddress)
    const sellToken = normalizeAddress(input.sellToken)
    const requestedBuyToken = normalizeAddress(input.buyToken)
    if (input.chainId !== 56) throw new GasAssistError('WRONG_CHAIN', 'Gas Assist supports only BNB Chain.')
    if (!walletAddress || walletAddress === zeroAddress) throw new GasAssistError('INVALID_WALLET', 'A valid wallet address is required.')
    if (!sellToken || sellToken === zeroAddress) throw new GasAssistError('INVALID_SELL_TOKEN', 'A valid BEP-20 sell token is required.')
    if (!requestedBuyToken) throw new GasAssistError('INVALID_BUY_TOKEN', 'A valid BEP-20 or native BNB buy token is required.')
    if (sellToken === NATIVE_TOKEN_ADDRESS || sellToken === ZEROX_NATIVE_TOKEN) {
        throw new GasAssistError('NATIVE_SELL_TOKEN_UNSUPPORTED', 'Gas Assist cannot sell native BNB.')
    }
    const buyToken = requestedBuyToken === NATIVE_TOKEN_ADDRESS ? ZEROX_NATIVE_TOKEN : requestedBuyToken
    if (sameAddress(sellToken, buyToken)) throw new GasAssistError('IDENTICAL_TOKEN_PAIR', 'Sell and buy tokens must differ.')
    const sellAmount = exactPositiveInteger(input.sellAmount)
    const slippageBps = input.slippageBps ?? 50
    if (!Number.isInteger(slippageBps) || slippageBps < 30 || slippageBps > 10_000) {
        throw new GasAssistError('INVALID_AMOUNT', 'Gas Assist slippage must be between 30 and 10000 BPS.')
    }
    return { chainId: 56 as const, walletAddress, sellToken, buyToken, sellAmount, slippageBps, clientIp: input.clientIp }
}

async function preliminary(input: ReturnType<typeof normalizeInput>, dependencies: Dependencies) {
    const config = getApiConfig()
    const [{ balance, decimals }, sellPrice, buyDecimals, buyPrice] = await Promise.all([
        dependencies.getBalanceAndDecimals(input.walletAddress as Address, input.sellToken as Address),
        dependencies.getTokenPrice(input.sellToken),
        input.buyToken === ZEROX_NATIVE_TOKEN
            ? Promise.resolve(18)
            : dependencies.getTokenDecimals(input.buyToken as Address),
        dependencies.getTokenPrice(input.buyToken),
    ])
    if (balance < BigInt(input.sellAmount)) throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', 'The wallet token balance is insufficient.')
    if (!sellPrice) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'A trusted sell-token price is unavailable.', 503)
    if (!buyPrice) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'A trusted buy-token price is unavailable.', 503)
    const feePlan = calculateFeePlan(input.sellAmount, decimals, sellPrice, config.gasAssist)
    const sellUsd = feePlan.sellValueUsd
    assertAtLeast(sellUsd, config.gasAssist.minimumSellUsd, 'SELL_VALUE_TOO_LOW', 'The sell value is below the Gas Assist minimum.')
    if (sellUsd < decimalScale('0.10')) throw new GasAssistError('SELL_VALUE_TOO_LOW', 'Gas Assist never accepts balances worth less than $0.10.')
    return { decimals, sellPrice, sellUsd, buyDecimals, buyPrice, feePlan }
}

function providerRequest(input: ReturnType<typeof normalizeInput>, feePlan?: FeePlan): GaslessRequest {
    const config = getApiConfig()
    return {
        chainId: 56,
        sellToken: input.sellToken,
        buyToken: input.buyToken,
        sellAmount: input.sellAmount,
        taker: input.walletAddress,
        recipient: input.walletAddress,
        slippageBps: input.slippageBps,
        ...(feePlan && feePlan.dynamicFeeBps > 0 ? {
            swapFeeRecipient: config.fees.treasuryAddress!,
            swapFeeBps: feePlan.dynamicFeeBps,
            swapFeeToken: input.sellToken,
        } : {}),
    }
}

function publicSummary(validated: ReturnType<typeof validateProviderQuote>, feePlan: FeePlan) {
    return {
        sellAmount: validated.quotedSellAmount,
        buyAmount: validated.buyAmount,
        minBuyAmount: validated.minimumBuyAmount,
        fees: validated.fees,
        fee: publicFee(feePlan),
        routeSummary: Array.isArray(validated.route.fills) ? validated.route.fills : [],
        approvalRequired: validated.approvalRequired,
        billingMode: 'provider-integrator' as const,
        gaslessApprovalAvailable: Boolean(validated.approval),
        approval: validated.approval ? {
            type: validated.approval.type,
            eip712: validated.approval.eip712,
            approvalAmount: validated.approvalAmount,
            isUnlimited: validated.approvalUnlimited,
        } : null,
        trade: { type: validated.trade.type, eip712: validated.trade.eip712 },
    }
}

async function economicChecks(
    validated: ReturnType<typeof validateProviderQuote>,
    sellUsd: bigint,
    buyDecimals: number,
    buyPrice: string,
) {
    const config = getApiConfig()
    let outputUsd: bigint
    try {
        outputUsd = usdValue(validated.buyAmount, buyDecimals, buyPrice)
    } catch {
        throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'The trusted buy-token price is malformed.', 503)
    }
    assertAtLeast(outputUsd, config.gasAssist.minimumUserOutputUsd, 'USER_OUTPUT_TOO_LOW', 'The expected user output is below the Gas Assist minimum.')
    const impactBps = outputUsd >= sellUsd ? 0n : (sellUsd - outputUsd) * 10_000n / sellUsd
    if (impactBps > BigInt(config.gasAssist.maximumPriceImpactBps)) {
        throw new GasAssistError('PRICE_IMPACT_TOO_HIGH', 'The Gas Assist trade has excessive price impact.', 409)
    }
}

function assertMode() {
    if (getApiConfig().gasAssist.mode !== 'zero-x-gasless') {
        throw new GasAssistError('GAS_ASSIST_DISABLED', '0x Gas Assist is disabled.', 503)
    }
}

export function createGaslessService(overrides: Partial<Dependencies> = {}) {
    const dependencies = {
        ...defaults(overrides.database ?? getPool()),
        ...overrides,
    }

    async function price(raw: GaslessInput) {
        assertMode()
        const input = normalizeInput(raw)
        const { sellUsd, buyDecimals, buyPrice, feePlan } = await preliminary(input, dependencies)
        const payload = await dependencies.client.getGaslessPrice(providerRequest(input, feePlan))
        if (
            payload.liquidityAvailable !== true ||
            !sameAddress(payload.sellToken, input.sellToken) ||
            !sameAddress(payload.buyToken, input.buyToken)
        ) {
            throw new GasAssistError('ZEROX_NO_LIQUIDITY', '0x found no valid Gasless liquidity for this trade.')
        }
        const buyAmount = exactPositiveInteger(payload.buyAmount)
        const minimumBuyAmount = exactPositiveInteger(payload.minBuyAmount)
        const quotedSellAmount = exactPositiveInteger(payload.sellAmount)
        if (BigInt(quotedSellAmount) > BigInt(input.sellAmount) || BigInt(minimumBuyAmount) > BigInt(buyAmount)) {
            throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned incoherent Gasless price amounts.', 502)
        }
        const issues = record(payload.issues)
        if (!issues || issues.balance !== null && issues.balance !== undefined) {
            throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', '0x reports an insufficient token balance.')
        }
        await economicChecks({ buyAmount } as ReturnType<typeof validateProviderQuote>, sellUsd, buyDecimals, buyPrice)
        const fees = record(payload.fees) ?? {}
        validateIntegratorFee(fees, input, feePlan)
        const route = record(payload.route) ?? {}
        return {
            chainId: 56,
            sellToken: input.sellToken,
            buyToken: input.buyToken,
            requestedSellAmount: input.sellAmount,
            sellAmount: quotedSellAmount,
            buyAmount,
            minBuyAmount: minimumBuyAmount,
            fees,
            fee: publicFee(feePlan),
            routeSummary: Array.isArray(route.fills) ? route.fills : [],
            approvalRequired: issues.allowance !== null,
        }
    }

    async function probePrepaid(raw: GaslessInput) {
        assertMode()
        const input = normalizeInput(raw)
        const { sellUsd, buyDecimals, buyPrice } = await preliminary(input, dependencies)
        const payload = await dependencies.client.getGaslessPrice(providerRequest(input))
        if (
            payload.liquidityAvailable !== true ||
            !sameAddress(payload.sellToken, input.sellToken) ||
            !sameAddress(payload.buyToken, input.buyToken)
        ) {
            return { route: 'unavailable' as const, reason: 'ZEROX_NO_LIQUIDITY' }
        }
        const quotedSellAmount = exactPositiveInteger(payload.sellAmount)
        const buyAmount = exactPositiveInteger(payload.buyAmount)
        const minimumBuyAmount = exactPositiveInteger(payload.minBuyAmount)
        if (BigInt(quotedSellAmount) > BigInt(input.sellAmount) || BigInt(minimumBuyAmount) > BigInt(buyAmount)) {
            throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned incoherent Gasless price amounts.', 502)
        }
        const issues = record(payload.issues)
        if (!issues || issues.balance !== null && issues.balance !== undefined || issues.simulationIncomplete === true) {
            throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x could not simulate the prepaid Gasless route.', 409)
        }
        const fees = record(payload.fees) ?? {}
        const integratorTotal = [
            ...(Array.isArray(fees.integratorFees) ? fees.integratorFees : []),
            fees.integratorFee,
        ].reduce((sum, fee) => sum + feeAmount(fee), 0n)
        if (integratorTotal !== 0n) {
            throw new GasAssistError('BILLING_MODE_CONFLICT', '0x returned a provider integrator fee for a prepaid order.', 502)
        }
        await economicChecks({ buyAmount } as ReturnType<typeof validateProviderQuote>, sellUsd, buyDecimals, buyPrice)
        const allowance = record(issues.allowance)
        if (!allowance) {
            return {
                route: 'direct' as const,
                sellAmount: quotedSellAmount,
                buyAmount,
                minimumBuyAmount,
                fees,
            }
        }
        const spender = normalizeAddress(allowance.spender ?? payload.allowanceTarget)
        if (!spender || !sameAddress(spender, payload.allowanceTarget)) {
            throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an invalid approval target.', 502)
        }
        return {
            route: 'onchain-approval' as const,
            spender,
            sellAmount: quotedSellAmount,
            buyAmount,
            minimumBuyAmount,
            fees,
        }
    }

    async function quote(raw: GaslessInput) {
        assertMode()
        const input = normalizeInput(raw)
        const { sellUsd, buyDecimals, buyPrice, feePlan } = await preliminary(input, dependencies)
        const count = await dependencies.database.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM gas_assist_gasless_quotes
             WHERE chain_id=56 AND wallet_address=$1 AND created_at > now() - interval '1 hour'`,
            [input.walletAddress],
        )
        if (Number(count.rows[0]?.count ?? 0) >= getApiConfig().gasAssist.quoteWalletLimitPerHour) {
            throw new GasAssistError('RATE_LIMITED', 'The wallet Gas Assist quote limit has been reached.', 429)
        }
        const payload = await dependencies.client.getGaslessQuote(providerRequest(input, feePlan))
        const validated = validateProviderQuote(payload, input, feePlan)
        await economicChecks(validated, sellUsd, buyDecimals, buyPrice)
        const now = dependencies.now()
        const localExpiry = new Date(now.getTime() + getApiConfig().gasAssist.quoteTtlSeconds * 1_000)
        const expiresAt = validated.providerExpiresAt < localExpiry ? validated.providerExpiresAt : localExpiry
        if (expiresAt <= now) throw new GasAssistError('QUOTE_EXPIRED', 'The 0x quote has already expired.', 409)
        const inserted = await dependencies.database.query<{ id: string }>(
            `INSERT INTO gas_assist_gasless_quotes
             (zid,chain_id,wallet_address,sell_token_address,buy_token_address,requested_sell_amount,
              quoted_sell_amount,buy_amount,minimum_buy_amount,fees,route,approval,trade,
              approval_required,gasless_approval_available,approval_amount,approval_unlimited,expires_at)
             VALUES ($1,56,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)
             RETURNING id`,
            [validated.zid, input.walletAddress, input.sellToken, input.buyToken, input.sellAmount,
                validated.quotedSellAmount, validated.buyAmount, validated.minimumBuyAmount,
                JSON.stringify({ ...validated.fees, pistachioSwap: publicFee(feePlan) }), JSON.stringify(validated.route),
                validated.approval ? JSON.stringify(validated.approval) : null,
                JSON.stringify(validated.trade), validated.approvalRequired, Boolean(validated.approval),
                validated.approvalAmount, validated.approvalUnlimited, expiresAt],
        )
        return {
            quoteId: inserted.rows[0]!.id,
            expiresAt: expiresAt.toISOString(),
            chainId: 56,
            walletAddress: input.walletAddress,
            sellToken: input.sellToken,
            buyToken: input.buyToken,
            requestedSellAmount: input.sellAmount,
            ...publicSummary(validated, feePlan),
        }
    }

    async function quotePrepaid(raw: GaslessInput, sponsorshipOrderId: string) {
        assertMode()
        if (!getApiConfig().sponsorship.enabled) {
            throw new GasAssistError('SPONSORSHIP_DISABLED', 'Prepaid Gas Assist is disabled.', 503)
        }
        const input = normalizeInput(raw)
        const { sellUsd, buyDecimals, buyPrice } = await preliminary(input, dependencies)
        const payload = await dependencies.client.getGaslessQuote(providerRequest(input))
        const validated = validateProviderQuote(payload, input)
        validateNoIntegratorFee(validated.fees)
        if (validated.approvalRequired || validated.approval) {
            throw new GasAssistError('APPROVAL_NOT_CONFIRMED', '0x still reports an approval requirement after the sponsored approval.', 409)
        }
        await economicChecks(validated, sellUsd, buyDecimals, buyPrice)
        const now = dependencies.now()
        const localExpiry = new Date(now.getTime() + getApiConfig().sponsorship.actionIntentTtlSeconds * 1_000)
        const expiresAt = validated.providerExpiresAt < localExpiry ? validated.providerExpiresAt : localExpiry
        if (expiresAt <= now) throw new GasAssistError('QUOTE_EXPIRED', 'The 0x quote has already expired.', 409)
        const inserted = await dependencies.database.query<{ id: string }>(
            `INSERT INTO gas_assist_gasless_quotes
             (sponsorship_order_id,billing_mode,zid,chain_id,wallet_address,sell_token_address,buy_token_address,requested_sell_amount,
              quoted_sell_amount,buy_amount,minimum_buy_amount,fees,route,approval,trade,
              approval_required,gasless_approval_available,approval_amount,approval_unlimited,expires_at)
             VALUES ($1,'prepaid-megafuel',$2,56,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)
             RETURNING id`,
            [sponsorshipOrderId, validated.zid, input.walletAddress, input.sellToken, input.buyToken, input.sellAmount,
                validated.quotedSellAmount, validated.buyAmount, validated.minimumBuyAmount,
                JSON.stringify({ ...validated.fees, billingMode: 'prepaid-megafuel' }), JSON.stringify(validated.route),
                validated.approval ? JSON.stringify(validated.approval) : null, JSON.stringify(validated.trade),
                validated.approvalRequired, Boolean(validated.approval), validated.approvalAmount,
                validated.approvalUnlimited, expiresAt],
        )
        return {
            quoteId: inserted.rows[0]!.id,
            expiresAt: expiresAt.toISOString(),
            chainId: 56,
            walletAddress: input.walletAddress,
            sellToken: input.sellToken,
            buyToken: input.buyToken,
            requestedSellAmount: input.sellAmount,
            billingMode: 'prepaid-megafuel' as const,
            sellAmount: validated.quotedSellAmount,
            buyAmount: validated.buyAmount,
            minBuyAmount: validated.minimumBuyAmount,
            fees: validated.fees,
            fee: {
                billingMode: 'prepaid-megafuel',
                integratorFeeAmount: '0',
            },
            routeSummary: Array.isArray(validated.route.fills) ? validated.route.fills : [],
            approvalRequired: false,
            gaslessApprovalAvailable: false,
            approval: null,
            trade: { type: validated.trade.type, eip712: validated.trade.eip712 },
        }
    }

    async function load(quoteId: string, client: Pool | PoolClient = dependencies.database) {
        const result = await client.query<StoredGaslessQuote>(
            `SELECT id,sponsorship_order_id AS "sponsorshipOrderId",billing_mode AS "billingMode",zid,chain_id AS "chainId",wallet_address AS "walletAddress",
             sell_token_address AS "sellTokenAddress",requested_sell_amount AS "requestedSellAmount",
             buy_token_address AS "buyTokenAddress",
             quoted_sell_amount AS "quotedSellAmount",buy_amount AS "buyAmount",
             minimum_buy_amount AS "minimumBuyAmount",fees,route,approval,trade,
             approval_required AS "approvalRequired",gasless_approval_available AS "gaslessApprovalAvailable",
             approval_amount AS "approvalAmount",approval_unlimited AS "approvalUnlimited",status,expires_at AS "expiresAt",
             trade_hash AS "tradeHash",transaction_hash AS "transactionHash",provider_status AS "providerStatus",
             approval_signature_hash AS "approvalSignatureHash",trade_signature_hash AS "tradeSignatureHash",
             submission_attempts AS "submissionAttempts",last_status_checked_at AS "lastStatusCheckedAt"
             FROM gas_assist_gasless_quotes WHERE id=$1`,
            [quoteId],
        )
        return result.rows[0] ?? null
    }

    async function submit(input: { quoteId: string; approvalSignature: string | null; tradeSignature: string }) {
        assertMode()
        let stored = await load(input.quoteId)
        if (!stored) throw new GasAssistError('QUOTE_NOT_FOUND', 'The Gas Assist quote was not found.', 404)
        if (stored.expiresAt <= dependencies.now()) throw new GasAssistError('QUOTE_EXPIRED', 'The Gas Assist quote expired.', 409)
        if (!input.tradeSignature) throw new GasAssistError('SIGNATURE_REQUIRED', 'A trade signature is required.')
        if (stored.approvalRequired && !input.approvalSignature) throw new GasAssistError('SIGNATURE_REQUIRED', 'An approval signature is required.')
        if (!stored.approvalRequired && input.approvalSignature) throw new GasAssistError('SIGNATURE_INVALID', 'This quote does not accept an approval signature.')
        await verifyZeroXSignature(stored.trade.eip712, input.tradeSignature, stored.walletAddress)
        if (stored.approval && input.approvalSignature) {
            await verifyZeroXSignature(stored.approval.eip712, input.approvalSignature, stored.walletAddress)
        }
        const tradeSignatureHash = keccak256(stringToHex(input.tradeSignature))
        const approvalSignatureHash = input.approvalSignature ? keccak256(stringToHex(input.approvalSignature)) : null
        const connection = await dependencies.database.connect()
        try {
            await connection.query('BEGIN')
            const locked = await connection.query<{ status: string; tradeHash: string | null; tradeSignatureHash: string | null; approvalSignatureHash: string | null }>(
                `SELECT status,trade_hash AS "tradeHash",trade_signature_hash AS "tradeSignatureHash",
                 approval_signature_hash AS "approvalSignatureHash" FROM gas_assist_gasless_quotes WHERE id=$1 FOR UPDATE`,
                [stored.id],
            )
            const current = locked.rows[0]
            if (!current) throw new GasAssistError('QUOTE_NOT_FOUND', 'The Gas Assist quote was not found.', 404)
            if (current.tradeHash && current.tradeSignatureHash === tradeSignatureHash && current.approvalSignatureHash === approvalSignatureHash) {
                await connection.query('COMMIT')
                return { status: 'submitted', tradeHash: current.tradeHash }
            }
            if (current.status === 'submitting') throw new GasAssistError('SUBMIT_IN_PROGRESS', 'This quote is already being submitted.', 409)
            if (current.status !== 'awaiting_signatures') throw new GasAssistError('QUOTE_ALREADY_USED', 'This quote cannot be submitted again.', 409)
            await connection.query(
                `UPDATE gas_assist_gasless_quotes SET status='submitting',submission_attempts=submission_attempts+1,
                 approval_signature_hash=$2,trade_signature_hash=$3,updated_at=now() WHERE id=$1`,
                [stored.id, approvalSignatureHash, tradeSignatureHash],
            )
            await connection.query('COMMIT')
        } catch (error) {
            await connection.query('ROLLBACK').catch(() => undefined)
            throw error
        } finally {
            connection.release()
        }
        stored = (await load(stored.id))!
        const trade = {
            type: stored.trade.type,
            eip712: stored.trade.eip712,
            signature: splitZeroXSignature(input.tradeSignature),
        }
        const approval = stored.approval && input.approvalSignature ? {
            type: stored.approval.type,
            eip712: stored.approval.eip712,
            signature: splitZeroXSignature(input.approvalSignature),
        } : undefined
        try {
            const response = await dependencies.client.submitGaslessTrade({ chainId: 56, trade, ...(approval ? { approval } : {}) })
            const responseTradeHash = typeof response.tradeHash === 'string' ? response.tradeHash : ''
            if (!isHash(responseTradeHash) || responseTradeHash !== stored.trade.hash) {
                throw new GasAssistError('ZEROX_GASLESS_RESPONSE_INVALID', '0x returned an unexpected trade hash.', 502)
            }
            await dependencies.database.query(
                `UPDATE gas_assist_gasless_quotes SET status='submitted',trade_hash=$2,zid=COALESCE($3,zid),
                 provider_status='submitted',updated_at=now() WHERE id=$1 AND status='submitting'`,
                [stored.id, responseTradeHash, typeof response.zid === 'string' ? response.zid : null],
            )
            return { status: 'submitted', tradeHash: responseTradeHash }
        } catch (error) {
            await dependencies.database.query(
                `UPDATE gas_assist_gasless_quotes SET status='failed',failure_code=$2,updated_at=now()
                 WHERE id=$1 AND status='submitting'`,
                [stored.id, error instanceof GasAssistError ? error.code : 'ZEROX_SUBMIT_FAILED'],
            )
            if (error instanceof GasAssistError) throw error
            throw new GasAssistError('ZEROX_SUBMIT_FAILED', '0x could not submit the Gas Assist trade.', 502)
        }
    }

    async function status(tradeHash: string) {
        assertMode()
        if (!isHash(tradeHash)) throw new GasAssistError('QUOTE_NOT_FOUND', 'The Gas Assist trade was not found.', 404)
        const found = await dependencies.database.query<{ id: string; lastStatusCheckedAt: Date | null; status: string; transactionHash: string | null }>(
            `SELECT id,last_status_checked_at AS "lastStatusCheckedAt",status,transaction_hash AS "transactionHash"
             FROM gas_assist_gasless_quotes WHERE chain_id=56 AND trade_hash=$1`, [tradeHash],
        )
        const local = found.rows[0]
        if (!local) throw new GasAssistError('QUOTE_NOT_FOUND', 'The Gas Assist trade was not found.', 404)
        if (['confirmed', 'failed'].includes(local.status)) {
            return { status: local.status, tradeHash, transactionHash: local.transactionHash }
        }
        if (local.lastStatusCheckedAt && dependencies.now().getTime() - local.lastStatusCheckedAt.getTime() < getApiConfig().gasAssist.statusPollIntervalMs) {
            return { status: local.status, tradeHash, transactionHash: local.transactionHash }
        }
        const response = await dependencies.client.getGaslessStatus(tradeHash)
        const providerStatus = typeof response.status === 'string' ? response.status : ''
        const allowed = new Set(['pending', 'submitted', 'succeeded', 'confirmed', 'failed'])
        if (!allowed.has(providerStatus)) throw new GasAssistError('STATUS_UNAVAILABLE', '0x returned an unknown trade status.', 502)
        const transactions = Array.isArray(response.transactions) ? response.transactions : []
        const transactionHash = transactions
            .map(record)
            .map((item) => item && typeof item.hash === 'string' ? item.hash : null)
            .find((hash) => hash !== null && isHash(hash)) ?? undefined
        await dependencies.database.query(
            `UPDATE gas_assist_gasless_quotes SET status=$2,provider_status=$2,transaction_hash=COALESCE($3,transaction_hash),
             failure_code=CASE WHEN $2='failed' THEN $4 ELSE failure_code END,last_status_checked_at=now(),updated_at=now() WHERE id=$1`,
            [local.id, providerStatus, transactionHash ?? null, providerStatus === 'failed' ? String(response.reason ?? 'TRADE_FAILED') : null],
        )
        return { status: providerStatus, tradeHash, transactionHash: transactionHash ?? local.transactionHash }
    }

    return { price, probePrepaid, quote, quotePrepaid, submit, status, load }
}

let singleton: ReturnType<typeof createGaslessService> | null = null
export function gaslessService() {
    singleton ??= createGaslessService()
    return singleton
}

export const gaslessInternals = {
    normalizeInput,
    validateProviderQuote,
    calculateFeePlan,
    publicFee,
    splitZeroXSignature,
    hashZeroXTypedData,
}
