function endpointBase(quoteEndpoint) {
    try {
        const url = new URL(quoteEndpoint, window.location.origin)
        const apiIndex = url.pathname.indexOf('/v1/')
        if (apiIndex >= 0) url.pathname = url.pathname.slice(0, apiIndex)
        else url.pathname = url.pathname.replace(/\/+$/, '')
        url.search = ''
        url.hash = ''
        return url.toString().replace(/\/$/u, '')
    } catch {
        return ''
    }
}

export async function screenComplianceAccess({ endpoint, walletAddress, chainId, purpose = 'background', signal }) {
    if (!walletAddress) return {
        allowed: true,
        decision: 'allow',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const response = await fetch(`${endpointBase(endpoint)}/v1/compliance/screen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress, chainId, purpose }),
        signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = new Error(
            response.status >= 500
                ? 'Compliance screening is temporarily unavailable.'
                : payload?.error?.message ?? 'This wallet cannot use PistachioSwap transaction services.',
        )
        error.code = payload?.error?.code ?? 'COMPLIANCE_UNAVAILABLE'
        error.status = response.status
        throw error
    }
    if (
        !payload ||
        typeof payload.allowed !== 'boolean' ||
        !['allow', 'block', 'unavailable'].includes(payload.decision) ||
        typeof payload.expiresAt !== 'string'
    ) {
        const error = new Error('Compliance screening returned an invalid response.')
        error.code = 'COMPLIANCE_UNAVAILABLE'
        throw error
    }
    return payload
}
