import { isAddress, isHex } from 'viem'

function parseQuantity(value, fieldName) {
    if (!/^(0|[1-9]\d*)$/.test(String(value ?? ''))) {
        throw new Error(
            `The quote contains an invalid transaction ${fieldName}.`,
        )
    }

    return BigInt(value)
}

export function getExecutableTransaction(quoteResponse) {
    const quote = quoteResponse?.selectedQuote
    const transaction = quote?.transaction

    if (!transaction || !isAddress(transaction.to ?? '')) {
        throw new Error(
            'The quote does not contain a valid destination address.',
        )
    }

    if (
        !isHex(transaction.data ?? '') ||
        transaction.data === '0x'
    ) {
        throw new Error(
            'The quote does not contain valid transaction data.',
        )
    }

    const request = {
        to: transaction.to,
        data: transaction.data,
        value: parseQuantity(transaction.value, 'value'),
        chainId: 56,
    }

    if (transaction.gas !== undefined) {
        request.gas = parseQuantity(
            transaction.gas,
            'gas limit',
        )
    }

    return request
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
