export const PISTACHIO_WALLET_NAME = 'Pistachio Wallet'
export const PISTACHIO_CONNECTOR_ID = 'pistachio-local'
export const PISTACHIO_CHAIN_ID = 56
export const PISTACHIO_CHAIN_HEX = '0x38'
export const PISTACHIO_CAIP_CHAIN_ID = 'eip155:56'
export const PISTACHIO_DERIVATION_PATH = "m/44'/60'/0'/0/0"
export const PISTACHIO_VAULT_SCHEMA_VERSION = 1
export const PISTACHIO_VAULT_DB_NAME = 'pistachio-wallet'
export const PISTACHIO_VAULT_DB_VERSION = 1
export const PISTACHIO_VAULT_STORE = 'vaults'
export const PISTACHIO_PREFERENCES_STORE = 'preferences'
export const PISTACHIO_SIGNING_TTL_MS = 120_000
export const PISTACHIO_MAX_KEYSTORE_BYTES = 1024 * 1024

export const PISTACHIO_SOURCE_TYPES = Object.freeze([
    'generated-mnemonic',
    'imported-mnemonic',
    'imported-private-key',
    'imported-keystore',
])
