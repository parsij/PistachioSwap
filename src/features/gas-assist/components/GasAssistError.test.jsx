// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import GasAssistError from './GasAssistError.jsx'
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
it('shows a safe error reference in production without exposing raw provider details', () => {
    vi.stubEnv('DEV', false)
    render(<GasAssistError error={{ code: 'PAYMASTER_RPC_REJECTED', message: 'private RPC response', details: { secret: 'private detail' } }} />)
    expect(screen.getByText('The network RPC or Bundler rejected this swap. Refresh the quote and try again.')).toBeTruthy()
    expect(screen.getByText('Error reference: PAYMASTER_RPC_REJECTED')).toBeTruthy()
    expect(screen.queryByText(/private RPC response|private detail/)).toBeNull()
})
it('explains sponsor funding failures', () => {
    render(<GasAssistError error={{ code: 'PAYMASTER_DEPOSIT_INSUFFICIENT' }} />)
    expect(screen.getByText('The sponsor needs more native gas funding. Try again after it is refilled.')).toBeTruthy()
})
