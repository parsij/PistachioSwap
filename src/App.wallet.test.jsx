// @vitest-environment jsdom

import React from 'react'
import { encodeErrorResult, parseAbi } from 'viem'
import appStyles from './index.css?raw'
import {
    act,
    cleanup,
    fireEvent,
    render,
    waitFor,
} from '@testing-library/react'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    account: {
        address: undefined,
        isConnected: false,
    },
    wagmiAccount: {
        address: undefined,
        addresses: undefined,
        chainId: undefined,
        connector: null,
        isConnected: false,
        status: 'disconnected',
    },
    network: {
        chainId: 56,
    },
    open: vi.fn(),
    switchNetwork: vi.fn(),
    useWalletTokens: vi.fn(),
    refetchWalletTokens: vi.fn(),
    refetchBalance: vi.fn(),
    balanceOptions: [],
    fetchSwapQuote: vi.fn(),
    fetchCrossChainRoutes: vi.fn(),
    authenticateCrossChainWallet: vi.fn(),
    prepareCrossChainRoute: vi.fn(),
    claimCrossChainRoute: vi.fn(),
    markCrossChainRouteSubmitted: vi.fn(),
    resolveCurrentCrossChainWallet: vi.fn(),
    sendPreparedCrossChainTransaction: vi.fn(),
    waitForCrossChainApproval: vi.fn(),
    sendTransaction: vi.fn(),
    prepareSwapApproval: vi.fn(),
    invalidatePermit2Readiness: vi.fn(),
    approvalResult: {
        approvalReady: true,
        approvalTransactionSubmitted: false,
    },
    marketTokens: [],
    nativeBalance: 5_349_631_675_469_080n,
    publicClient: {
        estimateGas: vi.fn(),
        estimateFeesPerGas: vi.fn(),
        getGasPrice: vi.fn(),
        call: vi.fn(),
    },
    gasAssistConfig: { status: 'success', config: { enabled: false, mode: 'disabled' }, error: null, refetch: vi.fn() },
    gasAssistState: null,
    gasAssistOptions: [],
}))

vi.mock('@reown/appkit/react', () => ({
    AppKitNetworkButton: () => (
        <button
            type="button"
            data-testid="appkit-network-button"
        >
            BNB Chain
        </button>
    ),
    useAppKit: () => ({ open: mocks.open }),
    useAppKitAccount: () => mocks.account,
    useAppKitNetwork: () => ({
        chainId: mocks.network.chainId,
        switchNetwork: mocks.switchNetwork,
    }),
}))

vi.mock('wagmi', () => ({
    useConfig: () => ({ state: {} }),
    useAccount: () => mocks.wagmiAccount,
    useBalance: (options) => {
        mocks.balanceOptions.push(options)
        return {
            data: mocks.account.isConnected || mocks.wagmiAccount.status === 'connected'
                ? { value: mocks.nativeBalance }
                : undefined,
            refetch: mocks.refetchBalance,
        }
    },
    useChainId: () => mocks.network.chainId,
    useDisconnect: () => ({ mutate: vi.fn() }),
    useConnection: () => ({ connector: null }),
    usePublicClient: () => mocks.publicClient,
    useWalletClient: () => ({ data: null }),
    useSendTransaction: () => ({
        mutateAsync: mocks.sendTransaction,
    }),
    useWriteContract: () => ({ mutateAsync: vi.fn() }),
    useWaitForTransactionReceipt: () => ({
        isSuccess: false,
        isError: false,
    }),
}))

vi.mock('wagmi/actions', () => ({
    getWalletClient: vi.fn(async () => ({
        chain: { id: mocks.network.chainId },
        name: 'Test wallet',
        sendTransaction: mocks.sendTransaction,
    })),
}))

vi.mock('./features/tokens/hooks/useMarketTokens.js', () => ({
    useMarketTokens: () => ({
        tokens: mocks.marketTokens.map((token) => ({
            verificationStatus: 'established',
            verificationReasons: [
                'coingecko-exact-contract',
                'minimum-liquidity-met',
            ],
            liquidityUsd: 250_000,
            possibleSpam: false,
            securityStatus: 'low',
            visibility: 'primary',
            ...token,
        })),
        loading: false,
        error: null,
    }),
}))

vi.mock('./features/tokens/hooks/useWalletTokens.js', () => ({
    useWalletTokens: (options) =>
        mocks.useWalletTokens(options),
}))

vi.mock('./features/gas-assist/hooks/useGasAssistConfig.js', () => ({
    useGasAssistConfig: () => mocks.gasAssistConfig,
}))

vi.mock('./features/gas-assist/hooks/useZeroXGaslessSwap.js', () => ({
    useZeroXGaslessSwap: (options) => {
        mocks.gasAssistOptions.push(options)
        return mocks.gasAssistState
    },
}))

vi.mock('./features/approvals/hooks/useSwapApproval.js', () => ({
    useSwapApproval: () => ({
        prepareSwapApproval: mocks.prepareSwapApproval,
        getLastPreparationResult: () => mocks.approvalResult,
        invalidatePermit2Readiness: mocks.invalidatePermit2Readiness,
    }),
}))

vi.mock('./features/swap/services/quotes.js', async (importOriginal) => ({
    ...await importOriginal(),
    fetchSwapQuote: mocks.fetchSwapQuote,
}))

vi.mock('./features/cross-chain/services/crossChainRoutes.js', async (importOriginal) => ({
    ...await importOriginal(),
    fetchCrossChainRoutes: mocks.fetchCrossChainRoutes,
    authenticateCrossChainWallet: mocks.authenticateCrossChainWallet,
    prepareCrossChainRoute: mocks.prepareCrossChainRoute,
    claimCrossChainRoute: mocks.claimCrossChainRoute,
    markCrossChainRouteSubmitted: mocks.markCrossChainRouteSubmitted,
}))

vi.mock('./features/cross-chain/services/crossChainExecution.js', async (importOriginal) => ({
    ...await importOriginal(),
    resolveCurrentCrossChainWallet: mocks.resolveCurrentCrossChainWallet,
    sendPreparedCrossChainTransaction: mocks.sendPreparedCrossChainTransaction,
    waitForCrossChainApproval: mocks.waitForCrossChainApproval,
}))

import App from './App.jsx'
import { CrossChainExecutionError } from './features/cross-chain/services/crossChainExecution.js'

const ADDRESS =
    '0x0000000000000000000000000000000000000001'
const QTKN_ADDRESS =
    '0x0000000000000000000000000000000000000056'
const BNB_ADDRESS =
    '0x0000000000000000000000000000000000000000'
const PERMIT2_ADDRESS =
    '0x000000000022d473030f116ddee9f6b43ac78ba3'
const ROUTER_ADDRESS =
    '0x00000000000000000000000000000000000000aa'
const simulationErrorAbi = parseAbi([
    'error AllowanceExpired(uint256 deadline)',
    'error InsufficientAllowance(uint256 amount)',
    'error TransactionDeadlinePassed()',
])

function configureSameChainQuoteToken(overrides = {}) {
    mocks.account.address = ADDRESS
    mocks.account.isConnected = true
    mocks.network.chainId = 56
    mocks.marketTokens = [{
        chainId: 56,
        address: QTKN_ADDRESS,
        name: 'Quote token',
        symbol: 'QTKN',
        decimals: 18,
        volume24hUsd: 1_000,
        recognitionStatus: 'established',
        verifiedContract: true,
        possibleSpam: false,
        securityStatus: 'trusted',
        visibility: 'primary',
        rawBalance: '100000000000000000000',
        balance: '100',
        marketPriceUSD: '3',
        priceConfidence: 'market',
        ...overrides,
    }]
}

function selectBuyToken(container, getAllByText) {
    fireEvent.click(container.querySelector('.buy-token-position button'))
    fireEvent.click(getAllByText('QTKN')
        .map((node) => node.closest('.ps-token-row'))
        .find(Boolean))
}

function sameChainExecutableQuote(overrides = {}) {
    return {
        selectedQuote: {
            chainId: 56,
            sellToken: QTKN_ADDRESS,
            buyToken: BNB_ADDRESS,
            sellAmount: '1000000000000000',
            buyAmount: '2000000000000000000',
            minimumBuyAmount: '1900000000000000000',
            expiresAt: '2999-01-01T00:00:00.000Z',
            transaction: {
                to: '0x00000000000000000000000000000000000000aa',
                data: '0x1234',
                value: '0',
                gas: '100000',
                gasPrice: '2000000000',
            },
            ...overrides,
        },
    }
}

function pancakeExecutableQuote(overrides = {}) {
    return {
        ...sameChainExecutableQuote({
        provider: 'pancakeswap',
        mode: 'EXACT_INPUT',
        allowanceTarget: PERMIT2_ADDRESS,
        approval: {
            mode: 'permit2-allowance',
            token: QTKN_ADDRESS,
            spender: ROUTER_ADDRESS,
            contract: PERMIT2_ADDRESS,
            requiredAmount: '1000000000000000',
        },
        ...overrides,
        }),
        approvalSchemaVersion: 1,
    }
}

function selectQtknToBnb(container, getAllByText) {
    fireEvent.click(container.querySelector('.sell-token-position button'))
    fireEvent.click(getAllByText('QTKN')
        .map((node) => node.closest('.ps-token-row'))
        .find(Boolean))
    fireEvent.click(container.querySelector('.buy-token-position button'))
    fireEvent.click(getAllByText('BNB')
        .map((node) => node.closest('.ps-token-row'))
        .find(Boolean))
}

describe('App wallet integration', () => {
    beforeEach(() => {
        globalThis.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        vi.stubEnv('VITE_METAMASK_MULTICHAIN_ENABLED', 'false')
        mocks.account.address = undefined
        mocks.account.isConnected = false
        mocks.wagmiAccount.address = undefined
        mocks.wagmiAccount.addresses = undefined
        mocks.wagmiAccount.chainId = undefined
        mocks.wagmiAccount.connector = null
        mocks.wagmiAccount.isConnected = false
        mocks.wagmiAccount.status = 'disconnected'
        mocks.network.chainId = 56
        mocks.open.mockReset()
        mocks.switchNetwork.mockReset()
        mocks.useWalletTokens.mockReset()
        mocks.refetchWalletTokens.mockReset()
        mocks.balanceOptions = []
        mocks.fetchSwapQuote.mockReset()
        mocks.fetchCrossChainRoutes.mockReset()
        mocks.authenticateCrossChainWallet.mockReset()
        mocks.prepareCrossChainRoute.mockReset()
        mocks.claimCrossChainRoute.mockReset()
        mocks.markCrossChainRouteSubmitted.mockReset()
        mocks.resolveCurrentCrossChainWallet.mockReset()
        mocks.sendPreparedCrossChainTransaction.mockReset()
        mocks.waitForCrossChainApproval.mockReset()
        mocks.sendTransaction.mockReset()
        mocks.prepareSwapApproval.mockReset().mockResolvedValue(true)
        mocks.invalidatePermit2Readiness.mockReset()
        mocks.approvalResult = {
            approvalReady: true,
            approvalTransactionSubmitted: false,
        }
        mocks.nativeBalance = 5_349_631_675_469_080n
        mocks.publicClient.estimateGas.mockReset().mockResolvedValue(100_000n)
        mocks.publicClient.estimateFeesPerGas.mockReset()
            .mockResolvedValue({ maxFeePerGas: 2_000_000_000n })
        mocks.publicClient.getGasPrice.mockReset().mockResolvedValue(2_000_000_000n)
        mocks.publicClient.call.mockReset().mockResolvedValue('0x')
        mocks.gasAssistConfig = {
            status: 'success',
            config: { enabled: false, mode: 'disabled' },
            error: null,
            refetch: vi.fn(),
        }
        mocks.gasAssistState = {
            quote: null,
            quoteStatus: 'idle',
            quoteError: null,
            dialog: { open: false, state: 'idle' },
            open: vi.fn(),
            close: vi.fn(),
            confirm: vi.fn(),
        }
        mocks.gasAssistOptions = []
        mocks.authenticateCrossChainWallet.mockResolvedValue({
            sessionToken: 'test-session',
            walletAddress: ADDRESS,
            chainId: 56,
        })
        mocks.claimCrossChainRoute.mockResolvedValue({ claimed: true })
        mocks.markCrossChainRouteSubmitted.mockResolvedValue({ accepted: true })
        mocks.resolveCurrentCrossChainWallet.mockResolvedValue({
            walletClient: { account: { address: ADDRESS }, chain: { id: 56 } },
            connector: { id: 'test', name: 'Test connector' },
            provider: { request: vi.fn() },
        })
        mocks.sendPreparedCrossChainTransaction.mockResolvedValue(`0x${'12'.repeat(32)}`)
        mocks.waitForCrossChainApproval.mockResolvedValue({ status: 'success' })
        window.localStorage.clear()
        mocks.marketTokens = []
        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('keeps the official Reown connection flow while disconnected', () => {
        const { container, getByRole } = render(<App />)

        fireEvent.click(getByRole('button', { name: 'Connect' }))
        expect(mocks.open).toHaveBeenCalledWith({ view: 'Connect' })
        mocks.open.mockClear()

        const primaryAction =
            container.querySelector('.primary-action')

        expect(primaryAction.textContent).toBe('Connect wallet')
        expect(primaryAction.disabled).toBe(false)

        fireEvent.click(primaryAction)

        expect(mocks.open).toHaveBeenCalledWith({
            view: 'Connect',
        })
    })

    it('does not expose the removed MetaMask signing diagnostic', () => {
        vi.stubEnv('VITE_METAMASK_MULTICHAIN_ENABLED', 'true')
        const { queryByRole } = render(<App />)
        expect(queryByRole('button', { name: 'MetaMask Signing Test' })).toBeNull()
        expect(queryByRole('button', { name: 'Test zero-gas raw signing' })).toBeNull()
        expect(window.openMetaMaskSigningTest).toBeUndefined()
    })

    it('loads chain-scoped wallet tokens independently of the connected network', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 1

        const { container } = render(<App />)

        expect(mocks.useWalletTokens).toHaveBeenCalledWith({
            chainId: 'all',
            walletAddress: ADDRESS,
            enabled: true,
        })

        const primaryAction =
            container.querySelector('.primary-action')

        expect(primaryAction.textContent).toBe(
            'Switch to BNB Chain',
        )
        expect(primaryAction.disabled).toBe(false)

        fireEvent.click(primaryAction)

        expect(mocks.switchNetwork).toHaveBeenCalledOnce()
    })

    it('enables normal token selection state on BSC', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56

        const { container } = render(<App />)

        expect(mocks.useWalletTokens).toHaveBeenCalledWith({
            chainId: 'all',
            walletAddress: ADDRESS,
            enabled: true,
        })
        expect(
            container.querySelector('.primary-action').textContent,
        ).toBe('Select a token')
    })

    it('uses a selected token chain for wallet network and native balance state', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.marketTokens = [{
            chainId: 8453,
            address: '0x0000000000000000000000000000000000008453',
            name: 'Base token',
            symbol: 'BASE',
            decimals: 18,
            volume24hUsd: 1_000,
            verificationStatus: 'established',
            visibility: 'primary',
        }]

        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        fireEvent.click(getByRole('button', { name: 'Token network' }))
        fireEvent.click(getByRole('option', { name: 'Base' }))
        const baseRow = getAllByText('BASE')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean)
        fireEvent.click(baseRow)

        expect(mocks.useWalletTokens).toHaveBeenLastCalledWith({
            chainId: 'all',
            walletAddress: ADDRESS,
            enabled: true,
        })
        expect(mocks.balanceOptions.at(-1).chainId).toBe(8453)
        expect(container.querySelector('.primary-action').textContent)
            .toBe('Switch to Base')

        fireEvent.click(container.querySelector('.primary-action'))
        expect(mocks.switchNetwork).toHaveBeenCalledWith(
            expect.objectContaining({ id: 8453 }),
        )
    })

    it('keeps mixed-chain pairs in Swap and offers cross-chain route review', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.marketTokens = [{
            chainId: 8453,
            address: '0x0000000000000000000000000000000000008453',
            name: 'Base token',
            symbol: 'BASE',
            decimals: 18,
            volume24hUsd: 1_000,
            verificationStatus: 'established',
            visibility: 'primary',
        }]

        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getByRole('button', { name: 'Token network' }))
        fireEvent.click(getByRole('option', { name: 'Base' }))
        const baseRow = getAllByText('BASE')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean)
        fireEvent.click(baseRow)

        const action = container.querySelector('.primary-action')
        expect(action.textContent).toBe('Enter an amount')
        expect(action.disabled).toBe(true)
        expect(getByRole('button', { name: 'Swap' }).className).toContain('active')
        expect(container.textContent).not.toContain('Use Bridge')
        expect(container.textContent).not.toContain('Cross-chain swap')
        expect(container.textContent).not.toContain('Find routes')
    })

    it('automatically quotes a mixed-chain pair in the normal Buy card and CTA', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.nativeBalance = 2_000_000_000_000_000_000n
        mocks.useWalletTokens.mockReturnValue({
            tokens: [{
                chainId: 56,
                address: '0x0000000000000000000000000000000000000000',
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18,
                isNative: true,
                recognitionStatus: 'established',
                possibleSpam: false,
                visibility: 'primary',
                securityStatus: 'low',
                trustedPriceUSD: '600',
                priceConfidence: 'trusted',
            }],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })
        mocks.marketTokens = [{
            chainId: 42220,
            address: '0x000000000000000000000000000000000000ce10',
            name: 'Celo',
            symbol: 'CELO',
            decimals: 18,
            volume24hUsd: 1_000,
            verificationStatus: 'established',
            visibility: 'primary',
        }]
        mocks.fetchCrossChainRoutes.mockImplementation(async ({ request }) => {
            const route = {
                id: 'relay-route',
                publicRouteId: 'relay-route',
                provider: 'relay',
                state: 'quote-ready',
                executionModel: 'evm-transaction',
                sourceChainId: request.sourceAsset.chainId,
                destinationChainId: request.destinationAsset.chainId,
                sourceAsset: request.sourceAsset,
                destinationAsset: request.destinationAsset,
                recipient: request.recipient,
                inputAmount: request.amount,
                outputAmount: '13392128000000000000',
                minimumOutputAmount: '13258206000000000000',
                feeAmountUsd: null,
                feeIncluded: true,
                costs: {
                    sourceGasUsd: null,
                    sourceGasNative: null,
                    destinationGasUsd: '0.03',
                    providerFeeUsd: '0.01',
                    appFeeUsd: null,
                    swapImpactUsd: null,
                    sponsoredUsd: null,
                    routeCostUsd: '0.04',
                    totalEstimatedUsd: null,
                    currency: 'USD',
                    confidence: 'quote',
                },
                costBreakdownAvailable: true,
                durationSeconds: 4,
                expiresAt: '2999-01-01T00:00:00.000Z',
                warnings: [],
                steps: [],
            }
            return { routes: [route], selectedRoute: route }
        })

        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getByRole('button', { name: 'Token network' }))
        fireEvent.click(getByRole('option', { name: 'Celo' }))
        fireEvent.click(getAllByText('CELO')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '1' },
        })

        await waitFor(() => expect(mocks.fetchCrossChainRoutes).toHaveBeenCalledTimes(1))
        expect(mocks.fetchSwapQuote).not.toHaveBeenCalled()
        expect(mocks.gasAssistOptions.every(({ quoteEnabled }) => quoteEnabled === false))
            .toBe(true)
        await waitFor(() => expect(getByRole('textbox', { name: 'Buy amount' }).value)
            .toBe('13.392128'))
        const reviewButtons = getAllByText('Review swap')
        expect(reviewButtons).toHaveLength(1)
        expect(reviewButtons[0].closest('button').disabled).toBe(false)
        expect(container.textContent).not.toContain('13392128000000000000')
        expect(container.textContent).not.toContain('Cross-chain swap')
        expect(container.textContent).not.toContain('Find routes')
        expect(container.querySelector('details').open).toBe(true)
        expect(container.textContent).toContain('Estimated route cost~$0.04')
        expect(container.textContent).toContain('Source network gasCalculated at confirmation')
        expect(container.textContent).not.toContain('Network costUnavailable')
        expect(container.textContent).not.toContain('Swap/route impact')
        expect(container.textContent).not.toContain('Free')
    })

    it('keeps cross-chain review open and maps an illegal provider invocation', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.nativeBalance = 2_000_000_000_000_000_000n
        mocks.useWalletTokens.mockReturnValue({
            tokens: [{
                chainId: 56,
                address: '0x0000000000000000000000000000000000000000',
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18,
                isNative: true,
                recognitionStatus: 'established',
                possibleSpam: false,
                visibility: 'primary',
                securityStatus: 'low',
                trustedPriceUSD: '600',
                priceConfidence: 'trusted',
            }],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })
        mocks.marketTokens = [{
            chainId: 8453,
            address: '0x0000000000000000000000000000000000008453',
            name: 'Base token',
            symbol: 'BASE',
            decimals: 18,
            volume24hUsd: 1_000,
            verificationStatus: 'established',
            visibility: 'primary',
        }]
        let route
        mocks.fetchCrossChainRoutes.mockImplementation(async ({ request }) => {
            route = {
                id: 'relay-runtime',
                publicRouteId: 'relay-runtime',
                provider: 'relay',
                state: 'quote-ready',
                executionModel: 'evm-transaction',
                sourceChainId: 56,
                destinationChainId: 8453,
                sourceAsset: request.sourceAsset,
                destinationAsset: request.destinationAsset,
                recipient: request.recipient,
                inputAmount: request.amount,
                outputAmount: '1000000000000000000',
                minimumOutputAmount: '990000000000000000',
                feeAmountUsd: null,
                feeIncluded: true,
                costs: {
                    destinationGasUsd: '0.03',
                    providerFeeUsd: '0.01',
                    appFeeUsd: '0',
                    routeCostUsd: '0.04',
                    confidence: 'quote',
                },
                durationSeconds: 10,
                expiresAt: '2999-01-01T00:00:00.000Z',
                warnings: [],
                steps: [],
            }
            return { routes: [route], selectedRoute: route }
        })
        mocks.prepareCrossChainRoute.mockImplementation(async () => ({
            ...route,
            steps: [{
                id: 'deposit',
                index: 0,
                type: 'source-transaction',
                chainId: 56,
                transaction: {
                    to: '0x0000000000000000000000000000000000000002',
                    data: '0x1234',
                    value: '1',
                },
            }],
        }))
        mocks.sendPreparedCrossChainTransaction.mockRejectedValue(
            new CrossChainExecutionError(
                'send-deposit',
                'Swap transaction could not be opened in your wallet.',
                new TypeError('Illegal invocation'),
            ),
        )

        const { container, getAllByText, getByRole, getByText } = render(<App />)
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getByRole('button', { name: 'Token network' }))
        fireEvent.click(getByRole('option', { name: 'Base' }))
        fireEvent.click(getAllByText('BASE').map((node) => node.closest('.ps-token-row')).find(Boolean))
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), { target: { value: '1' } })
        await waitFor(() => expect(mocks.fetchCrossChainRoutes).toHaveBeenCalledOnce())
        fireEvent.click(container.querySelector('.primary-action'))
        expect(getByRole('button', { name: 'Preparing estimate...' }).disabled).toBe(true)
        expect(mocks.sendPreparedCrossChainTransaction).not.toHaveBeenCalled()
        await waitFor(() => expect(getByRole('button', { name: 'Confirm swap' }).disabled).toBe(false))
        expect(getByText('~$0.16')).toBeTruthy()
        expect(getByText('$0.04')).toBeTruthy()
        expect(getAllByText('Free').length).toBeGreaterThan(0)
        expect(getByText('Final network cost may change with gas prices.')).toBeTruthy()
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(getByText(
            'The connected wallet could not process this transaction.',
        )).toBeTruthy())
        expect(getByRole('heading', { name: 'Review cross-chain swap' })).toBeTruthy()
        expect(getByRole('button', { name: 'Confirm swap' }).disabled).toBe(false)
        expect(mocks.markCrossChainRouteSubmitted).not.toHaveBeenCalled()
    })

    it('disables cross-chain confirmation when prepared gas exceeds native balance', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.nativeBalance = 1n
        mocks.marketTokens = [
            {
                chainId: 56,
                address: '0x0000000000000000000000000000000000000056',
                name: 'BSC token',
                symbol: 'BSCX',
                decimals: 18,
                rawBalance: '2000000000000000000',
                balance: '2',
                volume24hUsd: 2_000,
                verificationStatus: 'established',
                visibility: 'primary',
            },
            {
                chainId: 8453,
                address: '0x0000000000000000000000000000000000008453',
                name: 'Base token',
                symbol: 'BASE',
                decimals: 18,
                volume24hUsd: 1_000,
                verificationStatus: 'established',
                visibility: 'primary',
            },
        ]
        let route
        mocks.fetchCrossChainRoutes.mockImplementation(async ({ request }) => {
            route = {
                id: 'relay-low-gas',
                publicRouteId: 'relay-low-gas',
                provider: 'relay',
                state: 'quote-ready',
                executionModel: 'evm-transaction',
                sourceChainId: 56,
                destinationChainId: 8453,
                sourceAsset: request.sourceAsset,
                destinationAsset: request.destinationAsset,
                recipient: request.recipient,
                inputAmount: request.amount,
                outputAmount: '1000000000000000000',
                minimumOutputAmount: '990000000000000000',
                feeIncluded: true,
                costs: { routeCostUsd: '0.04', confidence: 'quote' },
                durationSeconds: 10,
                expiresAt: '2999-01-01T00:00:00.000Z',
                steps: [],
            }
            return { routes: [route], selectedRoute: route }
        })
        mocks.prepareCrossChainRoute.mockImplementation(async () => ({
            ...route,
            steps: [{
                id: 'deposit',
                index: 0,
                type: 'source-transaction',
                chainId: 56,
                transaction: {
                    to: '0x0000000000000000000000000000000000000002',
                    data: '0x1234',
                    value: '0',
                },
            }],
        }))

        const { container, getAllByText, getByRole, getByText } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        fireEvent.click(getAllByText('BSCX').map((node) => node.closest('.ps-token-row')).find(Boolean))
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getByRole('button', { name: 'Token network' }))
        fireEvent.click(getByRole('option', { name: 'Base' }))
        fireEvent.click(getAllByText('BASE').map((node) => node.closest('.ps-token-row')).find(Boolean))
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), { target: { value: '1' } })
        await waitFor(() => expect(mocks.fetchCrossChainRoutes).toHaveBeenCalledOnce())
        fireEvent.click(container.querySelector('.primary-action'))

        await waitFor(() => expect(getByText('Not enough BNB for network gas.')).toBeTruthy())
        expect(getByRole('button', { name: 'Confirm swap' }).disabled).toBe(true)
        expect(mocks.sendPreparedCrossChainTransaction).not.toHaveBeenCalled()
        expect(mocks.claimCrossChainRoute).not.toHaveBeenCalled()
    })

    it('quotes and broadcasts a non-BSC pair only on its token chain', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.nativeBalance = 5_000_000_000_000_000_000n
        mocks.marketTokens = [
            {
                chainId: 8453,
                address: '0x0000000000000000000000000000000000000000',
                name: 'Base token A',
                symbol: 'BASEA',
                decimals: 18,
                isNative: true,
                volume24hUsd: 2_000,
                verificationStatus: 'established',
                visibility: 'primary',
                rawBalance: '2000000000000000000',
                balance: '2',
            },
            {
                chainId: 8453,
                address: '0x0000000000000000000000000000000000008454',
                name: 'Base token B',
                symbol: 'BASEB',
                decimals: 18,
                volume24hUsd: 1_000,
                verificationStatus: 'established',
                visibility: 'primary',
            },
        ]
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                chainId: 8453,
                sellToken: '0x0000000000000000000000000000000000000000',
                buyToken: '0x0000000000000000000000000000000000008454',
                buyAmount: '2000000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
                transaction: {
                    to: '0x0000000000000000000000000000000000000002',
                    data: '0x1234',
                    value: '0',
                },
            },
        })
        mocks.sendTransaction.mockResolvedValue('0xabc')

        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        fireEvent.click(getByRole('button', { name: 'Token network' }))
        fireEvent.click(getByRole('option', { name: 'Base' }))
        fireEvent.click(getAllByText('BASEA')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))

        mocks.network.chainId = 8453
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getAllByText('BASEB')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '1' },
        })

        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalled())
        expect(mocks.fetchCrossChainRoutes).not.toHaveBeenCalled()
        expect(mocks.fetchSwapQuote.mock.calls.at(-1)[0].request.chainId)
            .toBe(8453)
        await waitFor(() =>
            expect(container.querySelector('.primary-action').textContent)
                .toBe('Review swap'),
        )
        fireEvent.click(container.querySelector('.primary-action'))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))
        await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalled())
        expect(mocks.sendTransaction.mock.calls.at(-1)[0].chainId).toBe(8453)
    })

    it('preserves a standard BSC route when Gas Assist is unavailable', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.nativeBalance = 2_000_000_000_000_000_000n
        mocks.gasAssistConfig = {
            status: 'success',
            config: { enabled: true, mode: 'zero-x-gasless' },
            error: null,
            refetch: vi.fn(),
        }
        mocks.gasAssistState = {
            quote: null,
            quoteStatus: 'error',
            quoteError: {
                code: 'GAS_ASSIST_PROVIDER_UNAVAILABLE',
                message: 'Gas-assisted execution is unavailable.',
                status: 503,
                fallbackAllowed: true,
            },
            dialog: { open: false, state: 'idle' },
            open: vi.fn(),
            close: vi.fn(),
            confirm: vi.fn(),
        }
        mocks.marketTokens = [{
            chainId: 56,
            address: '0x0000000000000000000000000000000000000056',
            name: 'BSC token',
            symbol: 'BSCX',
            decimals: 18,
            volume24hUsd: 1_000,
            verificationStatus: 'established',
            visibility: 'primary',
        }]
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                chainId: 56,
                sellToken: BNB_ADDRESS,
                buyToken: QTKN_ADDRESS,
                sellAmount: '1000000000000000000',
                buyAmount: '2000000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
                transaction: {
                    to: '0x0000000000000000000000000000000000000002',
                    data: '0x1234',
                    value: '0',
                },
            },
        })

        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getAllByText('BSCX')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '1' },
        })

        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalled())
        await waitFor(() => expect(container.querySelector('.primary-action').textContent)
            .toBe('Review swap'))
        expect(container.textContent).not.toContain('No available routes')
        expect(container.textContent).not.toContain('GAS_ASSIST_PROVIDER_UNAVAILABLE')
    })

    it('keeps the app enabled when Wagmi restores a wallet before AppKit account state catches up', () => {
        mocks.wagmiAccount.address = ADDRESS
        mocks.wagmiAccount.chainId = 56
        mocks.wagmiAccount.connector = { id: 'pistachio-local' }
        mocks.wagmiAccount.isConnected = true
        mocks.wagmiAccount.status = 'connected'
        mocks.account.address = undefined
        mocks.account.isConnected = false

        const { container } = render(<App />)

        expect(mocks.useWalletTokens).toHaveBeenCalledWith({
            chainId: 'all',
            walletAddress: ADDRESS,
            enabled: true,
        })
        expect(
            container.querySelector('.primary-action').textContent,
        ).toBe('Select a token')
    })

    it('changes unknown-token presentation without refetching wallet balances', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        const { getByRole } = render(<App />)

        fireEvent.click(getByRole('button', { name: 'Swap settings' }))
        const toggle = getByRole('switch', { name: 'Hide unknown tokens' })
        expect(toggle.getAttribute('aria-checked')).toBe('true')
        fireEvent.click(toggle)

        expect(toggle.getAttribute('aria-checked')).toBe('false')
        expect(mocks.refetchWalletTokens).not.toHaveBeenCalled()
    })

    it('opens an all-network portfolio without a header chain selector', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.useWalletTokens.mockReturnValue({
            tokens: [{
                classificationVersion: 4,
                chainId: 56,
                address: '0x0000000000000000000000000000000000000000',
                isNative: true,
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18,
                rawBalance: '1',
                balance: '0.000000000000000001',
                priceUSD: '600',
                trustedPriceUSD: '600',
                priceConfidence: 'trusted',
                recognitionStatus: 'established',
                recognitionReasons: ['native-bnb'],
                spamStatus: 'clean',
                possibleSpam: false,
                verifiedContract: null,
                spamReasons: ['native-bnb'],
                securityStatus: 'trusted',
                visibility: 'primary',
            }],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })

        const { getByRole, queryByText } = render(<App />)
        fireEvent.click(getByRole('button', { name: /Open account/ }))

        expect(document.querySelector('.wallet-native-balance').textContent)
            .toBe('1 asset')
        expect(getByRole('heading', { name: 'All Networks' })).toBeTruthy()
        expect(document.querySelector('.appkit-network-control')).toBeNull()
        expect(queryByText('Fund wallet')).toBeNull()
    })

    it('keeps the direct native balance visible after a Portfolio failure and offers Retry', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: 'Wallet balances could not be loaded.',
            chainErrors: {},
            partial: false,
            stale: false,
            refetch: mocks.refetchWalletTokens,
        })
        const { getByRole, getByText } = render(<App />)

        expect(getByText('Wallet balances could not be loaded.')).toBeTruthy()
        fireEvent.click(getByRole('button', { name: 'Retry' }))
        expect(mocks.refetchWalletTokens).toHaveBeenCalledTimes(1)

        fireEvent.click(getByRole('button', { name: /Open account/ }))
        expect(document.querySelector('.wallet-native-balance').textContent)
            .toBe('1 asset')
        expect(document.querySelector('.wallet-asset-list').textContent)
            .toContain('BNB')
    })

    it('does not show a refresh-failure warning for a partial response without failed chains', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: null,
            chainErrors: {},
            failedChainIds: [],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            partial: true,
            stale: false,
            refetch: mocks.refetchWalletTokens,
        })

        const { queryByText } = render(<App />)

        expect(queryByText('Some network balances could not be refreshed.')).toBeNull()
        expect(queryByText('Showing previously loaded balances.')).toBeNull()
    })

    it('shows a refresh-failure warning when failedChainIds is non-empty', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: null,
            chainErrors: { 137: 'This network balance could not be refreshed.' },
            failedChainIds: [137],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            partial: true,
            stale: false,
            refetch: mocks.refetchWalletTokens,
        })

        const { getByText } = render(<App />)

        expect(getByText('Some network balances could not be refreshed.')).toBeTruthy()
    })

    it('shows the stale-balance warning only when stale is true', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: null,
            chainErrors: {},
            failedChainIds: [],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            partial: false,
            stale: true,
            refetch: mocks.refetchWalletTokens,
        })

        const { getByText, queryByText } = render(<App />)

        expect(getByText('Showing previously loaded balances.')).toBeTruthy()
        expect(queryByText('Some network balances could not be refreshed.')).toBeNull()
    })

    it('does not present unsupported or provider-rejected networks as temporary failures', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true

        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: null,
            chainErrors: {},
            failedChainIds: [],
            providerRejectedChainIds: [137],
            unsupportedChainIds: [34443],
            partial: true,
            stale: false,
            refetch: mocks.refetchWalletTokens,
        })

        const { queryByText } = render(<App />)

        expect(queryByText('Some network balances could not be refreshed.')).toBeNull()
        expect(queryByText('Showing previously loaded balances.')).toBeNull()
    })

    it('clicking native balance and percentages use the spendable amount', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        const { container, getByRole } = render(<App />)
        const amountInput = getByRole('textbox', { name: 'Sell amount' })

        fireEvent.click(getByRole('button', { name: 'Use maximum BNB balance' }))
        expect(amountInput.value).toBe('0.00529963167546908')

        fireEvent.pointerEnter(container.querySelector('.sell-panel'))
        fireEvent.click(getByRole('button', { name: '50%' }))
        expect(amountInput.value).toBe('0.00217481583773454')
    })

    it('clicking an ERC-20 sell balance fills the complete exact amount', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        const usdc = {
            classificationVersion: 4,
            chainId: 56,
            address: '0x0000000000000000000000000000000000000011',
            name: 'USD Coin',
            symbol: 'USDC',
            decimals: 6,
            rawBalance: '123456789',
            balance: '123.456789',
            valueUSD: '123.456789',
            priceUSD: '1',
            trustedPriceUSD: '1',
            priceConfidence: 'trusted',
            recognitionStatus: 'established',
            recognitionReasons: ['established-catalog'],
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: null,
            spamReasons: ['moralis-clean'],
            securityStatus: 'trusted',
            visibility: 'primary',
        }
        mocks.marketTokens = [usdc]
        mocks.useWalletTokens.mockReturnValue({
            tokens: [usdc],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })
        const { container, getByRole, getAllByText } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        const usdcRow = getAllByText('USDC')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean)
        fireEvent.click(usdcRow)
        fireEvent.click(getByRole('button', { name: 'Use maximum USDC balance' }))
        expect(getByRole('textbox', { name: 'Sell amount' }).value).toBe('123.456789')
    })

    it('shows the exact recognized USDT market price in the fiat section', () => {
        const usdt = {
            classificationVersion: 4,
            chainId: 56,
            address: '0x55d398326f99059ff775485246999027b3197955',
            name: 'Tether USD',
            symbol: 'USDT',
            decimals: 18,
            rawBalance: '10000000000000000000',
            balance: '10',
            priceUSD: null,
            trustedPriceUSD: null,
            marketPriceUSD: '1',
            priceConfidence: 'market',
            recognitionStatus: 'established',
            recognitionReasons: ['curated-official-contract'],
            spamStatus: 'clean',
            possibleSpam: false,
            verifiedContract: true,
            spamReasons: [],
            securityStatus: 'trusted',
            visibility: 'primary',
        }
        mocks.marketTokens = [usdt]
        mocks.useWalletTokens.mockReturnValue({
            tokens: [usdt],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })

        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        const usdtRow = getAllByText('USDT')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean)
        fireEvent.click(usdtRow)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '2.5' },
        })

        expect(container.querySelector('.sell-fiat-value').textContent)
            .toBe('$2.50')
    })

    it('toggles Sell into USD mode and sends a token-denominated exact-input quote', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.marketTokens = [
            {
                chainId: 56,
                address: '0x00000000000000000000000000000000000000a1',
                name: 'USD Token',
                symbol: 'USDT',
                decimals: 18,
                volume24hUsd: 1_000,
                liquidityUsd: 250_000,
                recognitionStatus: 'established',
                verifiedContract: true,
                possibleSpam: false,
                securityStatus: 'trusted',
                visibility: 'primary',
                marketPriceUSD: '1',
            },
            {
                chainId: 56,
                address: '0x00000000000000000000000000000000000000b2',
                name: 'Quote token',
                symbol: 'QTKN',
                decimals: 18,
                volume24hUsd: 1_000,
                liquidityUsd: 250_000,
                recognitionStatus: 'established',
                verifiedContract: true,
                possibleSpam: false,
                securityStatus: 'trusted',
                visibility: 'primary',
                marketPriceUSD: '3',
            },
        ]
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                buyAmount: '6000000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        fireEvent.click(getAllByText('USDT')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        selectBuyToken(container, getAllByText)

        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '1' },
        })
        fireEvent.click(getByRole('button', { name: 'Show Sell amount in USD' }))

        expect(getByRole('textbox', { name: 'Sell USD amount' }).value).toBe('1')
        expect(getByRole('button', { name: 'Show Sell amount in USDT' }).textContent)
            .toContain('1 USDT')

        fireEvent.change(getByRole('textbox', { name: 'Sell USD amount' }), {
            target: { value: '10' },
        })

        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalled())
        const request = mocks.fetchSwapQuote.mock.calls.at(-1)[0].request
        expect(request).toEqual(expect.objectContaining({
            mode: 'EXACT_INPUT',
            buyAmount: null,
        }))
        expect(request.sellAmount).toMatch(/^\d+$/)
        expect(request.sellAmount).not.toBe('10')
    })

    it('toggles Buy into USD mode independently and sends a token-denominated exact-output quote', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                sellAmount: '4000000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectBuyToken(container, getAllByText)

        fireEvent.click(getByRole('button', { name: 'Show Buy amount in USD' }))
        fireEvent.change(getByRole('textbox', { name: 'Buy USD amount' }), {
            target: { value: '9' },
        })

        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalled())
        const request = mocks.fetchSwapQuote.mock.calls.at(-1)[0].request
        expect(request).toEqual(expect.objectContaining({
            mode: 'EXACT_OUTPUT',
            sellAmount: '0',
        }))
        expect(request.buyAmount).toBe('3000000000000000000')
        expect(getByRole('textbox', { name: 'Buy USD amount' }).value).toBe('9')
    })

    it('keeps token mode and reports unavailable USD input when display price is unsafe or missing', () => {
        const { getByRole, getByText } = render(<App />)

        fireEvent.click(getByRole('button', { name: 'Show Buy amount in USD' }))

        expect(getByText('USD input is unavailable for this token.')).toBeTruthy()
        expect(getByRole('textbox', { name: 'Buy amount' })).toBeTruthy()
    })

    it('blocks wallet submission when final read-only simulation predicts failure', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const data = encodeErrorResult({
            abi: simulationErrorAbi,
            errorName: 'AllowanceExpired',
            args: [0n],
        })
        mocks.publicClient.estimateGas.mockRejectedValue({
            cause: { data },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)

        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })
        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(getByRole('heading', { name: 'Review swap' })).toBeTruthy())
        expect(getByRole('status').textContent).toContain(
            'The Permit2 authorization expired. Refreshing approval is required.',
        )
        expect(mocks.publicClient.call).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('refreshes a Pancake quote after approval and simulates refreshed calldata', async () => {
        configureSameChainQuoteToken()
        const original = pancakeExecutableQuote()
        const refreshed = pancakeExecutableQuote({
            transaction: {
                ...original.selectedQuote.transaction,
                data: '0xabcd',
            },
        })
        mocks.fetchSwapQuote
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(refreshed)
        mocks.approvalResult = {
            approvalReady: true,
            approvalTransactionSubmitted: true,
        }
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(mocks.publicClient.estimateGas).toHaveBeenCalled())
        expect(mocks.fetchSwapQuote).toHaveBeenLastCalledWith(expect.objectContaining({
            forceRefresh: true,
        }))
        expect(mocks.publicClient.estimateGas).toHaveBeenCalledWith(
            expect.objectContaining({ data: '0xabcd' }),
        )
    })

    it('recovers once from Permit2 AllowanceExpired and simulates the refreshed quote', async () => {
        configureSameChainQuoteToken()
        const original = pancakeExecutableQuote()
        const refreshed = pancakeExecutableQuote({
            transaction: {
                ...original.selectedQuote.transaction,
                data: '0xabcd',
            },
        })
        mocks.fetchSwapQuote
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(refreshed)
        mocks.publicClient.estimateGas
            .mockRejectedValueOnce({
                data: encodeErrorResult({
                    abi: simulationErrorAbi,
                    errorName: 'AllowanceExpired',
                    args: [0n],
                }),
            })
            .mockResolvedValueOnce(100_000n)
        mocks.sendTransaction.mockResolvedValue(`0x${'33'.repeat(32)}`)

        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        fireEvent.change(view.getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })
        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(view.getByRole('button', { name: 'Review swap' }))
        fireEvent.click(view.getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalledTimes(1))
        expect(mocks.invalidatePermit2Readiness).toHaveBeenCalledTimes(1)
        expect(mocks.prepareSwapApproval).toHaveBeenCalledTimes(2)
        expect(mocks.prepareSwapApproval.mock.calls[1][0]?.selectedQuote?.approval?.mode)
            .toBe('permit2-allowance')
        expect(mocks.fetchSwapQuote).toHaveBeenLastCalledWith(expect.objectContaining({
            forceRefresh: true,
        }))
        expect(mocks.publicClient.estimateGas).toHaveBeenCalledTimes(2)
        expect(mocks.publicClient.estimateGas.mock.calls[1][0]).toEqual(
            expect.objectContaining({ data: '0xabcd' }),
        )
    })

    it('maps TransactionDeadlinePassed and prevents submission', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        mocks.publicClient.estimateGas.mockRejectedValue({
            data: encodeErrorResult({
                abi: simulationErrorAbi,
                errorName: 'TransactionDeadlinePassed',
            }),
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(getByRole('status').textContent).toContain(
            'The quote expired. Request a fresh quote.',
        ))
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('falls back to call for revert data and does not log full calldata', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        configureSameChainQuoteToken()
        const fullCalldata = `0x${'ab'.repeat(160)}`
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote({
            transaction: {
                to: ROUTER_ADDRESS,
                data: fullCalldata,
                value: '0',
                gas: '100000',
            },
        }))
        mocks.publicClient.estimateGas.mockRejectedValue(new Error('estimate failed'))
        mocks.publicClient.call.mockRejectedValue({
            cause: {
                data: encodeErrorResult({
                    abi: simulationErrorAbi,
                    errorName: 'InsufficientAllowance',
                    args: [100n],
                }),
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(getByRole('status').textContent).toContain(
            'The route does not have enough Permit2 allowance.',
        ))
        expect(mocks.publicClient.call).toHaveBeenCalledWith(expect.objectContaining({
            account: ADDRESS,
            to: ROUTER_ADDRESS,
            data: fullCalldata,
            value: 0n,
        }))
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(fullCalldata)
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
        errorSpy.mockRestore()
    })

    it('opens same-chain review immediately without approval or submission', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote({
            allowanceTarget: '0x00000000000000000000000000000000000000bb',
        }))
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))

        const dialog = getByRole('dialog')
        dialog.getBoundingClientRect = () => ({
            x: 100,
            y: 100,
            top: 100,
            left: 100,
            right: 560,
            bottom: 520,
            width: 460,
            height: 420,
            toJSON: () => ({}),
        })
        expect(dialog).toBeTruthy()
        expect(getByRole('heading', { name: 'Review swap' })).toBeTruthy()
        expect(dialog.contains(getByRole('button', { name: 'Close review' }))).toBe(true)
        expect(dialog.contains(getByRole('button', { name: 'Confirm swap' }))).toBe(true)
        expect(dialog.querySelectorAll('.swap-review-detail-row')).toHaveLength(4)
        expect(container.querySelector('.swap-root').contains(dialog)).toBe(false)
        expect(mocks.prepareSwapApproval).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
        await waitFor(() => expect(debugSpy).toHaveBeenCalledWith(
                '[pistachio-swap]',
                expect.objectContaining({
                    event: 'review.opened',
                    flow: 'same-chain',
                    contentMounted: true,
                }),
            ))
        expect(debugSpy).toHaveBeenCalledWith(
            '[pistachio-swap]',
            expect.objectContaining({
                event: 'quote.applied',
                flow: 'same-chain',
            }),
        )
        expect(errorSpy.mock.calls.some(([, diagnostic]) =>
            diagnostic?.event === 'review.dialog.visibility-failed')).toBe(false)
        debugSpy.mockRestore()
        errorSpy.mockRestore()
    })

    it('applies interactive open-state styles without stale content opacity', async () => {
        const style = document.createElement('style')
        style.textContent = appStyles
        document.head.append(style)
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        fireEvent.change(view.getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(view.getByRole('button', { name: 'Review swap' }))

        const dialog = view.getByRole('dialog')
        const overlay = document.querySelector('.swap-review-overlay')
        const surface = dialog.querySelector('.swap-review-surface')
        await waitFor(() => expect(surface.style.opacity).toBe('1'))
        expect(getComputedStyle(dialog).opacity).toBe('1')
        expect(getComputedStyle(dialog).pointerEvents).toBe('auto')
        // JSDOM returns `auto` for both z-index values. The portal layer
        // contract is instead represented by the stable overlay/dialog classes.
        expect(overlay.classList.contains('swap-review-overlay')).toBe(true)
        expect(dialog.classList.contains('swap-review-dialog')).toBe(true)
        expect(dialog.dataset.state).toBe('open')
        expect(dialog.style.opacity).toBe('')
        expect(document.querySelectorAll('.swap-review-dialog')).toHaveLength(1)

        // CSS selector evaluation for detached synthetic Radix nodes is not a
        // reliable JSDOM signal. The open state above exercises the real portal.
        style.remove()
    })

    it('keeps review open across unrelated wallet and token-data rerenders', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        fireEvent.change(view.getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })
        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(view.getByRole('button', { name: 'Review swap' }))

        mocks.marketTokens = mocks.marketTokens.map((token) => ({ ...token }))
        mocks.useWalletTokens.mockReturnValue({
            tokens: [],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })
        view.rerender(<App />)

        expect(view.getByRole('dialog')).toBeTruthy()
        expect(view.getByRole('button', { name: 'Confirm swap' })).toBeTruthy()
    })

    it('closes review when the quoted amount identity changes', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        const amountInput = view.getByRole('textbox', { name: 'Sell amount' })
        fireEvent.change(amountInput, { target: { value: '0.001' } })
        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(view.getByRole('button', { name: 'Review swap' }))

        fireEvent.change(amountInput, { target: { value: '0.002' } })

        await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    })

    it('moves focus into review and restores it after Escape', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        fireEvent.change(view.getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })
        const reviewButton = await waitFor(() => view.getByRole('button', { name: 'Review swap' }))
        reviewButton.focus()
        fireEvent.click(reviewButton)

        const dialog = view.getByRole('dialog')
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
        fireEvent.keyDown(document, { key: 'Escape' })

        await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(reviewButton))
    })

    it('closes review from the overlay without creating a duplicate dialog', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        fireEvent.change(view.getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })
        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(view.getByRole('button', { name: 'Review swap' }))
        fireEvent.click(view.container.querySelector('.primary-action'))
        expect(view.queryAllByRole('dialog')).toHaveLength(1)

        fireEvent.pointerDown(document.querySelector('.swap-review-overlay'))
        fireEvent.click(document.querySelector('.swap-review-overlay'))
        await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    })

    it('reports a mounted but invisible review dialog', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        fireEvent.change(view.getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })
        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(view.getByRole('button', { name: 'Review swap' }))

        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith(
            '[pistachio-swap]',
            expect.objectContaining({
                event: 'review.dialog.visibility-failed',
                contentMounted: true,
                failedProperties: expect.arrayContaining(['width', 'height']),
            }),
        ))
        errorSpy.mockRestore()
    })

    it('isolates quote info tooltips from the settings trigger', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        const view = render(<App />)
        selectQtknToBnb(view.container, view.getAllByText)
        const sellInput = view.getByRole('textbox', { name: 'Sell amount' })
        fireEvent.change(sellInput, { target: { value: '0.001' } })
        await waitFor(() => expect(view.getByRole('button', { name: 'Review swap' })).toBeTruthy())

        const tooltipCases = [
            ['Explain fee', 'Provider and PistachioSwap fees included in this quote.'],
            ['Explain network cost', 'Estimated source-network transaction cost.'],
            ['Explain max slippage', 'Maximum allowed price movement before the transaction is cancelled.'],
            ['Explain route', 'Provider selected for the best executable outcome.'],
        ]
        for (const [name, text] of tooltipCases) {
            const trigger = view.getByRole('button', { name })
            fireEvent.click(trigger)
            expect(view.queryByRole('dialog')).toBeNull()
            fireEvent.focus(trigger)
            await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain(text))
            fireEvent.blur(trigger)
            fireEvent.pointerMove(trigger)
            fireEvent.mouseEnter(trigger)
            await waitFor(() => expect(view.getByRole('tooltip').textContent).toContain(text))
            fireEvent.pointerLeave(trigger)
            fireEvent.mouseLeave(trigger)
        }

        expect(sellInput.value).toBe('0.001')
        expect(mocks.prepareSwapApproval).not.toHaveBeenCalled()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
        expect(errorSpy.mock.calls.some(([message]) =>
            String(message).includes('cannot be a descendant of'))).toBe(false)

        fireEvent.click(view.getByRole('button', { name: 'Swap settings' }))
        expect(view.getByRole('dialog')).toBeTruthy()
        errorSpy.mockRestore()
    })

    it('opens same-chain review when Pancake Permit2 allowance is expired', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote({
            provider: 'pancakeswap',
            allowanceTarget: '0x000000000022d473030f116ddee9f6b43ac78ba3',
            approval: {
                mode: 'permit2-allowance',
                token: QTKN_ADDRESS,
                spender: '0x00000000000000000000000000000000000000aa',
                contract: '0x000000000022d473030f116ddee9f6b43ac78ba3',
                requiredAmount: '1000000000000000',
            },
        }))
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))

        expect(getByRole('heading', { name: 'Review swap' })).toBeTruthy()
        expect(mocks.prepareSwapApproval).not.toHaveBeenCalled()
        expect(debugSpy).toHaveBeenCalledWith(
            '[pistachio-swap]',
            expect.objectContaining({
                event: 'approval.metadata.active-quote',
                mode: 'permit2-allowance',
                provider: 'pancakeswap',
                transactionTarget: '0x00000000000000000000000000000000000000aa',
            }),
        )
        debugSpy.mockRestore()
    })

    it('fails closed before review when Pancake Permit2 metadata is missing', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote({
            provider: 'pancakeswap',
            allowanceTarget: PERMIT2_ADDRESS,
            approval: null,
        }))
        const { container, getAllByText } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(container.querySelector('.sell-amount-input'), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(container.querySelector('.primary-action').textContent).toBe(
            'PancakeSwap approval information is incomplete. Refresh the quote.',
        ))
        expect(container.textContent).not.toContain('Confirm swap')
        expect(mocks.prepareSwapApproval).not.toHaveBeenCalled()
    })

    it('confirmation requests approval before simulation and submission', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        mocks.sendTransaction.mockResolvedValue('0xabc')
        const { container, getAllByText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(mocks.prepareSwapApproval).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(mocks.publicClient.call).toHaveBeenCalled())
        await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalledTimes(1))
    })

    it('keeps same-chain review open when approval fails', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        mocks.prepareSwapApproval.mockRejectedValue(new Error('The approval transaction failed.'))
        const { container, getAllByText, getAllByText: getAllMatchingText, getByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))

        await waitFor(() => expect(getAllMatchingText('The approval transaction failed.').length)
            .toBeGreaterThan(0))
        expect(getByRole('heading', { name: 'Review swap' })).toBeTruthy()
        expect(mocks.sendTransaction).not.toHaveBeenCalled()
    })

    it('does not show Review swap when the executable quote is malformed', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote({
            transaction: {
                to: '0x00000000000000000000000000000000000000aa',
                data: '0x',
                value: '0',
            },
        }))
        const { container, getAllByText, getByRole, getAllByText: getAllMatchingText } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(container.querySelector('.primary-action').textContent)
            .toBe('The quote does not contain valid transaction data.'))
        fireEvent.click(container.querySelector('.primary-action'))
        expect(getAllMatchingText('The quote does not contain valid transaction data.').length)
            .toBeGreaterThan(0)
        expect(container.textContent).not.toContain('Confirm swap')
    })

    it('prevents rapid review and confirm clicks from duplicating wallet operations', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue(sameChainExecutableQuote())
        let resolveApproval
        mocks.prepareSwapApproval.mockReturnValue(new Promise((resolve) => {
            resolveApproval = resolve
        }))
        const { container, getAllByText, getByRole, queryAllByRole } = render(<App />)
        selectQtknToBnb(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))
        fireEvent.click(container.querySelector('.primary-action'))
        expect(queryAllByRole('heading', { name: 'Review swap' })).toHaveLength(1)
        fireEvent.click(getByRole('button', { name: 'Confirm swap' }))
        fireEvent.click(getByRole('button', { name: 'Checking token approval...' }))
        expect(mocks.prepareSwapApproval).toHaveBeenCalledTimes(1)
        await act(async () => {
            resolveApproval(false)
        })
    })

    it('queries providers for a small USD input instead of locally rejecting it', async () => {
        configureSameChainQuoteToken({
            marketPriceUSD: '1',
        })
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                chainId: 56,
                sellToken: '0x0000000000000000000000000000000000000056',
                buyToken: '0x0000000000000000000000000000000000000000',
                buyAmount: '800000000000000000',
                minimumBuyAmount: '790000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
                transaction: {
                    to: '0x00000000000000000000000000000000000000aa',
                    data: '0x1234',
                    value: '800000000000000000',
                    gas: '100000',
                },
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        fireEvent.click(getAllByText('QTKN')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getAllByText('BNB')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.click(getByRole('button', { name: 'Show Sell amount in USD' }))
        fireEvent.change(getByRole('textbox', { name: 'Sell USD amount' }), {
            target: { value: '0.80' },
        })

        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalled())
        expect(mocks.fetchSwapQuote.mock.calls.at(-1)[0].request.sellAmount)
            .toMatch(/^\d+$/)
        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
    })

    it('lets a valid small route reach review', async () => {
        configureSameChainQuoteToken({
            marketPriceUSD: '1',
        })
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                chainId: 56,
                sellToken: '0x0000000000000000000000000000000000000056',
                buyToken: '0x0000000000000000000000000000000000000000',
                buyAmount: '800000000000000000',
                minimumBuyAmount: '790000000000000000',
                estimatedGasUsd: '10',
                expiresAt: '2999-01-01T00:00:00.000Z',
                transaction: {
                    to: '0x00000000000000000000000000000000000000aa',
                    data: '0x1234',
                    value: '800000000000000000',
                    gas: '100000',
                },
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))
        fireEvent.click(getAllByText('QTKN')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.click(container.querySelector('.buy-token-position button'))
        fireEvent.click(getAllByText('BNB')
            .map((node) => node.closest('.ps-token-row'))
            .find(Boolean))
        fireEvent.click(getByRole('button', { name: 'Show Sell amount in USD' }))
        fireEvent.change(getByRole('textbox', { name: 'Sell USD amount' }), {
            target: { value: '0.80' },
        })

        await waitFor(() => expect(getByRole('button', { name: 'Review swap' })).toBeTruthy())
        fireEvent.click(getByRole('button', { name: 'Review swap' }))

        await waitFor(() => expect(getByRole('button', { name: 'Confirm swap' })).toBeTruthy())
    })

    it('shows the all-provider minimum rejection only from quote diagnostics', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockRejectedValue(new Error(
            'This amount is too small for the available providers.',
        ))
        const { container, getAllByText, getByRole, getByText } = render(<App />)
        selectBuyToken(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByText(
            'This amount is too small for the available providers.',
        )).toBeTruthy())
    })

    it('shows the generic no-route message for mixed provider failures', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockRejectedValue(new Error(
            'No executable route was found for this amount.',
        ))
        const { container, getAllByText, getByRole, getByText } = render(<App />)
        selectBuyToken(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '0.001' },
        })

        await waitFor(() => expect(getByText(
            'No executable route was found for this amount.',
        )).toBeTruthy())
    })

    it('does not requote when an exact-input response updates the Buy amount or recommends slippage', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue({
            recommendedSlippageBps: 125,
            selectedQuote: {
                buyAmount: '2000000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectBuyToken(container, getAllByText)

        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '1' },
        })

        await waitFor(() => expect(getByRole('textbox', { name: 'Buy amount' }).value)
            .toBe('2'))
        expect(container.querySelector('.buy-fiat-value').textContent).toBe('$6.00')
        await new Promise((resolve) => window.setTimeout(resolve, 450))
        expect(mocks.fetchSwapQuote).toHaveBeenCalledTimes(1)
        expect(mocks.fetchSwapQuote.mock.calls[0][0].request).toEqual(
            expect.objectContaining({
                mode: 'EXACT_INPUT',
                sellAmount: '1000000000000000000',
                buyAmount: null,
                slippageBps: 50,
            }),
        )
    })

    it('does not requote when an exact-output response updates the Sell amount', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote.mockResolvedValue({
            selectedQuote: {
                sellAmount: '1000000000000000000',
                expiresAt: '2999-01-01T00:00:00.000Z',
            },
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectBuyToken(container, getAllByText)

        fireEvent.change(getByRole('textbox', { name: 'Buy amount' }), {
            target: { value: '2' },
        })

        await waitFor(() => expect(getByRole('textbox', { name: 'Sell amount' }).value)
            .toBe('1'))
        await new Promise((resolve) => window.setTimeout(resolve, 450))
        expect(mocks.fetchSwapQuote).toHaveBeenCalledTimes(1)
        expect(mocks.fetchSwapQuote.mock.calls[0][0].request).toEqual(
            expect.objectContaining({
                mode: 'EXACT_OUTPUT',
                sellAmount: '0',
                buyAmount: '2000000000000000000',
            }),
        )
    })

    it('aborts obsolete same-chain requests and ignores their stale responses', async () => {
        configureSameChainQuoteToken()
        let resolveFirst
        mocks.fetchSwapQuote.mockImplementation(({ request }) => {
            if (request.sellAmount === '1000000000000000000') {
                return new Promise((resolve) => {
                    resolveFirst = resolve
                })
            }
            return Promise.resolve({
                selectedQuote: {
                    buyAmount: '4000000000000000000',
                    expiresAt: '2999-01-01T00:00:00.000Z',
                },
            })
        })
        const { container, getAllByText, getByRole } = render(<App />)
        selectBuyToken(container, getAllByText)
        const sellInput = getByRole('textbox', { name: 'Sell amount' })

        fireEvent.change(sellInput, { target: { value: '1' } })
        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalledTimes(1))
        const firstSignal = mocks.fetchSwapQuote.mock.calls[0][0].signal
        fireEvent.change(sellInput, { target: { value: '2' } })
        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalledTimes(2))
        expect(firstSignal.aborted).toBe(true)
        await waitFor(() => expect(getByRole('textbox', { name: 'Buy amount' }).value)
            .toBe('4'))

        await act(async () => {
            resolveFirst({
                selectedQuote: {
                    buyAmount: '9000000000000000000',
                    expiresAt: '2999-01-01T00:00:00.000Z',
                },
            })
        })
        expect(getByRole('textbox', { name: 'Buy amount' }).value).toBe('4')
        expect(mocks.fetchSwapQuote).toHaveBeenCalledTimes(2)
    })

    it('keeps the last successful amount visible when a settings refresh fails', async () => {
        configureSameChainQuoteToken()
        mocks.fetchSwapQuote
            .mockResolvedValueOnce({
                selectedQuote: {
                    buyAmount: '2000000000000000000',
                    expiresAt: '2999-01-01T00:00:00.000Z',
                },
            })
            .mockRejectedValueOnce(new Error('refresh unavailable'))
        const { container, getAllByText, getByRole, getByText } = render(<App />)
        selectBuyToken(container, getAllByText)
        fireEvent.change(getByRole('textbox', { name: 'Sell amount' }), {
            target: { value: '1' },
        })
        const buyInput = getByRole('textbox', { name: 'Buy amount' })
        await waitFor(() => expect(buyInput.value).toBe('2'))

        fireEvent.click(getByRole('button', { name: 'Swap settings' }))
        const customSlippage = getByRole('textbox', {
            name: 'Custom slippage percentage',
        })
        fireEvent.pointerDown(customSlippage)
        fireEvent.change(customSlippage, { target: { value: '1' } })

        await waitFor(() => expect(mocks.fetchSwapQuote).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(getByText(
            'Price refresh failed. Showing the previous quote.',
        )).toBeTruthy())
        expect(buyInput.value).toBe('2')
        expect(container.querySelector('.primary-action').textContent)
            .not.toBe('Finding the best price')
    })

    it('keeps wallet-only spam out of the 24H volume catalog', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.marketTokens = [{
            chainId: 56,
            address: '0x0000000000000000000000000000000000000011',
            name: 'Catalog token',
            symbol: 'CAT',
            decimals: 18,
            volume24hUsd: 1_000_000,
            verificationStatus: 'established',
            visibility: 'primary',
        }]
        mocks.useWalletTokens.mockReturnValue({
            tokens: [{
                classificationVersion: 4,
                chainId: 56,
                address: '0x0000000000000000000000000000000000000099',
                name: 'claim-reward.example.com',
                symbol: 'BONUS',
                decimals: 18,
                rawBalance: '1000000000000000000',
                balance: '1',
                priceConfidence: 'unknown',
                recognitionStatus: 'unverified',
                recognitionReasons: [],
                spamStatus: 'possible-spam',
                possibleSpam: true,
                verifiedContract: false,
                spamReasons: ['moralis-possible-spam'],
                securityStatus: 'unknown',
                visibility: 'hidden',
            }],
            error: null,
            refetch: mocks.refetchWalletTokens,
        })

        const { container } = render(<App />)
        fireEvent.click(container.querySelector('.sell-token-position button'))

        const volumeSection = [...document.querySelectorAll('.ps-token-section')]
            .find((section) =>
                section.textContent.includes('Tokens by 24H volume'),
            )

        expect(volumeSection.textContent).toContain('Catalog token')
        expect(volumeSection.textContent).not.toContain('claim-reward.example.com')
        expect(volumeSection.textContent).not.toContain('BONUS')
    })
})
