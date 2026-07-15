export function getSwapActionState({
    isConnected,
    isCorrectNetwork,
    hasSellToken,
    hasBuyToken,
    hasAmount,
    quoteStatus,
    quoteReady,
    transactionStatus,
}) {
    if (!isConnected) {
        return {
            type: 'connect',
            label: 'Connect wallet',
            enabled: true,
        }
    }

    if (!isCorrectNetwork) {
        return {
            type: 'switch-network',
            label: 'Switch to BNB Chain',
            enabled: true,
        }
    }

    if (!hasSellToken || !hasBuyToken) {
        return {
            type: 'select-token',
            label: 'Select a token',
            enabled: false,
        }
    }

    if (!hasAmount) {
        return {
            type: 'enter-amount',
            label: 'Enter an amount',
            enabled: false,
        }
    }

    if (transactionStatus === 'pending') {
        return {
            type: 'transaction-pending',
            label: 'Confirm in wallet',
            enabled: false,
        }
    }

    if (transactionStatus === 'submitted') {
        return {
            type: 'transaction-submitted',
            label: 'Transaction submitted',
            enabled: false,
        }
    }

    if (quoteStatus === 'loading') {
        return {
            type: 'quote-loading',
            label: 'Finding the best price',
            enabled: false,
        }
    }

    if (quoteStatus === 'error') {
        return {
            type: 'quote-error',
            label: 'No quote available',
            enabled: false,
        }
    }

    if (quoteReady) {
        return {
            type: 'swap',
            label: 'Swap',
            enabled: true,
        }
    }

    return {
        type: 'quote-unavailable',
        label: 'No quote available',
        enabled: false,
    }
}
