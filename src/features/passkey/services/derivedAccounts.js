import { PISTACHIO_DERIVATION_PATH } from './constants.js'

// Standard Ethereum BIP-44 account sequence, shared by MetaMask and Uniswap.
export const MAX_DERIVED_ACCOUNTS = 100
export function accountDerivationPath(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_DERIVED_ACCOUNTS) {
        throw new TypeError('Invalid wallet account index.')
    }
    return `${PISTACHIO_DERIVATION_PATH.slice(0, -1)}${index}`
}
export function vaultAccounts(vault) {
    return vault?.accounts ?? (vault ? [{ index: 0, address: vault.address }] : [])
}
