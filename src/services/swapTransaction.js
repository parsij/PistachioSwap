import { getValidatedExecutableTransaction } from '../features/swap/services/executableTransaction.js'

export function getExecutableTransaction(quoteResponse, expected) {
    return getValidatedExecutableTransaction({
        quoteResponse,
        expectedChainId: expected?.chainId,
        expectedSellToken: expected?.sellToken,
        expectedBuyToken: expected?.buyToken,
        requireUnexpired: false,
    })
}

export function isQuoteExpired(quoteResponse, now = Date.now()) {
    const expiresAt = Date.parse(
        quoteResponse?.selectedQuote?.expiresAt ?? '',
    )

    return !Number.isFinite(expiresAt) || expiresAt <= now
}

export function isUserRejectedError(error) {
    let current = error

    while (current && typeof current === 'object') {
        if (
            current.code === 4001 ||
            current.name === 'UserRejectedRequestError'
        ) {
            return true
        }

        current = current.cause
    }

    return /user rejected|user denied/i.test(
        String(error?.shortMessage ?? error?.message ?? ''),
    )
}
