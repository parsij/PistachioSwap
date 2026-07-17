function enabled(name) {
    return String(import.meta.env[name] ?? '').trim().toLowerCase() === 'true'
}

function autoLockMinutes(value = import.meta.env.VITE_PISTACHIO_WALLET_AUTO_LOCK_MINUTES) {
    const parsed = Number(value ?? 15)
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 60
        ? Math.floor(parsed)
        : 15
}

export function getPistachioWalletFlags() {
    const localWalletEnabled = enabled('VITE_PISTACHIO_LOCAL_WALLET_ENABLED')
    const passkeyWalletEnabled = localWalletEnabled && enabled('VITE_PISTACHIO_PASSKEY_WALLET_ENABLED')
    return Object.freeze({
        localWalletEnabled,
        passkeyWalletEnabled,
        walletImportEnabled: passkeyWalletEnabled && enabled('VITE_PISTACHIO_WALLET_IMPORT_ENABLED'),
        keystoreImportEnabled: passkeyWalletEnabled && enabled('VITE_PISTACHIO_WALLET_KEYSTORE_IMPORT_ENABLED'),
        diagnosticsEnabled: Boolean(import.meta.env.DEV && enabled('VITE_PISTACHIO_PASSKEY_DIAGNOSTICS')),
        autoLockMinutes: autoLockMinutes(),
    })
}

export function isPistachioWalletEnabled() {
    return getPistachioWalletFlags().passkeyWalletEnabled
}

export const featureFlagInternals = { autoLockMinutes }
