// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('#wallet-runtime', () => ({ useWalletRuntimeStatus: () => ({ visible: false }) }))
import SwapPrimaryAction from './SwapPrimaryAction.jsx'
afterEach(cleanup)
it('preserves the specific disabled-network reason instead of hiding it as a quote failure', () => {
    render(<SwapPrimaryAction action={{ type: 'gas-assist-unavailable', label: 'Gas Assist is currently unavailable.', enabled: false }} reducedMotion triggerRef={{ current: null }} onAction={() => {}} />)
    const button = screen.getByRole('button', { name: 'Gas Assist is currently unavailable.' })
    expect(button.disabled).toBe(true)
    expect(screen.queryByText('No usable quote')).toBeNull()
})
