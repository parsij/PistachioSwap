const API_SUFFIX = '/v1/quote'

export function getGasAssistBaseUrl(quoteEndpoint) {
    if (typeof quoteEndpoint !== 'string' || !quoteEndpoint.endsWith(API_SUFFIX)) {
        throw new Error('Gas Assist requires the PistachioSwap API endpoint.')
    }
    return quoteEndpoint.slice(0, -API_SUFFIX.length)
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options)
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = new Error(payload?.error?.message ?? 'Gas Assist is unavailable.')
        error.code = payload?.error?.code ?? 'GAS_ASSIST_FAILED'
        error.details = payload?.error?.details
        throw error
    }
    return payload
}

function post(quoteEndpoint, path, body, signal) {
    return requestJson(`${getGasAssistBaseUrl(quoteEndpoint)}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    })
}

export function fetchGasAssistConfig(quoteEndpoint, signal) {
    return requestJson(`${getGasAssistBaseUrl(quoteEndpoint)}/v1/gas-assist/config`, { signal })
}

export function fetchGaslessPrice(quoteEndpoint, request, signal) {
    return post(quoteEndpoint, '/v1/gas-assist/price', exactGaslessRequest(request, false), signal)
}

export function createGaslessQuote(quoteEndpoint, request, signal) {
    return post(quoteEndpoint, '/v1/gas-assist/quote', exactGaslessRequest(request, true), signal)
}

export function submitGaslessQuote(quoteEndpoint, request, signal) {
    const allowed = new Set(['quoteId', 'approvalSignature', 'tradeSignature'])
    if (!request || Object.keys(request).some((key) => !allowed.has(key))) {
        throw new Error('Gas Assist submission contains unsupported fields.')
    }
    return post(quoteEndpoint, '/v1/gas-assist/submit', {
        quoteId: request.quoteId,
        approvalSignature: request.approvalSignature ?? null,
        tradeSignature: request.tradeSignature,
    }, signal)
}

export function fetchGaslessStatus(quoteEndpoint, tradeHash, signal) {
    return requestJson(
        `${getGasAssistBaseUrl(quoteEndpoint)}/v1/gas-assist/status/${encodeURIComponent(tradeHash)}`,
        { signal },
    )
}

export function exactGaslessRequest(request, includeSlippage) {
    const fields = ['chainId', 'walletAddress', 'sellToken', 'buyToken', 'sellAmount']
    if (includeSlippage) fields.push('slippageBps')
    const allowed = new Set(fields)
    if (
        !request ||
        typeof request !== 'object' ||
        Object.keys(request).some((key) => !allowed.has(key)) ||
        fields.some((key) => !(key in request))
    ) {
        throw new Error('Gas Assist requests contain unsupported fields.')
    }
    return Object.freeze(Object.fromEntries(fields.map((key) => [key, request[key]])))
}

export function normalizeZeroXTypedData(eip712) {
    if (!eip712?.domain || !eip712?.types || !eip712?.primaryType || !eip712?.message) {
        throw new Error('0x returned invalid typed data.')
    }
    const { EIP712Domain: _domain, ...types } = eip712.types
    return Object.freeze({
        domain: eip712.domain,
        types,
        primaryType: eip712.primaryType,
        message: eip712.message,
    })
}

export async function signZeroXTypedData(walletClient, walletAddress, eip712) {
    return walletClient.signTypedData({
        account: walletAddress,
        ...normalizeZeroXTypedData(eip712),
    })
}
