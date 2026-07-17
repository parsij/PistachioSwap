import {
    encodeAbiParameters,
    encodeEventTopics,
    keccak256,
    parseAbiParameters,
    type Address,
    type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
    buildPaymentTransfer,
    transferEventAbi,
    validateSignedIntent,
    verifyExactTransferReceipt,
} from '../src/gas-assist/prepaid/chain-client.js'
import {
    calculatePrepayment,
    parseFixed,
    usdMicrosToTokenRawCeil,
} from '../src/gas-assist/prepaid/fixed-point.js'
import {
    selectPaymentToken,
    type PaymentTokenCandidate,
} from '../src/gas-assist/prepaid/payment-token-selection.js'
import { sponsorshipRouteInternals } from '../src/modules/sponsorship.js'

const wallet = privateKeyToAccount(
    '0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d',
)
const otherWallet = privateKeyToAccount(
    '0x8b3a350cf5c34c9194ca3a545d93b55bcb5d42f4e9ecf9f4ce9a0b23ca8c4210',
)
const token = '0x1111111111111111111111111111111111111111' as Address
const treasury = '0x2222222222222222222222222222222222222222' as Address
const sellToken = '0x3333333333333333333333333333333333333333'
const buyToken = '0x4444444444444444444444444444444444444444'

describe('prepaid sponsorship fixed-point billing', () => {
    it('adds $0.067 and 3%, caps only commercial fees, and reserves gas at exactly 1.5x', () => {
        const result = calculatePrepayment({
            tradeNotionalUsdMicros: parseFixed('100'),
            paymentTransferGasUsdMicros: parseFixed('0.02'),
            approvalGasUsdMicros: parseFixed('0.03'),
            normalSwapGasUsdMicros: 0n,
            flow: 'zero-x-gasless-after-approval',
            gasMultiplierBps: 15_000,
            fixedFeeUsdMicros: parseFixed('0.067'),
            platformFeeBps: 300,
            commercialFeeCapUsdMicros: parseFixed('5'),
        })
        expect(result.fixedServiceFeeUsdMicros).toBe(67_000n)
        expect(result.platformFeeUsdMicros).toBe(3_000_000n)
        expect(result.commercialFeeUsdMicros).toBe(3_067_000n)
        expect(result.estimatedSponsoredGasUsdMicros).toBe(50_000n)
        expect(result.gasReserveUsdMicros).toBe(75_000n)
        expect(result.totalPrepaymentUsdMicros).toBe(3_142_000n)
    })

    it('keeps gas reserve outside the $5 cap', () => {
        const result = calculatePrepayment({
            tradeNotionalUsdMicros: parseFixed('1000'),
            paymentTransferGasUsdMicros: parseFixed('1'),
            approvalGasUsdMicros: parseFixed('1'),
            normalSwapGasUsdMicros: 0n,
            flow: 'zero-x-gasless-after-approval',
            gasMultiplierBps: 15_000,
            fixedFeeUsdMicros: parseFixed('0.067'),
            platformFeeBps: 300,
            commercialFeeCapUsdMicros: parseFixed('5'),
        })
        expect(result.commercialFeeUsdMicros).toBe(5_000_000n)
        expect(result.gasReserveUsdMicros).toBe(3_000_000n)
        expect(result.totalPrepaymentUsdMicros).toBe(8_000_000n)
    })

    it('charges no signature gas and no MegaFuel swap gas for 0x Gasless', () => {
        expect(() => calculatePrepayment({
            tradeNotionalUsdMicros: parseFixed('10'),
            paymentTransferGasUsdMicros: 1n,
            approvalGasUsdMicros: 1n,
            normalSwapGasUsdMicros: 1n,
            flow: 'zero-x-gasless-after-approval',
            gasMultiplierBps: 15_000,
            fixedFeeUsdMicros: 67_000n,
            platformFeeBps: 300,
            commercialFeeCapUsdMicros: 5_000_000n,
        })).toThrow(/must not be included/)
    })

    it('includes normal sponsored swap gas only for the normal sponsored flow', () => {
        const result = calculatePrepayment({
            tradeNotionalUsdMicros: parseFixed('10'),
            paymentTransferGasUsdMicros: 10n,
            approvalGasUsdMicros: 20n,
            normalSwapGasUsdMicros: 30n,
            flow: 'normal-sponsored-swap',
            gasMultiplierBps: 15_000,
            fixedFeeUsdMicros: 67_000n,
            platformFeeBps: 300,
            commercialFeeCapUsdMicros: 5_000_000n,
        })
        expect(result.estimatedSponsoredGasUsdMicros).toBe(60n)
        expect(result.gasReserveUsdMicros).toBe(90n)
    })

    it('rounds USD-to-token conversion upward', () => {
        expect(usdMicrosToTokenRawCeil({
            usdMicros: 1n,
            tokenPriceUsdMicros: 3n,
            tokenDecimals: 0,
        })).toBe(1n)
    })

    it('rejects prepaid and provider-integrator double billing', () => {
        expect(() => calculatePrepayment({
            tradeNotionalUsdMicros: 1_000_000n,
            paymentTransferGasUsdMicros: 1n,
            approvalGasUsdMicros: 1n,
            normalSwapGasUsdMicros: 0n,
            flow: 'zero-x-gasless-after-approval',
            gasMultiplierBps: 15_000,
            fixedFeeUsdMicros: 67_000n,
            platformFeeBps: 300,
            commercialFeeCapUsdMicros: 5_000_000n,
            providerIntegratorFeeBps: 300,
        })).toThrow(/cannot coexist/)
    })
})

function candidate(overrides: Partial<PaymentTokenCandidate> = {}): PaymentTokenCandidate {
    return {
        chainId: 56,
        tokenAddress: sellToken,
        symbol: 'SELL',
        decimals: 18,
        onchainDecimals: 18,
        enabled: true,
        feePaymentEnabled: true,
        isStablecoin: false,
        paymentPriority: 10,
        minimumLiquidityUsdMicros: parseFixed('100000'),
        maximumPriceAgeSeconds: 300,
        maximumPriceDeviationBps: 300,
        exactTransferRequired: true,
        feeOnTransferAllowed: false,
        rebasingAllowed: false,
        strictSecurityRequired: true,
        priceUsdMicros: parseFixed('1'),
        priceObservedAt: new Date('2026-01-01T00:00:00Z'),
        priceDeviationBps: 10,
        liquidityUsdMicros: parseFixed('200000'),
        balanceRaw: 1_000n,
        transferBehavior: 'exact',
        securityStatus: 'low',
        ...overrides,
    }
}

function select(candidates: PaymentTokenCandidate[]) {
    return selectPaymentToken({
        candidates,
        requiredPaymentRawByToken: new Map(candidates.map((item) => [item.tokenAddress, 100n])),
        sellToken,
        buyToken,
        now: new Date('2026-01-01T00:01:00Z'),
        configuredMinimumLiquidityUsdMicros: parseFixed('100000'),
    })
}

describe('backend payment-token selection', () => {
    it('prefers an owned eligible stablecoin and otherwise the sell token', () => {
        const stable = candidate({
            tokenAddress: '0x5555555555555555555555555555555555555555',
            symbol: 'USD',
            isStablecoin: true,
            paymentPriority: 1,
        })
        expect(select([candidate(), stable]).selection?.candidate.tokenAddress).toBe(stable.tokenAddress)
        expect(select([candidate()]).selection?.reason).toBe('eligible-sell-token')
    })

    it('uses the buy token only when it already has sufficient balance', () => {
        const emptyBuy = candidate({ tokenAddress: buyToken, symbol: 'BUY', balanceRaw: 0n })
        expect(select([emptyBuy]).selection).toBeNull()
        const ownedBuy = candidate({ tokenAddress: buyToken, symbol: 'BUY', balanceRaw: 100n })
        expect(select([ownedBuy]).selection?.reason).toBe('eligible-buy-token')
    })

    it.each([
        ['disabled', { enabled: false }, 'PAYMENT_TOKEN_DISABLED'],
        ['fee-on-transfer', { transferBehavior: 'fee-on-transfer' }, 'FEE_ON_TRANSFER_UNSUPPORTED'],
        ['rebasing', { transferBehavior: 'rebasing' }, 'REBASING_TOKEN_UNSUPPORTED'],
        ['stale price', { priceObservedAt: new Date('2025-12-31T23:00:00Z') }, 'PAYMENT_TOKEN_PRICE_STALE'],
        ['low liquidity', { liquidityUsdMicros: 1n }, 'PAYMENT_TOKEN_LIQUIDITY_LOW'],
        ['low balance', { balanceRaw: 99n }, 'PAYMENT_TOKEN_BALANCE_LOW'],
        ['unknown transfer', { transferBehavior: 'unknown' }, 'PAYMENT_TOKEN_TRANSFER_UNKNOWN'],
        ['unsafe token', { securityStatus: 'blocked' }, 'PAYMENT_TOKEN_SECURITY_UNCONFIRMED'],
    ])('rejects %s candidates', (_label, overrides, code) => {
        const result = select([candidate(overrides as Partial<PaymentTokenCandidate>)])
        expect(result.selection).toBeNull()
        expect(result.rejections[0]?.code).toBe(code)
    })
})

describe('signed sponsored transaction verification', () => {
    async function signed(overrides: Record<string, unknown> = {}, signer = wallet) {
        const data = buildPaymentTransfer(treasury, 123n)
        const raw = await signer.signTransaction({
            chainId: 56,
            to: token,
            data,
            value: 0n,
            gas: 100_000n,
            gasPrice: 0n,
            nonce: 7,
            type: 'legacy',
            ...overrides,
        })
        return { raw, data }
    }

    function template(data: Hex) {
        return {
            walletAddress: wallet.address,
            transactionTo: token,
            transactionData: data,
            transactionDataHash: keccak256(data),
            nativeValue: '0',
            chainId: 56,
            nonce: '7',
            transactionType: 'legacy',
            gasLimit: '100000',
            gasPrice: '0',
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
        }
    }

    it('accepts an exact signer, chain, nonce, destination, calldata, value, and zero-gas legacy transaction', async () => {
        const { raw, data } = await signed()
        const result = await validateSignedIntent(raw, template(data))
        expect(result.signer).toBe(wallet.address)
        expect(result.transactionHash).toBe(keccak256(raw))
    })

    it.each([
        ['wrong chain', { chainId: 1 }],
        ['wrong nonce', { nonce: 8 }],
        ['wrong destination', { to: treasury }],
        ['wrong calldata', { data: '0x095ea7b3' }],
        ['nonzero value', { value: 1n }],
        ['nonzero gas price', { gasPrice: 1n }],
        ['reduced gas', { gas: 99_999n }],
        ['inflated gas', { gas: 100_001n }],
    ])('rejects %s', async (_label, overrides) => {
        const exact = await signed()
        const changed = await signed(overrides)
        await expect(validateSignedIntent(changed.raw, template(exact.data))).rejects.toMatchObject({
            code: 'SIGNED_TRANSACTION_MISMATCH',
        })
    })

    it('rejects the wrong signer', async () => {
        const exact = await signed()
        const changed = await signed({}, otherWallet)
        await expect(validateSignedIntent(changed.raw, template(exact.data))).rejects.toMatchObject({
            code: 'SIGNED_TRANSACTION_MISMATCH',
        })
    })
})

describe('payment transaction and treasury receipt', () => {
    it('builds and verifies one exact treasury Transfer event', () => {
        const topics = encodeEventTopics({
            abi: transferEventAbi,
            eventName: 'Transfer',
            args: { from: wallet.address, to: treasury },
        })
        const data = encodeAbiParameters(parseAbiParameters('uint256'), [123n])
        expect(verifyExactTransferReceipt({
            receipt: { status: 'success', logs: [{ address: token, topics, data }] },
            transactionFrom: wallet.address,
            transactionTo: token,
            wallet: wallet.address,
            token,
            treasury,
            requiredAmount: 123n,
        })).toBe(123n)
    })

    it('rejects short fee-on-transfer receipts and conflicting logs', () => {
        const topics = encodeEventTopics({ abi: transferEventAbi, eventName: 'Transfer', args: { from: wallet.address, to: treasury } })
        const shortData = encodeAbiParameters(parseAbiParameters('uint256'), [122n])
        expect(() => verifyExactTransferReceipt({
            receipt: { status: 'success', logs: [{ address: token, topics, data: shortData }] },
            transactionFrom: wallet.address,
            transactionTo: token,
            wallet: wallet.address,
            token,
            treasury,
            requiredAmount: 123n,
        })).toThrow(/exact required payment/)
        const exactData = encodeAbiParameters(parseAbiParameters('uint256'), [123n])
        expect(() => verifyExactTransferReceipt({
            receipt: { status: 'success', logs: [{ address: token, topics, data: exactData }, { address: token, topics, data: exactData }] },
            transactionFrom: wallet.address,
            transactionTo: token,
            wallet: wallet.address,
            token,
            treasury,
            requiredAmount: 123n,
        })).toThrow(/exact required payment/)
        const conflictingTopics = encodeEventTopics({
            abi: transferEventAbi,
            eventName: 'Transfer',
            args: { from: wallet.address, to: token },
        })
        expect(() => verifyExactTransferReceipt({
            receipt: {
                status: 'success',
                logs: [
                    { address: token, topics, data: exactData },
                    { address: token, topics: conflictingTopics, data: exactData },
                ],
            },
            transactionFrom: wallet.address,
            transactionTo: token,
            wallet: wallet.address,
            token,
            treasury,
            requiredAmount: 123n,
        })).toThrow(/exact required payment/)
    })

    it('rejects frontend-injected payment token, spender, fee, router, calldata, and gas', () => {
        for (const field of ['paymentToken', 'spender', 'fee', 'router', 'calldata', 'gasLimit']) {
            expect(() => sponsorshipRouteInternals.exactObject({
                sellToken,
                buyToken,
                grossInputAmount: '100',
                slippageBps: 50,
                [field]: 'injected',
            }, ['sellToken', 'buyToken', 'grossInputAmount', 'slippageBps'])).toThrow(/unsupported/)
        }
    })
})
