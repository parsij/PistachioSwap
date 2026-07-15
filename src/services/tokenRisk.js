const NORMALIZED_RISK_REASONS = new Set([
    'moralis-possible-spam',
    'manual-blocklist',
    'honeypot-confirmed',
    'honeypot-risk-high',
    'security-high',
    'security-blocked',
    'security-risk-high',
    'sell-simulation-failed',
    'transfer-simulation-failed',
    'high-sell-tax',
    'high-transfer-tax',
    'cannot-sell-all',
    'owner-can-change-balance',
])

export function getTokenRiskReasonCategories(token) {
    const reasons = [
        ...(token?.spamReasons ?? []),
        ...(token?.securityReasons ?? []),
        ...(token?.visibilityReasons ?? []),
    ].filter((reason) => NORMALIZED_RISK_REASONS.has(reason))

    if (token?.possibleSpam === true) reasons.push('moralis-possible-spam')
    if (token?.securityStatus === 'high') reasons.push('security-high')
    if (token?.securityStatus === 'blocked') reasons.push('security-blocked')
    if (token?.visibility === 'hidden' && reasons.length === 0) {
        reasons.push('hidden-risk-classification')
    }

    return [...new Set(reasons)]
}

export function tokenRequiresRiskConfirmation(token) {
    return token?.visibility === 'hidden' ||
        token?.possibleSpam === true ||
        ['high', 'blocked'].includes(token?.securityStatus)
}

export function confirmRiskyTokenSelection(token, action = 'use') {
    if (!tokenRequiresRiskConfirmation(token)) return true
    const categories = getTokenRiskReasonCategories(token).join(', ')
    return window.confirm(
        `This token has severe security warnings. Risk categories: ${categories}. ` +
        `Interacting with it may result in loss. Continue to ${action}?`,
    )
}
