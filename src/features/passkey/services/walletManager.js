/**
 * Stable public facade for the Pistachio Wallet manager.
 * The state-machine implementation remains internal to walletManagerCore.js;
 * callers must use this module so singleton behavior and public exports stay stable.
 */
export { PistachioWalletManager, getPistachioWalletManager, walletManagerInternals } from './walletManagerCore.js'
