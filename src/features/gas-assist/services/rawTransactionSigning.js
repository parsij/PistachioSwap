import {
    normalizePreparedSponsoredTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'

const SUPPORTED_CONNECTOR_IDS = new Set([
    'pistachio-local',
])

/** Derives raw-transaction signing capability without prompting the connected wallet. */
export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported =
        SUPPORTED_CONNECTOR_IDS.has(connectorId) &&
        typeof walletClient?.request === 'function'
    const transport = supported ? 'pistachio-local' : null
    return Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported ? ['eth_signTransaction'] : [],
        reasonCode: supported ? null : 'PISTACHIO_WALLET_REQUIRED',
    })
}

/**
 * Requests raw transaction signing from Pistachio Wallet.
 * @returns {Promise<string>} Signed serialized transaction bytes.
 * @throws A safe capability, account-binding, or wallet-signing error.
 * @sideEffects Displays the Pistachio Wallet transaction review when explicitly invoked.
 */
export async function signRawSponsoredTransaction({
    capability,
    walletClient,
    transaction,
}) {
    if (
        capability?.rawTransactionSigningSupported !== true ||
        capability.method !== 'eth_signTransaction' ||
        capability.transport !== 'pistachio-local' ||
        typeof walletClient?.request !== 'function'
    ) {
        const error = new Error('Gas Assist requires Pistachio Wallet.')
        error.code = 'PISTACHIO_WALLET_REQUIRED'
        throw error
    }
    const signedRawTransaction = await walletClient.request({
        method: 'eth_signTransaction',
        params: [transaction],
    })
    if (typeof signedRawTransaction !== 'string' || !/^0x[0-9a-f]+$/i.test(signedRawTransaction)) {
        const error = new Error('Pistachio Wallet returned an invalid signed transaction.')
        error.code = 'WALLET_RAW_TRANSACTION_MALFORMED'
        throw error
    }
    return signedRawTransaction
}

/** Signs and validates the exact backend-prepared sponsored transaction. */
export async function signPreparedSponsoredTransaction({
    transport,
    capability,
    walletClient,
    preparedTransaction,
    authenticatedWalletAddress,
    multichainAccount,
    submitSignedTransaction,
}) {
    if (typeof submitSignedTransaction !== 'function') {
        const error = new Error('A direct sponsorship submission callback is required.')
        error.code = 'SPONSORSHIP_SUBMISSION_REQUIRED'
        throw error
    }
    if (transport !== 'pistachio-local') {
        const error = new Error('Gas Assist requires Pistachio Wallet.')
        error.code = 'PISTACHIO_WALLET_REQUIRED'
        throw error
    }
    const normalizedTransaction = normalizePreparedSponsoredTransaction(
        preparedTransaction,
        authenticatedWalletAddress,
    )
    let signedRawTransaction = null
    try {
        signedRawTransaction = await signRawSponsoredTransaction({
            capability,
            walletClient,
            transaction: normalizedTransaction,
        })
        await validateSignedPreparedTransaction({
            signedRawTransaction,
            normalizedTransaction,
            authenticatedWalletAddress,
            multichainAccount: multichainAccount ?? authenticatedWalletAddress,
        })
        return await submitSignedTransaction(signedRawTransaction)
    } finally {
        signedRawTransaction = null
    }
}

export const rawSigningInternals = {
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
}
