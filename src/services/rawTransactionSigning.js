const SUPPORTED_CONNECTOR_IDS = new Set([
    'pistachio-embedded',
    'pistachio-local',
])

export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported =
        SUPPORTED_CONNECTOR_IDS.has(connectorId) &&
        typeof walletClient?.request === 'function'
    return Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
    })
}

export async function signRawSponsoredTransaction({
    capability,
    walletClient,
    transaction,
}) {
    if (
        capability?.rawTransactionSigningSupported !== true ||
        capability.method !== 'eth_signTransaction' ||
        typeof walletClient?.request !== 'function'
    ) {
        const error = new Error(
            'This wallet cannot sign a private sponsored transaction without broadcasting it. Use a supported wallet or pay normal BNB gas.',
        )
        error.code = 'WALLET_RAW_TRANSACTION_SIGNING_UNSUPPORTED'
        throw error
    }
    const signedRawTransaction = await walletClient.request({
        method: 'eth_signTransaction',
        params: [transaction],
    })
    if (typeof signedRawTransaction !== 'string' || !/^0x[0-9a-f]+$/i.test(signedRawTransaction)) {
        const error = new Error('The wallet returned an invalid signed transaction.')
        error.code = 'WALLET_RAW_TRANSACTION_SIGNING_UNSUPPORTED'
        throw error
    }
    return signedRawTransaction
}

export const rawSigningInternals = {
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
}
