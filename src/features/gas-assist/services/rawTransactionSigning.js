// Stable import boundary. Particle owns the active Gas Assist signing flow.
import {
    signPreparedAtomicSponsoredTransaction as signParticleDirectTransaction,
} from './particleTransactionSigning.js'

const PARTICLE_PAYMASTER_PREFLIGHT_GRACE_MS = 100

function wait(ms) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export * from './particleTransactionSigning.js'

export async function signPreparedAtomicSponsoredTransaction(options) {
    const approvalGate = options?.waitForPaymasterApproval ?? options?.submitSignedTransaction
    if (typeof approvalGate !== 'function') {
        return signParticleDirectTransaction(options)
    }

    let approvalSettled = false
    let approvalResult = null
    let approvalError = null

    const approvalPromise = Promise.resolve()
        .then(() => approvalGate(null))
        .then(
            (result) => {
                approvalSettled = true
                approvalResult = result
                return result
            },
            (error) => {
                approvalError = error
                throw error
            },
        )

    // Particle's Universal Account flow may not emit before_paymaster_sign until
    // sendTransaction actually asks the Paymaster to sponsor the UserOperation.
    // Give an already-arrived approval/rejection a brief chance to settle, but do
    // not deadlock forever waiting for a webhook whose trigger is the send itself.
    await Promise.race([
        approvalPromise,
        wait(PARTICLE_PAYMASTER_PREFLIGHT_GRACE_MS),
    ])

    const executionPromise = signParticleDirectTransaction({
        ...options,
        // The real approval promise stays active in parallel and is still required
        // for this wrapper to resolve. This inner gate only prevents the older
        // implementation from blocking before sendTransaction can trigger Particle.
        waitForPaymasterApproval: async () => {
            if (approvalError) throw approvalError
            if (approvalSettled) return approvalResult
            return {
                atomicExecution: {
                    paymasterApproval: 'pending',
                },
            }
        },
    })

    const [execution] = await Promise.all([
        executionPromise,
        approvalPromise,
    ])
    return execution
}

export const rawTransactionSigningInternals = {
    PARTICLE_PAYMASTER_PREFLIGHT_GRACE_MS,
}
