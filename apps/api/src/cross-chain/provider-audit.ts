import { getApiConfig } from '../config.js'
import { platformFeeIncompatibility } from './fees.js'
import type { CrossChainProviderName } from './types.js'

export function configurationPresence(value: string | undefined): 'PRESENT' | 'MISSING' | 'EMPTY' {
    if (value === undefined) return 'MISSING'
    return value.trim() ? 'PRESENT' : 'EMPTY'
}

export function crossChainProviderAudit() {
    const config = getApiConfig().crossChain
    const entries = [
        { provider: 'across', enabled: config.across.enabled, requirement: 'required', keys: ['ACROSS_API_KEY', 'ACROSS_INTEGRATOR_ID'] },
        { provider: 'relay', enabled: config.relay.enabled, requirement: 'required', keys: ['RELAY_API_KEY'] },
        { provider: 'debridge-dln', enabled: config.debridge.enabled, requirement: 'optional-public-api-required-commercial', keys: ['DEBRIDGE_ACCESS_TOKEN'] },
        { provider: '0x-cross-chain', enabled: config.zeroX.enabled, requirement: 'required', keys: ['ZEROX_API_KEY'] },
        { provider: 'chainflip', enabled: config.chainflip.enabled, requirement: 'broker-and-treasury-ownership', keys: ['CHAINFLIP_BROKER_API_URL'] },
    ] as const
    return entries.map(entry => {
        const credentials = Object.fromEntries(entry.keys.map(key => [key, configurationPresence(process.env[key])]))
        const credentialsPresent = Object.values(credentials).every(state => state === 'PRESENT')
        const feeCompatible = !platformFeeIncompatibility(entry.provider as CrossChainProviderName)
        const ready = entry.enabled && credentialsPresent && feeCompatible && entry.provider !== 'chainflip'
        return {
            provider: entry.provider,
            implemented: true,
            enabled: entry.enabled ? 'ENABLED' : 'DISABLED',
            credentialRequirement: entry.requirement,
            credentials,
            feeSupported: feeCompatible,
            ready,
            reason: !entry.enabled ? 'DISABLED' : !credentialsPresent ? 'MISSING_PRODUCTION_CONFIGURATION' : !feeCompatible || entry.provider === 'chainflip' ? 'FEE_TREASURY_NOT_VERIFIED' : 'CAPABILITY_AND_QUOTE_REQUIRED',
        }
    })
}
