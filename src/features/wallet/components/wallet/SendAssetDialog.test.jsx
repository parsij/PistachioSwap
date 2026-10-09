// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'

const mocks = vi.hoisted(() => ({
    resolveSendWallet: vi.fn(),
    submitSendPlan: vi.fn(),
    connector: { id: 'pistachio-local' },
    publicClient: {
        getGasPrice: vi.fn().mockResolvedValue(3_000_000_000n),
        estimateGas: vi.fn().mockResolvedValue(21_000n),
        estimateContractGas: vi.fn().mockResolvedValue(60_000n),
        simulateContract: vi.fn(async (request) => ({ request })),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    },
}))

vi.mock('#wallet-runtime', () => ({
    useConnection: () => ({ connector: mocks.connector }),
    usePublicClient: () => mocks.publicClient,
}))

vi.mock('../../services/sendExecution.js', () => ({
    resolveSendWallet: (...args) => mocks.resolveSendWallet(...args),
    submitSendPlan: (...args) => mocks.submitSendPlan(...args),
}))

import SendAssetDialog from './SendAssetDialog.jsx'
import { subscribeWalletBalanceRefresh } from '../../services/walletBalanceRefresh.js'

const account = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const native = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    isNative: true,
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
    rawBalance: parseEther('1').toString(),
    balance: '1',
    priceUSD: '600',
    valueUSD: '600',
    recognitionStatus: 'established',
    recognitionReasons: ['native-token'],
    possibleSpam: false,
    securityStatus: 'trusted',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
    logoURI: '/icons/bnb.svg',
}
const polygonNative = {
    ...native,
    chainId: 137,
    name: 'Polygon',
    symbol: 'POL',
    rawBalance: parseEther('2').toString(),
    balance: '2',
    priceUSD: '1',
    valueUSD: '2',
    logoURI: '/icons/polygon.svg',
}
const baseEth = {
    ...native,
    chainId: 8453,
    name: 'Ether',
    symbol: 'ETH',
    rawBalance: parseEther('0.01').toString(),
    balance: '0.01',
    priceUSD: '1',
    trustedPriceUSD: '1',
    valueUSD: '0.01',
    logoURI: '/networkIcons/base.webp',
}
const baseUsdc = {
    ...native,
    chainId: 8453,
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    isNative: false,
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    rawBalance: '291426',
    balance: '0.291426',
    formattedBalance: '0.291426',
    priceUSD: '1',
    trustedPriceUSD: '1',
    valueUSD: '0.291426',
    verifiedContract: true,
    recognitionReasons: ['coingecko-exact-contract'],
    logoURI: '/icons/usdc.svg',
}
const blocked = {
    ...native,
    address: '0x0000000000000000000000000000000000000099',
    isNative: false,
    name: 'Unknown token',
    symbol: 'UNKNOWN',
    securityStatus: 'blocked',
    recognitionStatus: 'unverified',
    recognitionReasons: [],
    possibleSpam: false,
    verifiedContract: false,
    priceConfidence: 'untrusted',
    includeInPortfolioValue: false,
    visibility: 'hidden',
    securityReasons: ['honeypot-confirmed'],
    visibilityReasons: ['security-blocked'],
}
const unverified = {
    ...blocked,
    address: '0x0000000000000000000000000000000000000088',
    name: 'Unverified token',
    symbol: 'NEW',
    securityStatus: 'low',
    securityReasons: ['security-risk-low'],
    visibility: 'unverified',
    visibilityReasons: ['unverified-contract'],
}
const secantX = {
    ...blocked,
    address: '0x0000000000000000000000000000000000000eca',
    name: 'SecantX AI',
    symbol: 'SECA',
    securityStatus: 'low',
    securityReasons: ['security-risk-low'],
    recognitionStatus: 'unverified',
    recognitionReasons: ['moralis-verified-contract', 'market-catalog-only'],
    verifiedContract: true,
    possibleSpam: false,
    marketPriceUSD: '447463.12',
    visibilityReasons: ['moralis-verified-contract', 'market-catalog-only'],
}

function renderDialog(overrides = {}) {
    const props = {
        open: true,
        onOpenChange: vi.fn(),
        address: account,
        chainId: 56,
        assets: [native],
        settings: { hideUnknownTokens: true, hideSmallBalances: false },
        nativeBalanceWei: parseEther('1'),
        explorerUrl: 'https://bscscan.com',
        onConfirmed: vi.fn(),
        ...overrides,
    }
    const view = render(<SendAssetDialog {...props} />)
    return { ...view, setOpen: (open) => view.rerender(<SendAssetDialog {...props} open={open} />) }
}

describe('SendAssetDialog', () => {
    beforeEach(() => {
        window.localStorage.clear()
        mocks.connector = { id: 'pistachio-local' }
        mocks.resolveSendWallet.mockImplementation(async ({ connectedAddress, targetChain }) => ({
            account: connectedAddress,
            connectorId: mocks.connector.id,
            walletClient: {
                account: { address: connectedAddress },
                chain: targetChain,
            },
        }))
        mocks.submitSendPlan.mockResolvedValue(
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        )
    })
    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
        vi.restoreAllMocks()
        mocks.publicClient.getGasPrice.mockResolvedValue(3_000_000_000n)
        mocks.publicClient.estimateGas.mockResolvedValue(21_000n)
        mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    })

    it('reviews then sends a native value transaction only after explicit confirmation', async () => {
        const onConfirmed = vi.fn()
        renderDialog({ onConfirmed })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        expect(mocks.submitSendPlan).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        expect(mocks.submitSendPlan).toHaveBeenCalledWith(expect.objectContaining({
            targetChain: expect.objectContaining({ id: 56 }),
            plan: expect.objectContaining({
                kind: 'native',
                amountWei: parseEther('0.1'),
            }),
        }))
    })

    it('switches the clicked USD value into editable dollars and submits the converted native amount', async () => {
        const onConfirmed = vi.fn()
        renderDialog({ onConfirmed })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        const toggle = screen.getByRole('button', { name: 'Show send amount in USD' })
        expect(toggle.textContent).toBe('$60.00')
        fireEvent.click(toggle)
        const usdInput = screen.getByLabelText('Amount to send in USD')
        expect(usdInput.value).toBe('60')
        expect(document.activeElement).toBe(usdInput)
        fireEvent.change(usdInput, { target: { value: '30' } })
        expect(screen.getByRole('button', { name: 'Show send amount in BNB' }).textContent).toBe('0.05 BNB')
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in BNB' }))
        expect(screen.getByLabelText('Amount to send').value).toBe('0.05')
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        expect(screen.getByText('0.05 BNB')).toBeTruthy()
        expect(screen.getByText('$30.00')).toBeTruthy()
        expect(mocks.submitSendPlan).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        expect(mocks.submitSendPlan).toHaveBeenCalledWith(expect.objectContaining({
            plan: expect.objectContaining({ amountWei: parseEther('0.05'), request: expect.objectContaining({ value: parseEther('0.05') }) }),
        }))
    })

    it('rounds USD conversions down to ERC-20 decimals and sends on the selected network with an external wallet', async () => {
        mocks.connector = { id: 'injected' }
        const onConfirmed = vi.fn()
        const pricedUsdc = { ...baseUsdc, trustedPriceUSD: '0.93' }
        renderDialog({ assets: [pricedUsdc, baseEth], onConfirmed })
        fireEvent.click(document.querySelector('.send-token-button'))
        fireEvent.click(screen.getByText('USD Coin', { selector: 'strong' }).closest('button'))
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        fireEvent.change(screen.getByLabelText('Amount to send in USD'), { target: { value: '0.27' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        expect(screen.getByText('0.290322 USDC')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        expect(mocks.resolveSendWallet).toHaveBeenCalledWith(expect.objectContaining({
            targetChain: expect.objectContaining({ id: 8453 }), connector: expect.objectContaining({ id: 'injected' }),
        }))
        expect(mocks.submitSendPlan).toHaveBeenCalledWith(expect.objectContaining({
            plan: expect.objectContaining({ amountWei: 290322n, request: expect.objectContaining({ args: [recipient, 290322n] }) }),
        }))
    })

    it('keeps Max exact in USD mode and retains the native gas reserve', () => {
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        fireEvent.click(screen.getByRole('button', { name: 'Max' }))
        expect(screen.getByLabelText('Amount to send in USD').value).toBe('599.97')
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in BNB' }))
        expect(screen.getByLabelText('Amount to send').value).toBe('0.99995')
    })

    it('leaves token entry available when USD pricing is missing and blocks USD amounts beyond the balance', async () => {
        renderDialog({ assets: [{ ...native, priceUSD: null, trustedPriceUSD: null, marketPriceUSD: null }] })
        expect(screen.getByRole('button', { name: 'Show send amount in USD' }).disabled).toBe(true)
        expect(screen.getByLabelText('Amount to send')).toBeTruthy()
        cleanup()
        renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        fireEvent.change(screen.getByLabelText('Amount to send in USD'), { target: { value: '601' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Insufficient balance.')
        expect(mocks.submitSendPlan).not.toHaveBeenCalled()
        expect(mocks.publicClient.estimateGas).not.toHaveBeenCalled()
    })

    it('does not reinterpret dollars as tokens if pricing disappears, and clears USD mode when changing tokens or reopening', async () => {
        const props = { open: true, onOpenChange: vi.fn(), address: account, chainId: 56,
            assets: [native, polygonNative], settings: {}, nativeBalanceWei: parseEther('1') }
        const view = render(<SendAssetDialog {...props} />)
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        fireEvent.change(screen.getByLabelText('Amount to send in USD'), { target: { value: '30' } })
        view.rerender(<SendAssetDialog {...props} assets={[{ ...native, priceUSD: null, trustedPriceUSD: null }, polygonNative]} />)
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'USD input is unavailable for this token. Switch to token amount.')
        expect(mocks.publicClient.estimateGas).not.toHaveBeenCalled()
        fireEvent.click(document.querySelector('.send-token-button'))
        fireEvent.click(screen.getByText('Polygon', { selector: 'strong' }).closest('button'))
        expect(screen.getByLabelText('Amount to send').value).toBe('')
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        view.rerender(<SendAssetDialog {...props} open={false} />)
        view.rerender(<SendAssetDialog {...props} />)
        expect(screen.getByLabelText('Amount to send').value).toBe('')
    })

    it('clears USD entry if portfolio updates change the default asset', () => {
        const view = renderDialog()
        fireEvent.click(screen.getByRole('button', { name: 'Show send amount in USD' }))
        fireEvent.change(screen.getByLabelText('Amount to send in USD'), { target: { value: '30' } })
        view.rerender(<SendAssetDialog open onOpenChange={vi.fn()} address={account} chainId={56}
            assets={[polygonNative]} settings={{}} nativeBalanceWei={parseEther('1')} />)
        expect(screen.getByLabelText('Amount to send').value).toBe('')
        expect(screen.queryByLabelText('Amount to send in USD')).toBeNull()
    })

    it('requests fresh balances on opening Send and its token picker', () => {
        const refresh = vi.fn()
        const unsubscribe = subscribeWalletBalanceRefresh(refresh)
        try {
            renderDialog()
            expect(refresh).toHaveBeenCalledExactlyOnceWith(account)
            fireEvent.click(document.querySelector('.send-token-button'))
            expect(refresh).toHaveBeenCalledTimes(2)
        } finally { unsubscribe() }
    })

    it('uses refreshed ERC-20 holdings instead of the token picker snapshot, including a balance that becomes zero', async () => {
        const props = { open: true, onOpenChange: vi.fn(), address: account, chainId: 56,
            assets: [baseUsdc, baseEth], settings: {}, nativeBalanceWei: parseEther('1') }
        const view = render(<SendAssetDialog {...props} />)
        fireEvent.click(document.querySelector('.send-token-button'))
        fireEvent.click(screen.getByText('USD Coin', { selector: 'strong' }).closest('button'))
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.2' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        view.rerender(<SendAssetDialog {...props} assets={[{ ...baseUsdc, rawBalance: '100000', balance: '0.1' }, baseEth]} />)
        expect(screen.getByText(/Balance 0.1/)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Insufficient balance.')
        view.rerender(<SendAssetDialog {...props} assets={[baseEth]} />)
        expect(screen.getByText(/Balance 0$/)).toBeTruthy()
        expect(mocks.submitSendPlan).not.toHaveBeenCalled()
    })

    it('starts a fresh send after completing and reopening the dialog', async () => {
        const onConfirmed = vi.fn()
        const view = renderDialog({ onConfirmed })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        expect(screen.getByText('Sent')).toBeTruthy()
        view.setOpen(false)
        view.setOpen(true)
        expect(screen.queryByText('Sent')).toBeNull()
        expect(screen.queryByText(/View on/)).toBeNull()
        expect(screen.getByLabelText('Amount to send').value).toBe('')
        expect(screen.getByLabelText('Send to').value).toBe('')
        const nextRecipient = '0x0000000000000000000000000000000000000005'
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.2' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: nextRecipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(2))
        expect(mocks.submitSendPlan).toHaveBeenLastCalledWith(expect.objectContaining({
            plan: expect.objectContaining({ amountWei: parseEther('0.2'), request: expect.objectContaining({ to: nextRecipient }) }),
        }))
    })

    it('does not let an older pending transfer overwrite a reopened form', async () => {
        let resolveReceipt
        mocks.publicClient.waitForTransactionReceipt.mockReturnValueOnce(new Promise((resolve) => { resolveReceipt = resolve }))
        const onConfirmed = vi.fn()
        const view = renderDialog({ onConfirmed })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await screen.findByText('Waiting for confirmation')
        view.setOpen(false)
        view.setOpen(true)
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.2' } })
        resolveReceipt({ status: 'success' })
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        expect(screen.queryByText('Sent')).toBeNull()
        expect(screen.getByLabelText('Amount to send').value).toBe('0.2')
        expect(screen.getByLabelText('Send to').value).toBe('')
    })

    it('reports wallet rejection as rejected rather than generic failure', async () => {
        mocks.submitSendPlan.mockRejectedValue({ code: 4001 })
        renderDialog()
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        expect(await screen.findByText('Rejected')).toBeTruthy()
    })

    it('invalidates review when the connected account changes', async () => {
        const view = renderDialog()
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        view.rerender(<SendAssetDialog
            open
            onOpenChange={vi.fn()}
            address="0x0000000000000000000000000000000000000004"
            chainId={56}
            assets={[native]}
            settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
            nativeBalanceWei={parseEther('1')}
            explorerUrl="https://bscscan.com"
            onConfirmed={vi.fn()}
        />)
        expect(await screen.findByText(/connected account changed/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Review send' })).toBeTruthy()
    })

    it('uses the exact token selector across wallet chains and auto-switches on send', async () => {
        renderDialog({ assets: [native, polygonNative] })

        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))
        expect(screen.getByRole('dialog', { name: 'Select a token for send' })).toBeTruthy()
        expect(screen.getByText('Your tokens')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Token network' }).textContent).toContain('All Chains')
        expect(screen.queryByText('Show all wallet assets')).toBeNull()
        expect(screen.queryByText('Use portfolio filters')).toBeNull()
        expect(screen.queryByText("Token data couldn't be reached.")).toBeNull()

        const polygonRow = screen.getByText('Polygon', { selector: 'strong' }).closest('button')
        expect(polygonRow).toBeTruthy()
        fireEvent.click(polygonRow)
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.5' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

        await screen.findByRole('heading', { name: 'Review send' })
        expect(screen.getAllByText('Polygon').length).toBeGreaterThan(0)
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))

        await waitFor(() => expect(mocks.resolveSendWallet).toHaveBeenCalledWith(
            expect.objectContaining({
                targetChain: expect.objectContaining({ id: 137 }),
            }),
        ))
        await waitFor(() => expect(mocks.submitSendPlan).toHaveBeenCalledWith(
            expect.objectContaining({
                targetChain: expect.objectContaining({ id: 137 }),
                plan: expect.objectContaining({ kind: 'native' }),
            }),
        ))
    })

    it('uses the selected Base token chain for an ERC-20 send', async () => {
        const onConfirmed = vi.fn()
        renderDialog({
            assets: [baseUsdc, baseEth],
            onConfirmed,
        })

        // Select explicitly without depending on the default portfolio ranking.
        fireEvent.click(document.querySelector('.send-token-button'))
        fireEvent.click(screen.getByText('USD Coin', { selector: 'strong' }).closest('button'))
        expect(screen.getByRole('button', { name: /USDC/ })).toBeTruthy()
        fireEvent.change(screen.getByLabelText('Amount to send'), {
            target: { value: '0.291426' },
        })
        fireEvent.change(screen.getByLabelText('Send to'), {
            target: { value: recipient },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

        await screen.findByRole('heading', { name: 'Review send' })
        expect(screen.getAllByText('Base').length).toBeGreaterThan(0)
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))

        await waitFor(() => expect(mocks.resolveSendWallet).toHaveBeenCalledWith(
            expect.objectContaining({
                connectedAddress: account,
                targetChain: expect.objectContaining({ id: 8453 }),
                connector: expect.objectContaining({ id: 'pistachio-local' }),
            }),
        ))
        await waitFor(() => expect(mocks.submitSendPlan).toHaveBeenCalledWith(
            expect.objectContaining({
                targetChain: expect.objectContaining({ id: 8453 }),
                plan: expect.objectContaining({
                    kind: 'erc20',
                    amountWei: 291426n,
                    request: expect.objectContaining({
                        chainId: 8453,
                        address: baseUsdc.address,
                        functionName: 'transfer',
                        args: [recipient, 291426n],
                    }),
                }),
            }),
        ))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        const explorerLink = screen.getByRole('link', { name: /view on .*scan|view on explorer/i })
        expect(explorerLink.getAttribute('href')).toContain('/tx/')
        expect(explorerLink.getAttribute('href')).not.toContain('blockscan.com')
        expect(explorerLink.getAttribute('href')).toContain(
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        )
    })

    it('requires an extra acknowledgement before reviewing a blocked token', () => {
        const confirmation = vi.spyOn(window, 'confirm')
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false)
        renderDialog({ assets: [native, blocked] })
        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))
        expect(screen.queryByRole('button', { name: 'Show all wallet assets' })).toBeNull()
        fireEvent.change(screen.getByLabelText('Search tokens'), {
            target: { value: blocked.address },
        })
        fireEvent.click(screen.getByText('Unknown token').closest('button'))
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        expect(confirmation).toHaveBeenCalledTimes(2)
        expect(confirmation.mock.calls[0][0]).toContain('honeypot-confirmed')
        expect(screen.queryByRole('heading', { name: 'Review send' })).toBeNull()
        expect(mocks.submitSendPlan).not.toHaveBeenCalled()
    })

    it('keeps hidden assets separate when unknown-token hiding is disabled', () => {
        renderDialog({
            assets: [native, unverified, blocked],
            settings: { hideUnknownTokens: false, hideSmallBalances: false },
        })
        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))

        expect(screen.getByText('BNB', { selector: 'strong' })).toBeTruthy()
        expect(screen.queryByText('Unverified token')).toBeNull()
        expect(screen.queryByText('Unknown token')).toBeNull()

        fireEvent.change(screen.getByLabelText('Search tokens'), {
            target: { value: unverified.address },
        })
        expect(screen.getByText('This token is hidden from normal results. Review the exact contract and risk reason before selecting it.')).toBeTruthy()
        expect(screen.getByText('Unverified token', { selector: 'strong' })).toBeTruthy()
    })

    it('keeps verified scam tokens out of the normal Send selector', () => {
        renderDialog({ assets: [native, secantX] })
        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))

        expect(screen.getByText('BNB', { selector: 'strong' })).toBeTruthy()
        expect(screen.queryByText('SecantX AI')).toBeNull()
        expect(document.body.textContent).not.toContain('SECA')
        expect(document.body.textContent).not.toContain('$447,463.12')

        fireEvent.change(screen.getByLabelText('Search tokens'), {
            target: { value: secantX.address },
        })
        expect(screen.getByText('This token is hidden from normal results. Review the exact contract and risk reason before selecting it.')).toBeTruthy()
        expect(screen.getByText('SecantX AI')).toBeTruthy()
        expect(screen.getByText('Potential risk')).toBeTruthy()
        expect(document.body.textContent).not.toContain('$447,463.12')
    })
})


describe('Send network cost chooser', () => {
    afterEach(() => { cleanup(); vi.clearAllMocks() })
    function feeRpc() {
        Object.assign(mocks.publicClient, {
            chain: { id: 8453 },
            getChainId: vi.fn(async () => 8453),
            getBlock: vi.fn(async () => ({ number: 10n, baseFeePerGas: 1_000_000_000n })),
            estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n })),
            getBalance: vi.fn(async () => parseEther('0.01')),
            getTransactionCount: vi.fn(async () => 7),
        })
        mocks.publicClient.estimateGas.mockResolvedValue(60_000n)
        mocks.publicClient.simulateContract.mockImplementation(async request => ({ request }))
        mocks.resolveSendWallet.mockImplementation(async ({ connectedAddress, targetChain }) => ({
            account: connectedAddress, walletClient: { account: { address: connectedAddress }, chain: targetChain },
        }))
        mocks.submitSendPlan.mockResolvedValue(`0x${'ab'.repeat(32)}`)
    }
    it('reviews exact custom Base fees and nonce, then rechecks live balance before submission', async () => {
        feeRpc()
        renderDialog({ chainId: 56, assets: [{ ...baseUsdc, rawBalance: '10000000', balance: '10' }, baseEth] })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '5' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('switch', { name: 'Auto network cost' }))
        await waitFor(() => expect(screen.getByRole('button', { name: /Custom/ }).disabled).toBe(false))
        fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
        fireEvent.change(screen.getByLabelText('Max fee in Gwei'), { target: { value: '0.5' } })
        fireEvent.change(screen.getByLabelText('Priority fee in Gwei'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Transaction nonce'), { target: { value: '7' } })
        expect(screen.getByText(/Applies to this send/)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm network cost' }))
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        expect(screen.getByText('Maximum execution fee').nextSibling.textContent).toBe('0.000036 ETH')
        expect(screen.getByRole('button', { name: /Less/ }).textContent).toContain('≈')
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(mocks.submitSendPlan).toHaveBeenCalled())
        expect(mocks.submitSendPlan).toHaveBeenCalledWith(expect.objectContaining({
            targetChain: expect.objectContaining({ id: 8453 }),
            plan: expect.objectContaining({ request: expect.objectContaining({
                gas: 72_000n, maxFeePerGas: 500_000_000n, maxPriorityFeePerGas: 100_000_000n, nonce: 7,
            }) }),
        }))
        expect(mocks.publicClient.getBalance).toHaveBeenCalledTimes(2)
        expect(mocks.publicClient.simulateContract.mock.calls.at(-1)[0].maxFeePerGas).toBeUndefined()
    })
    it('blocks a send if native balance drops after review instead of silently dropping the chosen fees', async () => {
        feeRpc()
        renderDialog({ chainId: 8453, assets: [{ ...baseUsdc, rawBalance: '10000000', balance: '10' }, baseEth] })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '5' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('switch', { name: 'Auto network cost' }))
        await waitFor(() => expect(screen.getByRole('button', { name: /High/ }).disabled).toBe(false))
        fireEvent.click(screen.getByRole('button', { name: /High/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        mocks.publicClient.getBalance.mockResolvedValueOnce(0n)
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Insufficient native balance'))
        expect(mocks.submitSendPlan).not.toHaveBeenCalled()
    })
})
