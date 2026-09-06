from pathlib import Path

path = Path('src/features/passkey/components/wallet/UnlockedWalletScreen.recovery.test.jsx')
text = path.read_text()
old = """    it('requires another passkey and explicit confirmation before removing access', async () => {
        const user = userEvent.setup()
        const initial = snapshot()
        const view = render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={initial} />)
        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))
        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(true)

        const multiple = { ...initial, recoveryBackupConfirmed: false, vault: { ...initial.vault, keyWraps: [...initial.vault.keyWraps, { ...initial.vault.keyWraps[0], id: 'wrap-2', label: 'Backup passkey' }] } }
        view.rerender(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={multiple} />)

        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(false)
        expect(screen.getByText('Another passkey will remain after removal. Keep an offline recovery backup too.')).toBeTruthy()
        await user.click(screen.getByRole('button', { name: 'Remove Primary passkey' }))
        expect(mocks.removePasskey).not.toHaveBeenCalled()
        const confirmation = screen.getByRole('group', { name: 'Confirm removal of Primary passkey' })
        await user.click(within(confirmation).getByRole('button', { name: 'Remove passkey' }))
        expect(mocks.removePasskey).toHaveBeenCalledWith('wrap-1')
    })
"""
new = """    it('requires another passkey and explicit confirmation before removing access', async () => {
        const user = userEvent.setup()
        const initial = snapshot()
        const singleView = render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={initial} />)
        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))
        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(true)
        singleView.unmount()

        const multiple = {
            ...initial,
            recoveryBackupConfirmed: false,
            vault: {
                ...initial.vault,
                keyWraps: [
                    ...initial.vault.keyWraps,
                    { ...initial.vault.keyWraps[0], id: 'wrap-2', label: 'Backup passkey' },
                ],
            },
        }
        render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={multiple} />)
        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))

        const primaryCard = screen.getByRole('article', { name: 'Primary passkey' })
        const removeButton = within(primaryCard).getByRole('button', { name: 'Remove Primary passkey' })
        expect(removeButton.disabled).toBe(false)
        expect(within(primaryCard).getByText('Another passkey will remain after removal. Keep an offline recovery backup too.')).toBeTruthy()
        await user.click(removeButton)
        expect(mocks.removePasskey).not.toHaveBeenCalled()
        const confirmation = within(primaryCard).getByRole('group', { name: 'Confirm removal of Primary passkey' })
        await user.click(within(confirmation).getByRole('button', { name: 'Remove passkey' }))
        expect(mocks.removePasskey).toHaveBeenCalledWith('wrap-1')
    })
"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one generated passkey test block, found {count}')
path.write_text(text.replace(old, new, 1))
print('Passkey removal regression test refined.')
