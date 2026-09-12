// Stable import boundary. Particle owns the active Gas Assist signing flow.
import {
    signPreparedAtomicSponsoredTransaction as signParticleDirectTransaction,
} from './particleTransactionSigning.js'

export * from './particleTransactionSigning.js'

export function signPreparedAtomicSponsoredTransaction(options) {
    return signParticleDirectTransaction({
        ...options,
        waitForPaymasterApproval:
            options?.waitForPaymasterApproval ?? options?.submitSignedTransaction,
    })
}
