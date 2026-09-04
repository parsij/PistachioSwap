// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'

const mocks = vi.hoisted(() => ({
    send: vi.fn(),
    write: vi.fn(),
    switchNetwork: vi.fn(),
    runtimeChainId: 56,
    publicClient: {
        getGasPrice: vi.fn().mockResolvedValue(3_000_000_000n),
        estimateGas: vi.fn().mockResolvedValue(21_000n),
        estimateContractGas: vi.fn().mockResolvedValue(60_000n),
        simulateContract: vi.fn(async (request) => ({ request })),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    },
}))

vi.mock('#wallet-runtime', () => ({
    useAppKitNetwork: () => ({
        chainId: mocks.runtimeChainId,
        switchNetwork: mocks.switchNetwork,
    }),
    usePublicClient: () => mocks.publicClient,
    useSendTransaction: () => ({ mutateAsync: mocks.send }),
    useWriteContract: () => ({ mutateAsync: mocks.write }),
}))

import SendAssetDialog from './SendAssetDialog.jsx'

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
    return render(<SendAssetDialog
        open
        onOpenChange={vi.fn()}
        address={account}
        chainId={56}
        assets={[native]}
        settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
        nativeBalanceWei={parseEther('1')}
        explorerUrl="https://bscscan.com"
        onConfirmed={vi.fn()}
        {...overrides}
    />)
}

describe('SendAssetDialog', () => {
    beforeEach(() => {
        window.localStorage.clear()
        mocks.runtimeChainId = 56
        mocks.switchNetwork.mockResolvedValue(undefined)
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
        mocks.send.mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        renderDialog({ onConfirmed })
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.1' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))
        await screen.findByRole('heading', { name: 'Review send' })
        expect(mocks.send).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
        expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
            to: recipient,
            value: parseEther('0.1'),
        }))
    })

    it('reports wallet rejection as rejected rather than generic failure', async () => {
        mocks.send.mockRejectedValue({ code: 4001 })
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
        mocks.send.mockResolvedValue('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
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
        expect(screen.getByText('Polygon')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))

        await waitFor(() => expect(mocks.switchNetwork).toHaveBeenCalledOnce())
        expect(mocks.switchNetwork).toHaveBeenCalledWith(expect.objectContaining({ id: 137 }))
        await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137 })))
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
        expect(mocks.send).not.toHaveBeenCalled()
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
