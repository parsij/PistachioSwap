import { getPistachioWalletManager } from './walletManager.js'

/**
 * Provides the existing wallet manager to wallet UI screens without exposing the
 * manager import as a presentation dependency. No operation or argument shape
 * is changed here.
 */
export const walletUIOperations = getPistachioWalletManager()
