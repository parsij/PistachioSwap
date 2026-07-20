// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReceiveDialog from './ReceiveDialog.jsx'

const address = '0x00000000000000000000000000000000000000aB'

describe('ReceiveDialog', () => {
    beforeEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        })
    })
    afterEach(cleanup)

    it('renders the exact connected address in the field and QR title', async () => {
        render(<ReceiveDialog open onOpenChange={vi.fn()} address={address} />)
        expect(screen.getByText(address).textContent).toBe(address)
        expect(screen.getByTitle(`Receive at ${address}`)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(address)
    })
})
