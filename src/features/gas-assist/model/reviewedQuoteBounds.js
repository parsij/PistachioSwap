const REPRICED_FIELDS = new Set([
    'netSwapAmountRaw', 'paymentAmountRaw', 'expectedOutputRaw', 'minimumOutputRaw',
    'approvalAmountRaw', 'gasReserveUsdMicros', 'conversionCostUsdMicros',
    'totalPrepaymentUsdMicros', 'estimatedPaymentGasUsdMicros',
    'estimatedApprovalGasUsdMicros', 'estimatedSwapGasUsdMicros',
])

/** Permit only economic changes bounded by the quote the user actually confirmed. */
export function withinReviewedQuoteBounds(reviewed, created, changed) {
    try {
        const raw = (object, key) => {
            const value = String(object?.[key] ?? '')
            if (!/^\d+$/u.test(value)) throw new Error('Missing quote bound')
            return BigInt(value)
        }
        if (raw(reviewed, 'minimumOutputRaw') <= 0n ||
            raw(created, 'minimumOutputRaw') < raw(reviewed, 'minimumOutputRaw') ||
            raw(created, 'expectedOutputRaw') < raw(created, 'minimumOutputRaw') ||
            raw(created, 'paymentAmountRaw') > raw(reviewed, 'paymentAmountRaw') ||
            raw(created, 'totalPrepaymentUsdMicros') > raw(reviewed, 'totalPrepaymentUsdMicros') ||
            raw(created, 'netSwapAmountRaw') < raw(reviewed, 'netSwapAmountRaw') ||
            raw(created, 'netSwapAmountRaw') + raw(created, 'paymentAmountRaw') > raw(created, 'grossInputAmountRaw')) return false
        if (created.requiresApproval && raw(created, 'approvalAmountRaw') !== raw(created, 'netSwapAmountRaw')) return false
        const fixedReview = { ...reviewed }
        for (const key of REPRICED_FIELDS) fixedReview[key] = created[key]
        // All recipients, chains, tokens, gross amount, provider, approval
        // spender, commercial terms and route bindings must still be identical.
        return !changed(fixedReview, created)
    } catch {
        return false
    }
}
