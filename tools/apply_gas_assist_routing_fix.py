from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "src/services/swapExecutionMode.js",
    """        'gas-assist-disabled': 'Gas Assist is currently disabled.',
        'native-sell-token': 'Gas Assist cannot sell the native gas token.',
""",
    """        'gas-assist-disabled': 'Gas Assist is currently disabled.',
        'insufficient-native-balance': 'Gas Assist will be used because the wallet does not have enough BNB for normal gas.',
        'native-sell-token': 'Gas Assist cannot sell the native gas token.',
""",
)
replace_once(
    "src/services/swapExecutionMode.js",
    """    gasAssistConfig,
    gasAssistConfigStatus,
}) {
""",
    """    gasAssistConfig,
    gasAssistConfigStatus,
    minimumNativeBalance = 1n,
}) {
""",
)
replace_once(
    "src/services/swapExecutionMode.js",
    """    if (nativeBalance > 0n) return { mode: NORMAL_SWAP_MODE, reason: null }
    if (sellToken.isNative) return { mode: null, reason: 'native-sell-token' }
""",
    """    let requiredNativeBalance = 1n
    try {
        const parsed = BigInt(minimumNativeBalance)
        if (parsed > 0n) requiredNativeBalance = parsed
    } catch {
        requiredNativeBalance = 1n
    }
    if (nativeBalance >= requiredNativeBalance) return { mode: NORMAL_SWAP_MODE, reason: null }
    if (sellToken.isNative) return { mode: null, reason: 'native-sell-token' }
""",
)
replace_once(
    "src/services/swapExecutionMode.js",
    """    return { mode: ZERO_X_GASLESS_MODE, reason: null }
""",
    """    return { mode: ZERO_X_GASLESS_MODE, reason: 'insufficient-native-balance' }
""",
)

replace_once(
    "src/features/swap/hooks/useSwapRouting.js",
    """import { useGasAssistConfig } from '../../gas-assist/hooks/useGasAssistConfig.js'
""",
    """import { parseEther } from 'viem'
import { useGasAssistConfig } from '../../gas-assist/hooks/useGasAssistConfig.js'
import { DEFAULT_NATIVE_GAS_RESERVE_WEI } from '../../../services/balances.js'
import { swapUiConfig } from '../../../swapConfig.js'
""",
)
replace_once(
    "src/features/swap/hooks/useSwapRouting.js",
    """/**
 * Derives the existing same-chain, Gas Assist, or cross-chain routing mode.
""",
    """function minimumNormalGasBalance() {
    try {
        const parsed = parseEther(String(swapUiConfig.wallet.nativeGasReserve))
        return parsed > 0n ? parsed : DEFAULT_NATIVE_GAS_RESERVE_WEI
    } catch {
        return DEFAULT_NATIVE_GAS_RESERVE_WEI
    }
}

/**
 * Derives the existing same-chain, Gas Assist, or cross-chain routing mode.
""",
)
replace_once(
    "src/features/swap/hooks/useSwapRouting.js",
    """        gasAssistConfig: gasAssistConfig.config,
        gasAssistConfigStatus: gasAssistConfig.status,
    })
""",
    """        gasAssistConfig: gasAssistConfig.config,
        gasAssistConfigStatus: gasAssistConfig.status,
        minimumNativeBalance: minimumNormalGasBalance(),
    })
""",
)

replace_once(
    "src/features/gas-assist/hooks/useGasAssistController.js",
    """    const prepaidRequired = routingMode === gasAssistRoutingMode && gasAssist.quoteStatus === 'error' &&
        gasAssist.quoteError?.code === 'ONCHAIN_APPROVAL_REQUIRED'
    const prepaidSponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: prepaidRequired,
        onConfirmed,
    })
    const quoteReady = gasAssist.quoteStatus === 'success' && gasAssist.quote !== null
    const executionMode = routingMode === gasAssistRoutingMode &&
        (quoteReady || (prepaidRequired && prepaidSponsorship.config?.enabled))
        ? gaslessMode
        : normalMode
    const activeQuote = executionMode === gaslessMode
        ? prepaidRequired && prepaidSponsorship.config?.enabled
            ? { prepaidSponsorshipRequired: true }
            : gasAssist.quote
        : normalQuote
    const activeQuoteStatus = executionMode === gaslessMode
        ? prepaidRequired && prepaidSponsorship.config?.enabled
            ? 'success'
            : gasAssist.quoteStatus
        : normalQuoteStatus
""",
    """    const gasAssistRequested = routingMode === gasAssistRoutingMode
    const prepaidRequired = gasAssistRequested && gasAssist.quoteStatus === 'error' &&
        gasAssist.quoteError?.code === 'ONCHAIN_APPROVAL_REQUIRED'
    const prepaidSponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, configuredSlippageBps),
        required: prepaidRequired,
        onConfirmed,
    })
    const prepaidEnabled = prepaidRequired && prepaidSponsorship.config?.enabled === true
    const executionMode = gasAssistRequested ? gaslessMode : normalMode
    const activeQuote = gasAssistRequested
        ? prepaidEnabled
            ? { prepaidSponsorshipRequired: true }
            : gasAssist.quote
        : normalQuote
    const activeQuoteStatus = gasAssistRequested
        ? prepaidRequired
            ? prepaidSponsorship.configStatus === 'success'
                ? prepaidEnabled ? 'success' : 'error'
                : prepaidSponsorship.configStatus === 'error' ? 'error' : 'loading'
            : gasAssist.quoteStatus
        : normalQuoteStatus
""",
)
replace_once(
    "src/features/gas-assist/hooks/useGasAssistController.js",
    """    useEffect(() => {
        if (routingMode !== gasAssistRoutingMode || gasAssist.quoteStatus !== 'error' ||
            (prepaidRequired && prepaidSponsorship.config?.enabled) || normalQuoteStatus === 'success') return
        const code = gasAssist.quoteError?.code
        const message = gasAssist.quoteError?.message ?? 'Gas Assist could not provide a quote.'
        setVisibleStatus(code ? `${code}: ${message}` : message)
    }, [
        gasAssist.quoteError,
        gasAssist.quoteStatus,
        gasAssistRoutingMode,
        normalQuoteStatus,
        prepaidRequired,
        prepaidSponsorship.config?.enabled,
        routingMode,
        setVisibleStatus,
    ])
""",
    """    useEffect(() => {
        if (!gasAssistRequested || gasAssist.quoteStatus !== 'error') return
        if (prepaidRequired) {
            if (prepaidSponsorship.configStatus === 'idle' || prepaidSponsorship.configStatus === 'loading') return
            if (prepaidSponsorship.config?.enabled) return
            const code = prepaidSponsorship.configError?.code ?? 'SPONSORSHIP_UNAVAILABLE'
            const message = prepaidSponsorship.configError?.message ?? 'Prepaid Gas Assist sponsorship is unavailable.'
            setVisibleStatus(`${code}: ${message}`)
            return
        }
        const code = gasAssist.quoteError?.code
        const message = gasAssist.quoteError?.message ?? 'Gas Assist could not provide a quote.'
        setVisibleStatus(code ? `${code}: ${message}` : message)
    }, [
        gasAssist.quoteError,
        gasAssist.quoteStatus,
        gasAssistRequested,
        prepaidRequired,
        prepaidSponsorship.config?.enabled,
        prepaidSponsorship.configError,
        prepaidSponsorship.configStatus,
        setVisibleStatus,
    ])
""",
)

replace_once(
    "src/features/swap/hooks/useSwapQuote.js",
    """        if (routingMode === crossChainMode) return 'cross-chain-route'
        if (sellChainId !== buyChainId) return 'mixed-token-chains'
""",
    """        if (routingMode === crossChainMode) return 'cross-chain-route'
        if (routingMode === gasAssistMode) return 'gas-assist-route'
        if (sellChainId !== buyChainId) return 'mixed-token-chains'
""",
)

replace_once(
    "src/features/swap/model/swapEligibility.js",
    """    let action = prepaidRequired && prepaidEnabled && baseAction.type === 'swap'
        ? { ...baseAction, label: 'Review Gas Assist prepayment' }
        : baseAction
    if (baseAction.type === 'swap') action = { ...action, label: 'Review swap' }
""",
    """    let action = baseAction
    if (baseAction.type === 'swap') {
        action = {
            ...baseAction,
            label: prepaidRequired && prepaidEnabled
                ? 'Review Gas Assist prepayment'
                : executionMode === gaslessMode
                    ? 'Review Gas Assist'
                    : 'Review swap',
        }
    }
""",
)

replace_once(
    "src/features/swap/hooks/useSwapPrimaryAction.js",
    """        if (executionMode === gaslessMode) {
            diagnostic('primary-action.route', {
                route: 'gas-assist', prepaidRequired: prepaid.required, gasAssistQuoteStatus: gasAssist.quoteStatus,
            })
            if (prepaid.required && prepaid.enabled) {
                prepaid.start()
                return
            }
            if (!gasAssist.quote || Date.parse(gasAssist.quote.expiresAt) <= Date.now()) {
                setVisibleStatus('The Gas Assist quote expired. Refreshing the price.')
                refreshSameChainQuote()
                return
            }
            gasAssist.open()
            return
        }
""",
    """        if (executionMode === gaslessMode) {
            diagnostic('primary-action.route', {
                route: 'gas-assist', prepaidRequired: prepaid.required, gasAssistQuoteStatus: gasAssist.quoteStatus,
            })
            if (prepaid.required) {
                if (prepaid.enabled) {
                    await prepaid.start()
                } else {
                    setVisibleStatus('Prepaid Gas Assist is unavailable. Normal approval is blocked because this wallet does not have enough BNB for gas.')
                    diagnostic('primary-action.blocked', { reason: 'prepaid-sponsorship-unavailable' }, 'warn')
                }
                return
            }
            if (!gasAssist.quote || Date.parse(gasAssist.quote.expiresAt) <= Date.now()) {
                setVisibleStatus('The Gas Assist quote expired. Refreshing the price.')
                refreshSameChainQuote()
                return
            }
            gasAssist.open()
            return
        }
""",
)
replace_once(
    "src/features/swap/hooks/useSwapPrimaryAction.js",
    """    async function confirmSameChainSwap() {
        setVisibleStatus(null)
        diagnostic('review.confirm.clicked', {
""",
    """    async function confirmSameChainSwap() {
        setVisibleStatus(null)
        if (executionMode === gaslessMode) {
            const message = 'Normal approval and swap execution are blocked while Gas Assist is required.'
            setVisibleStatus(message)
            setReviewError(message)
            diagnostic('review.confirm.blocked', { reason: 'gas-assist-required' }, 'warn')
            return null
        }
        diagnostic('review.confirm.clicked', {
""",
)

replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """const initial = {
    open: false,
    phase: 'idle',
    config: null,
    order: null,
    intentExpiresAt: null,
    continuation: null,
    error: null,
}
""",
    """const initial = {
    open: false,
    phase: 'idle',
    config: null,
    order: null,
    intentExpiresAt: null,
    continuation: null,
    error: null,
}

function phaseForOrderStatus(status, currentPhase) {
    return {
        'payment-submitting': 'payment-confirming',
        'payment-submitted': 'payment-confirming',
        'payment-confirmed': 'payment-confirmed',
        'approval-submitted': 'approval-confirming',
        'approval-confirmed': 'approval-confirmed',
        'swap-submitted': 'swap-confirming',
        completed: 'completed',
    }[status] ?? currentPhase
}
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """    const [config, setConfig] = useState(null)
    const [state, setState] = useState(initial)
""",
    """    const [config, setConfig] = useState(null)
    const [configStatus, setConfigStatus] = useState('idle')
    const [configError, setConfigError] = useState(null)
    const [state, setState] = useState(initial)
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """        if (!quoteEndpoint || !walletAddress) {
            setConfig(null)
            return undefined
        }
        const controller = new AbortController()
""",
    """        if (!quoteEndpoint || !walletAddress) {
            setConfig(null)
            setConfigStatus('idle')
            setConfigError(null)
            return undefined
        }
        const controller = new AbortController()
        setConfigStatus('loading')
        setConfigError(null)
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """                    setConfig(nextConfig)
                }
            })
            .catch(() => {
                if (!controller.signal.aborted && walletEpochRef.current === walletEpoch) {
                    setConfig(null)
                }
            })
""",
    """                    setConfig(nextConfig)
                    setConfigStatus('success')
                    setConfigError(null)
                }
            })
            .catch((error) => {
                if (!controller.signal.aborted && walletEpochRef.current === walletEpoch) {
                    setConfig(null)
                    setConfigStatus('error')
                    setConfigError(error)
                }
            })
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """            setState((current) => ({ ...current, phase: `${action}-submitted`, intentExpiresAt: null }))
""",
    """            setState((current) => ({ ...current, phase: `${action}-confirming`, intentExpiresAt: null }))
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """            setState((current) => ({ ...current, phase: 'swap-submitted', intentExpiresAt: null }))
""",
    """            setState((current) => ({ ...current, phase: 'swap-confirming', intentExpiresAt: null }))
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """                    order: { ...current.order, ...order },
                    phase: order.status === 'completed' ? 'completed' : current.phase,
                    pollRevision: (current.pollRevision ?? 0) + 1,
""",
    """                    order: { ...current.order, ...order },
                    phase: phaseForOrderStatus(order.status, current.phase),
                    pollRevision: (current.pollRevision ?? 0) + 1,
""",
)
replace_once(
    "src/features/gas-assist/hooks/usePrepaidSponsorship.js",
    """        config,
        capability,
""",
    """        config,
        configStatus,
        configError,
        capability,
""",
)

replace_once(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """function providerFeeRows(fees) {
    if (!fees || typeof fees !== 'object') return []
    return ['gasFee', 'zeroExFee'].flatMap((key) => {
        const fee = fees[key]
        return fee?.amount != null
            ? [[key === 'gasFee' ? '0x gas fee' : '0x fee', `${fee.amount} base units`]]
            : []
    })
}
""",
    """function providerFeeRows(fees) {
    if (!fees || typeof fees !== 'object') return []
    return ['gasFee', 'zeroExFee'].flatMap((key) => {
        const fee = fees[key]
        return fee?.amount != null
            ? [[key === 'gasFee' ? '0x gas fee' : '0x fee', `${fee.amount} base units`]]
            : []
    })
}

function ConfirmationProgress({ title, detail, transactionHash, confirmationCount }) {
    return (
        <section className="gas-assist-confirmation" role="status" aria-live="polite">
            <div className="gas-assist-confirmation-heading">
                <span className="gas-assist-confirmation-dot" aria-hidden="true" />
                <strong>{title}</strong>
            </div>
            <p>{detail}</p>
            <div className="gas-assist-progress-track" aria-hidden="true"><span /></div>
            {Number.isFinite(Number(confirmationCount)) && Number(confirmationCount) > 0 && (
                <small>{confirmationCount} confirmation{Number(confirmationCount) === 1 ? '' : 's'} observed</small>
            )}
            {transactionHash && <code>{transactionHash}</code>}
        </section>
    )
}
""",
)
replace_once(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """    if (!sponsorship.open) return null
    const busy = sponsorship.phase.endsWith('-preparing') || sponsorship.phase.endsWith('-signing') ||
        sponsorship.phase === 'authenticating' || sponsorship.phase === 'continuation-loading'
    const orderExpired = expired || Boolean(order?.expiresAt && Date.parse(order.expiresAt) <= Date.now())
""",
    """    if (!sponsorship.open) return null
    const paymentWaiting = ['payment-submitting', 'payment-submitted'].includes(order?.status) ||
        sponsorship.phase === 'payment-confirming'
    const approvalWaiting = order?.status === 'approval-submitted' || sponsorship.phase === 'approval-confirming'
    const swapWaiting = order?.status === 'swap-submitted' || sponsorship.phase === 'swap-confirming'
    const waitingForConfirmation = paymentWaiting || approvalWaiting || swapWaiting
    const busy = sponsorship.phase.endsWith('-preparing') || sponsorship.phase.endsWith('-signing') ||
        sponsorship.phase === 'authenticating' || sponsorship.phase === 'continuation-loading' || waitingForConfirmation
    const orderExpired = expired || Boolean(order?.expiresAt && Date.parse(order.expiresAt) <= Date.now())
""",
)
replace_once(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """                    {sponsorship.phase === 'authenticating' && <p className="gas-assist-status" role="status">Authenticate Pistachio Wallet to request an authoritative review.</p>}
""",
    """                    {paymentWaiting && (
                        <ConfirmationProgress
                            title="Waiting for exact payment confirmation"
                            detail="The backend is verifying that the treasury received the exact required token amount. Approval and swap sponsorship remain locked until this check passes."
                            transactionHash={order?.paymentTransactionHash}
                            confirmationCount={order?.confirmationCount}
                        />
                    )}
                    {approvalWaiting && (
                        <ConfirmationProgress
                            title="Waiting for sponsored approval confirmation"
                            detail="The action policy submitted the exact approval. The swap remains locked until the allowance is confirmed on-chain."
                            transactionHash={order?.approvalTransactionHash}
                            confirmationCount={order?.confirmationCount}
                        />
                    )}
                    {swapWaiting && (
                        <ConfirmationProgress
                            title="Waiting for sponsored swap confirmation"
                            detail="The action policy submitted the exact validated swap. PistachioSwap is waiting for the final receipt."
                            transactionHash={order?.swapTransactionHash}
                            confirmationCount={order?.confirmationCount}
                        />
                    )}
                    {order?.status === 'payment-confirmed' && showApproval && (
                        <p className="gas-assist-status gas-assist-confirmed" role="status">Exact payment confirmed. Approval sponsorship is now unlocked.</p>
                    )}
                    {sponsorship.phase === 'authenticating' && <p className="gas-assist-status" role="status">Authenticate Pistachio Wallet to request an authoritative review.</p>}
""",
)

replace_once(
    "src/features/gas-assist/components/gasAssist.css",
    """.gas-assist-address-mismatch { overflow-wrap: anywhere; color: #ff9aab !important; }
""",
    """.gas-assist-address-mismatch { overflow-wrap: anywhere; color: #ff9aab !important; }
.gas-assist-confirmation { display: grid; gap: 9px; margin-top: 16px; padding: 14px; border: 1px solid #3d654f; border-radius: 8px; background: #18251e; }
.gas-assist-confirmation-heading { display: flex; align-items: center; gap: 9px; font-size: 13px; }
.gas-assist-confirmation-dot { width: 9px; height: 9px; border-radius: 50%; background: #8ac27c; box-shadow: 0 0 0 5px rgb(138 194 124 / 12%); animation: gas-assist-pulse 1.4s ease-in-out infinite; }
.gas-assist-confirmation p, .gas-assist-confirmation small { margin: 0; color: #b8c8bd; font-size: 12px; line-height: 1.45; }
.gas-assist-confirmation code { overflow-wrap: anywhere; color: #91a99a; font-size: 10px; }
.gas-assist-progress-track { position: relative; height: 5px; overflow: hidden; border-radius: 999px; background: #304438; }
.gas-assist-progress-track span { position: absolute; inset-block: 0; width: 42%; border-radius: inherit; background: #8ac27c; animation: gas-assist-progress 1.25s ease-in-out infinite; }
.gas-assist-confirmed { color: #9ddb8d; }
@keyframes gas-assist-progress { from { transform: translateX(-110%); } to { transform: translateX(340%); } }
@keyframes gas-assist-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .gas-assist-confirmation-dot, .gas-assist-progress-track span { animation: none; } .gas-assist-progress-track span { width: 100%; } }
""",
)

replace_once(
    "src/services/swapExecutionMode.test.js",
    """    gasAssistConfig: { enabled: true, mode: 'zero-x-gasless' },
    gasAssistConfigStatus: 'success',
}
""",
    """    gasAssistConfig: { enabled: true, mode: 'zero-x-gasless' },
    gasAssistConfigStatus: 'success',
    minimumNativeBalance: 100n,
}
""",
)
replace_once(
    "src/services/swapExecutionMode.test.js",
    """    it('selects Gasless only for an eligible zero-BNB wallet', () => {
        expect(deriveSwapExecution(base).mode).toBe('zero-x-gasless')
        expect(deriveSwapExecution({ ...base, nativeBalance: 1n }).mode).toBe('normal')
    })
""",
    """    it('selects Gas Assist when BNB is zero or below the configured normal-gas reserve', () => {
        expect(deriveSwapExecution(base)).toEqual({ mode: 'zero-x-gasless', reason: 'insufficient-native-balance' })
        expect(deriveSwapExecution({ ...base, nativeBalance: 99n })).toEqual({ mode: 'zero-x-gasless', reason: 'insufficient-native-balance' })
        expect(deriveSwapExecution({ ...base, nativeBalance: 100n })).toEqual({ mode: 'normal', reason: null })
    })
""",
)
replace_once(
    "src/services/swapExecutionMode.test.js",
    """        expect(result).toEqual({ mode: 'zero-x-gasless', reason: null })
""",
    """        expect(result).toEqual({ mode: 'zero-x-gasless', reason: 'insufficient-native-balance' })
""",
)

replace_once(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.test.jsx",
    """    it('shows the Pistachio Wallet compatibility error', () => {
""",
    """    it('shows an indeterminate confirmation bar and keeps approval locked while payment is pending', () => {
        render(<GasAssistPrepaymentDialog
            sponsorship={sponsorship({
                phase: 'payment-confirming',
                order: {
                    ...sponsorship().order,
                    status: 'payment-submitted',
                    currentRequiredAction: 'wait-payment-confirmation',
                    paymentTransactionHash: `0x${'1'.repeat(64)}`,
                    confirmationCount: 0,
                },
            })}
            sellToken={sellToken}
            buyToken={buyToken}
        />)
        expect(screen.getByText('Waiting for exact payment confirmation')).toBeTruthy()
        expect(screen.getByText(/treasury received the exact required token amount/)).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Sign exact approval transaction' })).toBeNull()
        expect(document.querySelector('.gas-assist-progress-track')).toBeTruthy()
    })

    it('shows the Pistachio Wallet compatibility error', () => {
""",
)

Path("src/features/gas-assist/hooks/useGasAssistController.test.jsx").write_text("""// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    gasAssist: null,
    prepaid: null,
}))

vi.mock('./useZeroXGaslessSwap.js', () => ({
    useZeroXGaslessSwap: () => mocks.gasAssist,
}))
vi.mock('./usePrepaidSponsorship.js', () => ({
    usePrepaidSponsorship: () => mocks.prepaid,
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

describe('Gas Assist route ownership', () => {
    beforeEach(() => {
        mocks.gasAssist = {
            quote: null,
            quoteStatus: 'error',
            quoteError: { code: 'ONCHAIN_APPROVAL_REQUIRED', message: 'Approval required.' },
        }
        mocks.prepaid = {
            config: { enabled: true },
            configStatus: 'success',
            configError: null,
        }
    })

    it('never falls back to the normal quote when prepaid approval is required', () => {
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.prepaidRequired).toBe(true)
        expect(result.current.activeQuote).toEqual({ prepaidSponsorshipRequired: true })
        expect(result.current.activeQuoteStatus).toBe('success')
    })

    it('fails closed instead of exposing a normal SwapProxy quote on Gas Assist errors', () => {
        mocks.gasAssist = {
            quote: null,
            quoteStatus: 'error',
            quoteError: { code: 'NO_SPONSORED_ROUTE', message: 'No sponsored route.' },
        }
        mocks.prepaid = { config: null, configStatus: 'error', configError: null }
        const { result } = renderHook(() => useGasAssistController(baseProps))
        expect(result.current.executionMode).toBe('zero-x-gasless')
        expect(result.current.activeQuote).toBeNull()
        expect(result.current.activeQuoteStatus).toBe('error')
    })
})
""")

Path("src/features/swap/hooks/useSwapQuote.gas-assist.test.jsx").write_text("""// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchSwapQuote: vi.fn() }))
vi.mock('../services/quotes.js', async () => {
    const actual = await vi.importActual('../services/quotes.js')
    return { ...actual, fetchSwapQuote: mocks.fetchSwapQuote }
})

import { useSwapQuote } from './useSwapQuote.js'

it('does not request or retain a normal provider quote while Gas Assist owns the route', () => {
    const setBuyAmount = vi.fn()
    const { result } = renderHook(() => useSwapQuote({
        endpoint: 'http://localhost:3001/v1/quote',
        debounceMs: 0,
        chainId: 56,
        walletState: { isConnected: true, isCorrectNetwork: true, chainId: 56 },
        walletAddress: '0x0000000000000000000000000000000000000001',
        sellToken: { address: '0x0000000000000000000000000000000000000002', chainId: 56, decimals: 6 },
        buyToken: { address: '0x0000000000000000000000000000000000000003', chainId: 56, decimals: 18 },
        sellChainId: 56,
        buyChainId: 56,
        activeAmountSide: 'sell',
        activeAmountIn: '51',
        activeBuyAmountIn: null,
        sellInputDenomination: 'TOKEN',
        buyInputDenomination: 'TOKEN',
        sellDisplayPrice: '4000',
        buyDisplayPrice: '600',
        configuredSlippageBps: 50,
        routingMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
        crossChainMode: 'CROSS_CHAIN',
        gasAssistMode: 'SAME_CHAIN_GASLESS_OR_ASSISTED',
        setSellAmount: vi.fn(),
        setBuyAmount,
        setVisibleStatus: vi.fn(),
        diagnostic: vi.fn(),
    }))
    expect(result.current.quote).toBeNull()
    expect(result.current.quoteStatus).toBe('idle')
    expect(mocks.fetchSwapQuote).not.toHaveBeenCalled()
})
""")

replace_once(
    ".github/workflows/ci.yml",
    """      - 'src/features/gas-assist/**'
  push:
""",
    """      - 'src/features/gas-assist/**'
      - 'src/features/swap/**'
      - 'src/services/swapExecutionMode*'
  push:
""",
)
replace_once(
    ".github/workflows/ci.yml",
    """      - 'src/features/gas-assist/**'

permissions:
""",
    """      - 'src/features/gas-assist/**'
      - 'src/features/swap/**'
      - 'src/services/swapExecutionMode*'

permissions:
""",
)
replace_once(
    ".github/workflows/ci.yml",
    """          src/features/gas-assist/hooks/usePrepaidSponsorship.test.jsx
          src/features/gas-assist/components/GasAssistPrepaymentDialog.test.jsx
          --reporter=verbose
""",
    """          src/features/gas-assist/hooks/usePrepaidSponsorship.test.jsx
          src/features/gas-assist/hooks/useGasAssistController.test.jsx
          src/features/gas-assist/components/GasAssistPrepaymentDialog.test.jsx
          src/features/swap/hooks/useSwapQuote.gas-assist.test.jsx
          src/services/swapExecutionMode.test.js
          --reporter=verbose
""",
)
