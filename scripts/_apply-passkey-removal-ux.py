from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    file_path.write_text(text.replace(old, new, 1))


# A second passkey is sufficient to keep the wallet unlockable. Recovery remains
# strongly recommended, but it is no longer falsely treated as a prerequisite
# for removing one of multiple passkeys.
replace_once(
    "src/features/passkey/components/wallet/WalletSecurityPanels.jsx",
    "    const canRemove = snapshot.vault.keyWraps.length > 1 && snapshot.recoveryBackupConfirmed\n",
    "    const canRemove = snapshot.vault.keyWraps.length > 1\n",
    "passkey remove UI gate",
)

replace_once(
    "src/features/passkey/components/wallet/WalletSecurityPanels.jsx",
    "                <p id={`${id}-remove-help`}>{snapshot.vault.keyWraps.length === 1 ? 'Your only passkey cannot be removed. Add another passkey first.' : !snapshot.recoveryBackupConfirmed ? 'Confirm an offline recovery backup before removing a passkey.' : 'Removing access here does not delete the passkey from your browser, device, or password manager.'}</p>\n",
    "                <p id={`${id}-remove-help`}>{snapshot.vault.keyWraps.length === 1 ? 'Your only passkey cannot be removed. Add another passkey first.' : !snapshot.recoveryBackupConfirmed ? 'Another passkey will remain after removal. Keep an offline recovery backup too.' : 'Removing access here does not delete the passkey from your browser, device, or password manager.'}</p>\n",
    "passkey remove help copy",
)

replace_once(
    "src/features/passkey/components/wallet/WalletSecurityPanels.jsx",
    "            <button type=\"button\" className=\"pistachio-security-test\" disabled={busy} onClick={() => run('test-passkey', () => manager.reauthenticate(), 'Passkey verified. This wallet can be unlocked with it.')}><KeyRound aria-hidden=\"true\" /> Test passkey unlock</button>\n            <div className=\"pistachio-security-hint\"><p>Keep an offline recovery backup before removing a passkey.</p><button type=\"button\" className=\"pistachio-security-link\" disabled={busy} onClick={onRecovery}>Manage recovery</button></div>\n",
    "            <div className=\"pistachio-security-hint\"><p>Keep an offline recovery backup before removing a passkey.</p><button type=\"button\" className=\"pistachio-security-link\" disabled={busy} onClick={onRecovery}>Manage recovery</button></div>\n            <button type=\"button\" className=\"pistachio-security-test\" disabled={busy} onClick={() => run('test-passkey', () => manager.reauthenticate(), 'Passkey verified. This wallet can be unlocked with it.')}><KeyRound aria-hidden=\"true\" /> Test passkey unlock</button>\n",
    "test passkey button ordering",
)

# Enforce the real invariant in the manager: never remove the final passkey.
# Do not manufacture a recovery-backup acknowledgement when no backup exists.
replace_once(
    "src/features/passkey/services/walletManagerSigning.js",
    "    async removePasskey(keyWrapId) {\n        await this.reauthenticate()\n        if (!this.recoveryBackupConfirmed) throw managerError('PISTACHIO_RECOVERY_BACKUP_REQUIRED', 'Confirm an offline recovery backup before removing a passkey.')\n        const result = await this.client.request('removePasskeyWrap', { keyWrapId, backupAcknowledged: true })\n        this.vault = await this.storage.saveAndReadBackVault(result.vault)\n        this.notify()\n    },\n",
    "    async removePasskey(keyWrapId) {\n        this.requireUnlocked()\n        if (!this.vault || this.vault.keyWraps.length <= 1) {\n            throw managerError(\n                'PISTACHIO_LAST_PASSKEY_REQUIRED',\n                'Your only passkey cannot be removed. Add another passkey first.',\n            )\n        }\n        await this.reauthenticate()\n        const result = await this.client.request('removePasskeyWrap', { keyWrapId })\n        this.vault = await this.storage.saveAndReadBackVault(result.vault)\n        this.notify()\n    },\n",
    "manager passkey remove gate",
)

replace_once(
    "src/features/passkey/services/walletWorker.js",
    "        if (!activeVault || !dek || activeVault.keyWraps.length <= 1 || message.backupAcknowledged !== true) {\n            throw new TypeError('The last passkey wrap cannot be removed without recovery backup evidence.')\n        }\n",
    "        if (!activeVault || !dek || activeVault.keyWraps.length <= 1) {\n            throw new TypeError('The last passkey wrap cannot be removed.')\n        }\n",
    "worker passkey remove invariant",
)

# Update the UI regression test to prove the exact requested behavior and layout.
replace_once(
    "src/features/passkey/components/wallet/UnlockedWalletScreen.recovery.test.jsx",
    "    it('requires another passkey, an offline backup, and explicit confirmation before removing access', async () => {\n        const user = userEvent.setup()\n        const initial = snapshot()\n        const view = render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={initial} />)\n        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))\n        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(true)\n        const multiple = { ...initial, recoveryBackupConfirmed: false, vault: { ...initial.vault, keyWraps: [...initial.vault.keyWraps, { ...initial.vault.keyWraps[0], id: 'wrap-2', label: 'Backup passkey' }] } }\n        view.rerender(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={multiple} />)\n        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(true)\n        view.rerender(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={{ ...multiple, recoveryBackupConfirmed: true }} />)\n        await user.click(screen.getByRole('button', { name: 'Remove Primary passkey' }))\n        expect(mocks.removePasskey).not.toHaveBeenCalled()\n        const confirmation = screen.getByRole('group', { name: 'Confirm removal of Primary passkey' })\n        await user.click(within(confirmation).getByRole('button', { name: 'Remove passkey' }))\n        expect(mocks.removePasskey).toHaveBeenCalledWith('wrap-1')\n    })\n",
    "    it('requires another passkey and explicit confirmation before removing access', async () => {\n        const user = userEvent.setup()\n        const initial = snapshot()\n        const view = render(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={initial} />)\n        await user.click(screen.getByRole('button', { name: 'Details for Primary passkey' }))\n        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(true)\n\n        const multiple = { ...initial, recoveryBackupConfirmed: false, vault: { ...initial.vault, keyWraps: [...initial.vault.keyWraps, { ...initial.vault.keyWraps[0], id: 'wrap-2', label: 'Backup passkey' }] } }\n        view.rerender(<UnlockedContent onSensitiveChange={vi.fn()} snapshot={multiple} />)\n\n        expect(screen.getByRole('button', { name: 'Remove Primary passkey' }).disabled).toBe(false)\n        expect(screen.getByText('Another passkey will remain after removal. Keep an offline recovery backup too.')).toBeTruthy()\n        await user.click(screen.getByRole('button', { name: 'Remove Primary passkey' }))\n        expect(mocks.removePasskey).not.toHaveBeenCalled()\n        const confirmation = screen.getByRole('group', { name: 'Confirm removal of Primary passkey' })\n        await user.click(within(confirmation).getByRole('button', { name: 'Remove passkey' }))\n        expect(mocks.removePasskey).toHaveBeenCalledWith('wrap-1')\n    })\n",
    "passkey removal UI regression",
)

replace_once(
    "src/features/passkey/components/wallet/UnlockedWalletScreen.recovery.test.jsx",
    "        render(<UnlockedContent onClose={onClose} onSensitiveChange={vi.fn()} snapshot={snapshot()} />)\n        await user.click(screen.getByRole('button', { name: 'Test passkey unlock' }))\n",
    "        render(<UnlockedContent onClose={onClose} onSensitiveChange={vi.fn()} snapshot={snapshot()} />)\n        const backupHint = screen.getByText('Keep an offline recovery backup before removing a passkey.').parentElement\n        const testButton = screen.getByRole('button', { name: 'Test passkey unlock' })\n        expect(backupHint.compareDocumentPosition(testButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()\n        await user.click(testButton)\n",
    "test passkey layout regression",
)

print("Passkey removal and layout patch applied.")
