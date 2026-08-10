import { getGasAssistBaseUrl } from './gasAssist.js'

function previewError(code, message, details = {}) {
    const error = new Error(message)
    error.code = code
    error.details = details
    return error
}

/**
 * Fetches a non-mutating exact prepaid Gas Assist preview. The backend computes
 * the real sell-token prepayment first and quotes only the remaining net input.
 * No wallet signature, sponsorship order, quota reservation, provider identity,
 * or executable transaction is returned by this endpoint.
 */
export async function fetchSponsorshipPreview(
    quoteEndpoint,
    request,
    signal,
) {
    const allowed = new Set([
        'walletAddress',
        'sellToken',
        'buyToken',
        'grossInputAmount',
        'slippageBps',
    ])
    if (
        !request ||
        typeof request !== 'object' ||
        Object.keys(request).some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => !(key in request))
    ) {
        throw previewError(
            'SPONSORSHIP_PREVIEW_INVALID',
            'Gas Assist preview requests contain unsupported or missing fields.',
        )
    }

    let response
    try {
        response = await fetch(
            `${getGasAssistBaseUrl(quoteEndpoint)}/v1/sponsorship/preview`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(request),
                signal,
            },
        )
    } catch (cause) {
        if (cause?.name === 'AbortError') throw cause
        throw previewError(
            'SPONSORSHIP_PREVIEW_NETWORK_ERROR',
            'Could not load the Gas Assist preview.',
        )
    }

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        throw previewError(
            payload?.error?.code ?? 'SPONSORSHIP_PREVIEW_FAILED',
            payload?.error?.message ?? 'Gas Assist could not preview this swap.',
            payload?.error?.details ?? {},
        )
    }
    if (
        !payload ||
        !/^\d+$/u.test(String(payload.expectedOutputRaw ?? '')) ||
        !/^\d+$/u.test(String(payload.minimumOutputRaw ?? '')) ||
        !/^\d+$/u.test(String(payload.netSwapAmountRaw ?? '')) ||
        !/^\d+$/u.test(String(payload.paymentAmountRaw ?? ''))
    ) {
        throw previewError(
            'SPONSORSHIP_PREVIEW_INVALID_RESPONSE',
            'Gas Assist returned an invalid preview.',
        )
    }
    return payload
}
