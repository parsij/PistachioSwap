// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    open: vi.fn(),
    status: { ready: false, loading: false, visible: false },
}))

vi.mock('#wallet-runtime', () => ({
    useAppKit: () => ({ open: mocks.open }),
    useWalletRuntimeStatus: () => mocks.status,
}))

import WalletAccountButton from './WalletAccountButton.jsx'

describe('wallet account button', () => {
    afterEach(() => {
        cleanup()
        mocks.open.mockReset()
        mocks.status.ready = false
        mocks.status.loading = false
        mocks.status.visible = false
    })

    it('shows a connecting bar while AppKit is loading', async () => {
        let resolveOpen
        mocks.open.mockImplementation(() => new Promise((resolve) => {
            resolveOpen = resolve
        }))

        render(<WalletAccountButton isConnected={false} address={undefined} />)
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

        const button = screen.getByRole('button', { name: 'Connecting' })
        expect(button.getAttribute('aria-busy')).toBe('true')
        expect(button.disabled).toBe(true)

        resolveOpen()
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'Connect' }).getAttribute('aria-busy')).toBeNull()
        })
    })
})
