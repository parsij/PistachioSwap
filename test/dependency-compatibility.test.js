// @vitest-environment node
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = createRequire(new URL('../package.json', import.meta.url))
const api = createRequire(new URL('../apps/api/package.json', import.meta.url))
const appkit = createRequire(root.resolve('@reown/appkit'))

describe('security-patched transitive dependency compatibility', () => {
  it('parses Anchor TOML through the actual Chainflip dependency path', () => {
    const sdk = createRequire(api.resolve('@chainflip/sdk/swap'))
    const solana = createRequire(sdk.resolve('@chainflip/solana'))
    const anchor = createRequire(solana.resolve('@coral-xyz/anchor'))
    const toml = anchor('toml')
    const config = toml.parse(Buffer.from(
      '[provider]\ncluster = "mainnet"\n[[test.validator.account]]\naddress = "example"\n',
    ))
    expect(config.provider.cluster).toBe('mainnet')
    expect(config.test.validator.account[0].address).toBe('example')
    expect(() => toml.parse('[provider')).toThrow()
  })

  it('preserves Reown frame validation for valid and invalid wallet messages', async () => {
    const entry = appkit.resolve('@reown/appkit-wallet')
    const schemas = await import(pathToFileURL(
      path.resolve(path.dirname(entry), '../src/W3mFrameSchema.js'),
    ).href)
    expect(schemas.AppConnectEmailRequest.safeParse({ email: 'user@example.com' }).success).toBe(true)
    expect(schemas.AppConnectEmailRequest.safeParse({ email: 'invalid' }).success).toBe(false)
    expect(schemas.AppSyncThemeRequest.safeParse({
      themeMode: 'dark', themeVariables: { '--color': 'red', '--size': 2 },
    }).success).toBe(true)
    expect(schemas.AppSyncThemeRequest.safeParse({ themeMode: 'invalid' }).success).toBe(false)
  })

  it('preserves Coinbase validation across nested ABI and Zod schemas', async () => {
    const utils = createRequire(appkit.resolve('@reown/appkit-utils'))
    const account = createRequire(utils.resolve('@base-org/account'))
    const entry = account.resolve('@coinbase/cdp-sdk')
    const schemas = await import(pathToFileURL(
      path.join(path.dirname(entry), 'policies/evmSchema.js'),
    ).href)
    const valid = { type: 'evmAddress', operator: 'in', addresses: [`0x${'1'.repeat(40)}`] }
    expect(schemas.EvmAddressCriterionSchema.safeParse(valid).success).toBe(true)
    expect(schemas.EvmAddressCriterionSchema.safeParse({ ...valid, addresses: ['invalid'] }).success).toBe(false)
    expect(schemas.EvmAddressCriterionSchema.safeParse({ ...valid, addresses: Array(301).fill(valid.addresses[0]) }).success).toBe(false)
  })

  it('loads the real Chainflip SDK and its contract schemas', async () => {
    const sdk = await import(pathToFileURL(api.resolve('@chainflip/sdk/swap')).href)
    expect(new sdk.SwapSDK({ network: 'mainnet' })).toBeInstanceOf(sdk.SwapSDK)
  })
})
