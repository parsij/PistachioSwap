const API_SUFFIX = '/v1/quote'

/**
 * Resolves the backend base URL shared by quote and sponsorship endpoints.
 * @param {string} quoteEndpoint PistachioSwap quote endpoint.
 * @returns {string} API base URL without the quote suffix.
 */
export function getGasAssistBaseUrl(quoteEndpoint) {
    if (typeof quoteEndpoint !== 'string' || !quoteEndpoint.endsWith(API_SUFFIX)) {
        throw new Error('Gas Assist requires the PistachioSwap API endpoint.')
    }
    return quoteEndpoint.slice(0, -API_SUFFIX.length)
}
