function usdMicrosFromFormatted(value) {
    const normalized = String(value ?? '').trim()
    if (!normalized || !/^\d+(?:\.\d+)?$/u.test(normalized)) return '0'
    const [whole, fraction = ''] = normalized.split('.')
    const padded = fraction.padEnd(6, '0').slice(0, 6)
    return String(BigInt(whole) * 1_000_000n + BigInt(padded || '0'))
}

/**
 * Maps a non-mutating sponsorship preview into the prepaid review order shape.
 * @param {object} preview Sponsorship preview payload from `/v1/sponsorship/preview`.
 * @param {string} walletAddress Connected wallet address.
 * @returns {object} Preview order accepted by `reviewOrder`.
 */
export function buildSponsorshipPreviewOrder(preview, walletAddress) {
    if (!preview || !walletAddress) {
        throw new Error('Gas Assist preview data is incomplete.')
    }

    const previewKey = [
        walletAddress.toLowerCase(),
        preview.sellToken,
        preview.buyToken,
        preview.grossInputAmountRaw,
        preview.netSwapAmountRaw,
        preview.paymentAmountRaw,
        preview.expectedOutputRaw,
        preview.expiresAt,
    ].join(':')

    return {
        id: `preview:${previewKey}`,
        isPreview: true,
        status: 'preview',
        walletAddress,
        chainId: preview.chainId ?? 56,
        sellToken: preview.sellToken,
        buyToken: preview.buyToken,
        grossInputAmountRaw: preview.grossInputAmountRaw,
        netSwapAmountRaw: preview.netSwapAmountRaw,
        paymentToken: preview.paymentToken,
        paymentTokenReason: 'eligible-sell-token',
        paymentTokenSymbol: preview.paymentTokenSymbol,
        paymentAmountRaw: preview.paymentAmountRaw,
        paymentTokenDecimals: preview.paymentTokenDecimals,
        expectedOutputRaw: preview.expectedOutputRaw,
        minimumOutputRaw: preview.minimumOutputRaw,
        fixedServiceFeeUsdMicros: usdMicrosFromFormatted(preview.amountsUsd?.fixedServiceFee),
        platformFeeUsdMicros: usdMicrosFromFormatted(preview.amountsUsd?.platformFee),
        gasReserveUsdMicros: usdMicrosFromFormatted(preview.amountsUsd?.gasReserve),
        totalPrepaymentUsdMicros: usdMicrosFromFormatted(preview.amountsUsd?.totalPrepayment),
        expiresAt: preview.expiresAt,
        currentRequiredAction: 'prepare-payment',
    }
}
