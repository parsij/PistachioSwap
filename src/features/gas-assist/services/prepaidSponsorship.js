// Stable import boundary for Gas Assist. The active sponsorship provider is
// Particle; provider-specific implementation lives next to this compatibility file.
import {
    fetchSponsorshipOrder,
    waitForParticlePaymasterApproval,
} from './particleSponsorship.js'

export * from './particleSponsorship.js'

/**
 * Compatibility callback for the existing sponsorship hook. Despite the old
 * name, this never submits a signature or transaction to Pistachio's backend.
 * It only waits until Particle's signed before_paymaster_sign callback has been
 * accepted for this exact order.
 */
export async function submitAtomicSponsorship(
    quoteEndpoint,
    sessionToken,
    orderId,
    _unusedSignedPayload,
    signal,
) {
    const order = await fetchSponsorshipOrder(quoteEndpoint, sessionToken, orderId, signal)
    return waitForParticlePaymasterApproval(
        quoteEndpoint,
        sessionToken,
        orderId,
        order?.expiresAt,
        signal,
    )
}
