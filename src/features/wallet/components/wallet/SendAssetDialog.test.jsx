// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'

const mocks = vi.hoisted(() => ({
    send: vi.fn(),
    write: vi.fn(),
    publicClient: {
        getGasPrice: vi.fn().mockResolvedValue(3_000_000_000n),
        estimateGas: vi.fn().mockResolvedValue(21_000n),
        estimateContractGas: vi.fn().mockResolvedValue(60_000n),
        simulateContract: vi.fn(async (request) => ({ request })),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    },
}))

vi.mock('wagmi', () => ({
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
    beforeEach(() => window.localStorage.clear())
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

    it('requires an extra acknowledgement before reviewing a blocked token', () => {
        const confirmation = vi.spyOn(window, 'confirm')
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false)
        renderDialog({ assets: [native, blocked] })
        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))
        expect(screen.queryByRole('button', { name: 'Show all wallet assets' })).toBeNull()
        fireEvent.change(screen.getByLabelText('Search wallet assets'), {
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

    it('uses the setting to reveal all three collections without a balance refetch', () => {
        renderDialog({
            assets: [native, unverified, blocked],
            settings: { hideUnknownTokens: false, hideSmallBalances: false },
        })
        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))

        expect(screen.getByText('BNB', { selector: 'strong' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Unverified tokens (1)' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Hidden risky tokens (1)' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Show all wallet assets' })
            .getAttribute('aria-pressed')).toBe('false')
    })
})
