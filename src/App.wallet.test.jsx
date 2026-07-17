// @vitest-environment jsdom

import React from 'react'
import {
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
    sendTransaction: vi.fn(),
    marketTokens: [],
    gasAssistConfig: { status: 'success', config: { enabled: false, mode: 'disabled' }, error: null, refetch: vi.fn() },
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
    useAccount: () => mocks.wagmiAccount,
    useBalance: (options) => {
        mocks.balanceOptions.push(options)
        return {
            data: mocks.account.isConnected || mocks.wagmiAccount.status === 'connected'
                ? { value: 5_349_631_675_469_080n }
                : undefined,
            refetch: mocks.refetchBalance,
        }
    },
    useChainId: () => mocks.network.chainId,
    useDisconnect: () => ({ mutate: vi.fn() }),
    useConnection: () => ({ connector: null }),
    usePublicClient: () => null,
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

vi.mock('./hooks/useMarketTokens.js', () => ({
    useMarketTokens: () => ({
        tokens: mocks.marketTokens,
        loading: false,
        error: null,
    }),
}))

vi.mock('./hooks/useWalletTokens.js', () => ({
    useWalletTokens: (options) =>
        mocks.useWalletTokens(options),
}))

vi.mock('./hooks/useGasAssistConfig.js', () => ({
    useGasAssistConfig: () => mocks.gasAssistConfig,
}))

vi.mock('./services/quotes.js', async (importOriginal) => ({
    ...await importOriginal(),
    fetchSwapQuote: mocks.fetchSwapQuote,
}))

import App from './App.jsx'

const ADDRESS =
    '0x0000000000000000000000000000000000000001'

describe('App wallet integration', () => {
    beforeEach(() => {
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
        mocks.sendTransaction.mockReset()
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

    it('rejects mixed-chain Swap pairs and directs the user to Bridge', () => {
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
        expect(action.textContent).toBe('Use Bridge for cross-chain swaps')
        fireEvent.click(action)
        expect(getByRole('button', { name: 'Bridge' }).className).toContain('active')
    })

    it('quotes and broadcasts a non-BSC pair only on its token chain', async () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        mocks.network.chainId = 56
        mocks.marketTokens = [
            {
                chainId: 8453,
                address: '0x0000000000000000000000000000000000008453',
                name: 'Base token A',
                symbol: 'BASEA',
                decimals: 18,
                volume24hUsd: 2_000,
                verificationStatus: 'established',
                visibility: 'primary',
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
        expect(mocks.fetchSwapQuote.mock.calls.at(-1)[0].request.chainId)
            .toBe(8453)
        await waitFor(() =>
            expect(container.querySelector('.primary-action').textContent)
                .toBe('Swap'),
        )
        fireEvent.click(container.querySelector('.primary-action'))
        await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalled())
        expect(mocks.sendTransaction.mock.calls.at(-1)[0].chainId).toBe(8453)
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
                classificationVersion: 3,
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

    it('clicking native balance and percentages use the spendable amount', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        const { container, getByRole } = render(<App />)
        const amountInput = getByRole('textbox', { name: 'Sell amount' })

        fireEvent.click(getByRole('button', { name: 'Use maximum BNB balance' }))
        expect(amountInput.value).toBe('0.00434963167546908')

        fireEvent.pointerEnter(container.querySelector('.sell-panel'))
        fireEvent.click(getByRole('button', { name: '50%' }))
        expect(amountInput.value).toBe('0.00217481583773454')
    })

    it('clicking an ERC-20 sell balance fills the complete exact amount', () => {
        mocks.account.address = ADDRESS
        mocks.account.isConnected = true
        const usdc = {
            classificationVersion: 3,
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
                classificationVersion: 3,
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
