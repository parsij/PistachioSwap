from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1))


Path("src/features/gas-assist/hooks/useGasAssistController.js").write_text("""import { useEffect } from 'react'
import { useZeroXGaslessSwap } from './useZeroXGaslessSwap.js'
import { usePrepaidSponsorship } from './usePrepaidSponsorship.js'

/**
 * Owns Gas Assist quote/dialog/prepayment orchestration while keeping normal swap approval separate.
 * @param {object} config Gas Assist intent, feature configuration, and semantic callbacks.
 * @returns {object} Gas Assist hooks, active execution mode, quote/status, and dialog view models.
 * @sideEffects Calls existing Gas Assist backend hooks; explicit dialog confirmation may request sponsorship operations.
 * @security Low-BNB execution is fail-closed into the exact prepaid flow and never falls back to a normal approval quote.
 */
export function useGasAssistController({
    routingMode,
    gasAssistRoutingMode,
    normalMode,
    gaslessMode,
    quoteEndpoint,
    account,
    sellToken,
    buyToken,
    sellChainId,
    buyChainId,
    activeAmountIn,
    activeAmountSide,
    configuredSlippageBps,
    gasAssistConfig,
    refreshIndex,
    normalQuote,
    normalQuoteStatus,
    buyInputDenomination,
    setBuyAmount,
    setVisibleStatus,
    onConfirmed,
}) {
    const gasAssistRequested = routingMode === gasAssistRoutingMode
    const prepaidSponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: gasAssistRequested,
        onConfirmed,
    })

    // Keep the old 0x Gasless dialog hook mounted for API compatibility, but never
    // ask the provider-integrator endpoint to price a low-BNB wallet. The exact
    // prepaid order service owns payment, approval, and swap sponsorship.
    const gasAssist = useZeroXGaslessSwap({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        sourceChainId: sellChainId,
        destinationChainId: buyChainId,
        sellAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        config: gasAssistConfig.config,
        quoteEnabled: false,
        refreshIndex,
        onConfirmed,
    })

    const prepaidRequired = gasAssistRequested
    const prepaidEnabled = prepaidSponsorship.configStatus === 'success' &&
        prepaidSponsorship.config?.enabled === true
    const executionMode = gasAssistRequested ? gaslessMode : normalMode
    const activeQuote = gasAssistRequested
        ? prepaidEnabled ? { prepaidSponsorshipRequired: true } : null
        : normalQuote
    const activeQuoteStatus = gasAssistRequested
        ? prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading'
            ? 'loading'
            : prepaidEnabled ? 'success' : 'error'
        : normalQuoteStatus

    useEffect(() => {
        if (!gasAssistRequested) return
        if (prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading') return
        if (prepaidEnabled) return
        const code = prepaidSponsorship.configError?.code ?? 'SPONSORSHIP_UNAVAILABLE'
        const message = prepaidSponsorship.configError?.message ??
            'Exact prepaid Gas Assist is disabled or unavailable.'
        setVisibleStatus(`${code}: ${message}`)
    }, [
        gasAssistRequested,
        prepaidEnabled,
        prepaidSponsorship.configError,
        prepaidSponsorship.configStatus,
        setVisibleStatus,
    ])

    return {
        gasAssist,
        prepaidSponsorship,
        prepaidRequired,
        executionMode,
        activeQuote,
        activeQuoteStatus,
        isGasless: executionMode === gaslessMode,
    }
}
""")

Path("src/features/gas-assist/hooks/useGasAssistController.test.jsx").write_text("""// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    gasAssist: null,
    prepaid: null,
    gasAssistArgs: null,
    prepaidArgs: null,
}))

vi.mock('./useZeroXGaslessSwap.js', () => ({
    useZeroXGaslessSwap: (args) => {
        mocks.gasAssistArgs = args
        return mocks.gasAssist
    },
}))
vi.mock('./usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: (args) => {
        mocks.prepaidArgs = args
        return mocks.prepaid
    },
}))

import { useGasAssistController } from './useGasAssistController.js'

const baseProps = {
    routingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
    gasAssistRoutingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
    normalMode: 'normal',
    gaslessMode: 'zero-x-gasless',
    quoteEndpoint: 'http://localhost:3001/v1/quote',
    account: '0x0000000000000000000000000000000000000001',
    sellToken: { address: '0x0000000000000000000000000000000000000002', decimals: 6 },
    buyToken: { address: '0x0000000000000000000000000000000000000003', decimals: 18 },
    sellChainId: 56,
    buyChainId: 56,
    activeAmountIn: '51',
    activeAmountSide: 'sell',
    configuredSlippageBps: 50,
    gasAssistConfig: { config: { enabled: true, mode: 'zero-x-gasless' } },
    refreshIndex: 0,
    normalQuote: { selectedQuote: { transaction: { to: '0x0000000000000000000000000000000000000004' } } },
    normalQuoteStatus: 'success',
    buyInputDenomination: 'TOKEN',
    setBuyAmount: vi.fn(),
    setVisibleStatus: vi.fn(),
    onConfirmed: vi.fn(),
}

describe('exact prepaid Gas Assist route ownership', () => {
    beforeEach(() => {
        mocks.gasAssist = { quote: null, quoteStatus: 'idle', quoteError: null }
        mocks.prepaid = {
            config: { enabled: true },
            configStatus: 'success',
            configError: null,
        }
        mocks.gasAssistArgs = null
        mocks.prepaidArgs = null
    })

    it('uses prepaid sponsorship immediately and never calls the provider-integrator quote path', () => {
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(mocks.prepaidArgs.required).toBe(true)
        expect(mocks.gasAssistArgs.quoteEnabled).toBe(false)
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.prepaidRequired).toBe(true)
        expect(result.current.activeQuote).toEqual({ prepaidSponsorshipRequired: true })
        expect(result.current.activeQuoteStatus).toBe('success')
    })

    it('fails closed when prepaid sponsorship is disabled instead of exposing a normal SwapProxy quote', () => {
        mocks.prepaid = { config: { enabled: false }, configStatus: 'success', configError: null }
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(mocks.gasAssistArgs.quoteEnabled).toBe(false)
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.activeQuote).toBeNull()
        expect(result.current.activeQuoteStatus).toBe('error')
        expect(baseProps.setVisibleStatus).toHaveBeenCalledWith(expect.stringContaining('SPONSORSHIP_UNAVAILABLE'))
    })
})
""")

Path("src/features/gas-assist/components/GasAssistError.jsx").write_text("""const messages = {
    BELOW_SPONSOR_MINIMUM: 'The amount is below this wallet-token sponsor minimum.',
    ABOVE_SPONSOR_MAXIMUM: 'The amount is above this wallet-token sponsor maximum.',
    GAS_ASSIST_RULE_NOT_FOUND: 'This wallet and token do not have an enabled sponsor rule.',
    SWAP_INTENT_NOT_CUSTOM_CONTRACT: 'This quote does not execute through the PistachioSwap contract.',
    ONCHAIN_APPROVAL_REQUIRED: 'This token needs an exact sponsored approval before the swap.',
    UNLIMITED_PERMIT_NOT_ALLOWED: 'This permit is broader than the configured Gas Assist policy allows.',
    SELL_VALUE_TOO_LOW: 'The legacy Gasless sell value is below its configured minimum.',
    GAS_ASSIST_FEE_NOT_REPRESENTABLE: 'The legacy provider fee is too large for this trade. Exact prepaid Gas Assist is required.',
    GROSS_TRADE_VALUE_UNECONOMIC: 'The gross trade value is below the exact prepaid minimum.',
    NET_TRADE_VALUE_UNECONOMIC: 'After sponsorship charges, the remaining swap value is below the minimum.',
    PAYMENT_EXCEEDS_GROSS_INPUT: 'The sponsorship charge would leave no token amount to swap.',
    OUTPUT_VALUE_UNECONOMIC: 'The minimum output after sponsorship charges is too small.',
    PAYMENT_TRANSFER_UNECONOMIC: 'The sponsorship payment is too small relative to its transfer cost.',
    USER_OUTPUT_TOO_LOW: 'The expected user output is too small after fees.',
    PRICE_IMPACT_TOO_HIGH: 'This Gas Assist quote has excessive price impact.',
    QUOTE_EXPIRED: 'This Gas Assist quote expired.',
}

/** Presents the existing safe Gas Assist error message and details. */
export default function GasAssistError({ error }) {
    const code = typeof error === 'string' ? error : error?.code
    const message = messages[code] ?? error?.message ?? 'This trade is not eligible for Gas Assist.'
    return <p className="gas-assist-error" role="alert">{message}</p>
}
""")

replace_once(
    "apps/api/src/config.ts",
    """            minimumSellUsd: readPositiveDecimal(
                'GAS_ASSIST_MIN_SELL_USD',
                '1',
            ),
""",
    """            minimumSellUsd: readPositiveDecimal(
                'GAS_ASSIST_MIN_SELL_USD',
                '0.10',
            ),
""",
)
replace_once(
    "apps/api/src/config.ts",
    """            minimumGrossTradeUsd: readPositiveDecimal(
                'MEGAFUEL_MIN_GROSS_TRADE_USD',
                '1',
            ),
""",
    """            minimumGrossTradeUsd: readPositiveDecimal(
                'MEGAFUEL_MIN_GROSS_TRADE_USD',
                '0.10',
            ),
""",
)

replace_once(
    "apps/api/src/gas-assist/gasless-service.ts",
    """async function preliminary(input: ReturnType<typeof normalizeInput>, dependencies: Dependencies) {
    const config = getApiConfig()
""",
    """async function preliminary(
    input: ReturnType<typeof normalizeInput>,
    dependencies: Dependencies,
    minimumSellUsd = getApiConfig().gasAssist.minimumSellUsd,
) {
    const config = getApiConfig()
""",
)
replace_once(
    "apps/api/src/gas-assist/gasless-service.ts",
    """    assertAtLeast(sellUsd, config.gasAssist.minimumSellUsd, 'SELL_VALUE_TOO_LOW', 'The sell value is below the Gas Assist minimum.')
""",
    """    assertAtLeast(sellUsd, minimumSellUsd, 'SELL_VALUE_TOO_LOW', 'The sell value is below the Gas Assist minimum.')
""",
)
replace_once(
    "apps/api/src/gas-assist/gasless-service.ts",
    """    async function probePrepaid(raw: GaslessInput) {
        assertMode()
        const input = normalizeInput(raw)
        const { sellUsd, buyDecimals, buyPrice } = await preliminary(input, dependencies)
""",
    """    async function probePrepaid(raw: GaslessInput) {
        assertMode()
        const input = normalizeInput(raw)
        const { sellUsd, buyDecimals, buyPrice } = await preliminary(
            input,
            dependencies,
            getApiConfig().sponsorship.minimumGrossTradeUsd,
        )
""",
)

replace_once(
    "apps/api/.env.megafuel.example",
    """MEGAFUEL_MIN_GROSS_TRADE_USD=1
MEGAFUEL_MIN_NET_TRADE_USD=0.10
""",
    """# Both the prepaid order and its 0x route probe allow gross trades from $0.10.
GAS_ASSIST_MIN_SELL_USD=0.10
MEGAFUEL_MIN_GROSS_TRADE_USD=0.10
MEGAFUEL_MIN_NET_TRADE_USD=0.10
""",
)
