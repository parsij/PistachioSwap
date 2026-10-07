import { afterEach, expect, it, vi } from 'vitest'
import { configurationPresence, crossChainProviderAudit } from '../src/cross-chain/provider-audit.js'
import { createDebridgeAdapter } from '../src/cross-chain/adapters/debridge/index.js'
import { createZeroXCrossChainAdapter } from '../src/cross-chain/adapters/zero-x/index.js'
import { createRelayAdapter } from '../src/cross-chain/adapters/relay/index.js'
import { getPlatformFeeConfiguration } from '../src/cross-chain/fees.js'
import type { HttpJson } from '../src/cross-chain/types.js'
import { validateCrossChainRequest } from '../src/cross-chain/validation.js'

afterEach(() => vi.unstubAllEnvs())

it('classifies presence without returning configuration values', () => {
    expect(configurationPresence(undefined)).toBe('MISSING')
    expect(configurationPresence(' ')).toBe('EMPTY')
    expect(configurationPresence('test-placeholder')).toBe('PRESENT')
    vi.stubEnv('ZEROX_API_KEY', 'sentinel-api-value')
    vi.stubEnv('CHAINFLIP_BROKER_API_URL', 'https://broker.example/credential-sentinel')
    const output = JSON.stringify(crossChainProviderAudit())
    expect(output).not.toContain('sentinel-api-value')
    expect(output).not.toContain('credential-sentinel')
    expect(output).not.toContain('https://')
})

it('does not mistake referral identity for authentication', () => {
    vi.stubEnv('DEBRIDGE_ENABLED', 'true')
    vi.stubEnv('DEBRIDGE_ACCESS_TOKEN', '')
    vi.stubEnv('DEBRIDGE_REFERRAL_CODE', 'test-referral')
    const audit = crossChainProviderAudit().find(entry => entry.provider === 'debridge-dln')!
    expect(audit.ready).toBe(false)
    expect(audit.credentialRequirement).toBe('optional-public-api-required-commercial')
})

it('preserves credential-optional DLN public API discovery', async () => {
    vi.stubEnv('DEBRIDGE_ENABLED', 'true')
    vi.stubEnv('DEBRIDGE_ACCESS_TOKEN', '')
    vi.stubEnv('PLATFORM_FEE_BPS', '67')
    vi.stubEnv('TREASURY_ADDRESS', '0x1111111111111111111111111111111111111111')
    const http: HttpJson = async (_url, options) => {
        expect(options?.headers).not.toHaveProperty('authorization')
        return { chains: [{ chainId: 137 }, { chainId: 10 }] }
    }
    expect((await createDebridgeAdapter(http).getCapabilities()).available).toBe(true)
})

it('normalizes the current DLN packet without inferring spender trust from a quote', async () => {
    vi.stubEnv('DEBRIDGE_ENABLED', 'true')
    vi.stubEnv('DEBRIDGE_ACCESS_TOKEN', '')
    vi.stubEnv('PLATFORM_FEE_BPS', '67')
    const treasury = '0x3333333333333333333333333333333333333333'
    vi.stubEnv('TREASURY_ADDRESS', treasury)
    const source = '0xef4fb24ad0916217251f553c0596f8edc630eb66'
    const request = validateCrossChainRequest({ mode: 'exactIn', sourceChainId: 10, destinationChainId: 137, sourceToken: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', destinationToken: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', amount: '10000000', account: treasury, recipient: treasury, slippageBps: 300 })
    let target = source
    const http: HttpJson = async url => {
        if (url.pathname.endsWith('/supported-chains-info')) return { chains: [{ chainId: 10 }, { chainId: 137 }] }
        expect(url.searchParams.get('dstChainTokenOutAmount')).toBe('auto')
        expect(url.searchParams.get('prependOperatingExpenses')).toBe('false')
        expect(url.searchParams.get('affiliateFeePercent')).toBe('0.67')
        expect(url.searchParams.get('affiliateFeeRecipient')).toBe(treasury)
        return { orderId: 'dln-fixture', estimation: { dstChainTokenOut: { amount: '9000000', recommendedAmount: '8900000' } }, tx: { to: target, data: '0x1234', value: '0' } }
    }
    const adapter = createDebridgeAdapter(http)
    const capabilities = await adapter.getCapabilities()
    const quote = await adapter.getQuote(request, capabilities)
    expect(quote.transaction.allowanceTarget).toBe(source)
    expect(quote.steps[0].transaction?.to).toBe(request.sourceAsset.address)
    target = '0x4444444444444444444444444444444444444444'
    await expect(adapter.getQuote(request, capabilities)).rejects.toThrow(/allowance target/)
})

it('keeps required credentials fail closed', async () => {
    vi.stubEnv('ZEROX_CROSS_CHAIN_ENABLED', 'true')
    vi.stubEnv('ZEROX_API_KEY', '')
    const http: HttpJson = async () => { throw Error('Must not request missing credentials') }
    expect((await createZeroXCrossChainAdapter(http).getCapabilities()).available).toBe(false)
    vi.stubEnv('RELAY_ENABLED', 'true')
    vi.stubEnv('RELAY_API_KEY', '')
    expect((await createRelayAdapter(http).getCapabilities()).available).toBe(false)
})

it('uses exact directed bridge pairs, not a Cartesian product of discovery chains', async () => {
    vi.stubEnv('ZEROX_CROSS_CHAIN_ENABLED', 'true')
    vi.stubEnv('ZEROX_API_KEY', 'test-placeholder')
    vi.stubEnv('PLATFORM_FEE_BPS', '67')
    vi.stubEnv('TREASURY_ADDRESS', '0x1111111111111111111111111111111111111111')
    const http: HttpJson = async () => ({ bridges: [{ chainPairs: [{ originChainId: 137, destinationChainId: 10 }, { originChainId: 137, destinationChainId: 10 }] }], swapSources: [{ chainIds: [1, 10, 137] }] })
    const capabilities = await createZeroXCrossChainAdapter(http).getCapabilities()
    expect(capabilities.routes).toEqual([{ sourceChainId: 137, destinationChainId: 10, transactionTargets: [] }])
})

it('never treats a discovery-only Chainflip broker as verified treasury income', () => {
    vi.stubEnv('CHAINFLIP_ENABLED', 'true')
    vi.stubEnv('CHAINFLIP_BROKER_API_URL', 'https://broker.example')
    expect(crossChainProviderAudit().find(entry => entry.provider === 'chainflip')!.ready).toBe(false)
})

it.each(['across', 'relay', 'debridge-dln', '0x-cross-chain'] as const)('preserves treasury and economic fee for %s', provider => {
    const treasury = '0x3333333333333333333333333333333333333333'
    vi.stubEnv('TREASURY_ADDRESS', treasury)
    vi.stubEnv('PLATFORM_FEE_BPS', '67')
    expect(getPlatformFeeConfiguration(provider)).toEqual({ bps: 67, recipient: treasury })
})
