import {
    normalizePreparedSponsoredTransaction,
    signMetaMaskMultichainTransaction,
    validateSignedPreparedTransaction,
} from './metamaskMultichain.js'

const SUPPORTED_CONNECTOR_IDS = new Set([
    'pistachio-embedded',
    'pistachio-local',
])

export function detectRawTransactionSigning({ connector, walletClient }) {
    const connectorId = String(connector?.id ?? '').trim().toLowerCase()
    const supported =
        SUPPORTED_CONNECTOR_IDS.has(connectorId) &&
        typeof walletClient?.request === 'function'
    const transport = supported
        ? connectorId === 'pistachio-local' ? 'pistachio-local' : 'pistachio-embedded'
        : null
    return Object.freeze({
        rawTransactionSigningSupported: supported,
        method: supported ? 'eth_signTransaction' : null,
        transport,
        status: supported ? 'verified' : 'unsupported',
        scope: supported ? 'eip155:56' : null,
        account: null,
        approvedMethods: supported ? ['eth_signTransaction'] : [],
        reasonCode: supported ? null : 'WALLET_RAW_TRANSACTION_SIGNING_UNSUPPORTED',
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

export async function signPreparedSponsoredTransaction({
    transport,
    capability,
    walletClient,
    preparedTransaction,
    authenticatedWalletAddress,
    multichainAccount,
    isMetaMask = false,
    submitSignedTransaction,
}) {
    if (typeof submitSignedTransaction !== 'function') {
        const error = new Error('A direct sponsorship submission callback is required.')
        error.code = 'SPONSORSHIP_SUBMISSION_REQUIRED'
        throw error
    }
    const normalizedTransaction = normalizePreparedSponsoredTransaction(
        preparedTransaction,
        authenticatedWalletAddress,
    )
    let signedRawTransaction = null
    try {
        if (transport === 'metamask-connect-multichain') {
            signedRawTransaction = await signMetaMaskMultichainTransaction({
                preparedTransaction,
                authenticatedWalletAddress,
                appKitAddress: authenticatedWalletAddress,
                isMetaMask,
            })
        } else if (transport === 'pistachio-local' || transport === 'pistachio-embedded') {
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
        } else {
            const error = new Error('This signing transport is not supported.')
            error.code = 'WALLET_RAW_TRANSACTION_SIGNING_UNSUPPORTED'
            throw error
        }
        return await submitSignedTransaction(signedRawTransaction)
    } finally {
        signedRawTransaction = null
    }
}

export const rawSigningInternals = {
    supportedConnectorIds: SUPPORTED_CONNECTOR_IDS,
}
