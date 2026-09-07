import { isTrustedWalletToken } from '../../tokens/services/portfolio.js'

function activityAsset(candidate, assets, chainId) {
    if (!candidate) return null
    return assets.find(token => Number(token.chainId) === Number(chainId) &&
        String(token.address ?? '').toLowerCase() === String(candidate.address ?? '').toLowerCase()) ?? candidate
}

export function filterVisibleActivity(items, assets = []) {
    return items.filter(activity => {
        const token = activityAsset(activity.token, assets, activity.chainId)
        if (activity.type === 'received') return token?.isNative === true || isTrustedWalletToken(token)
        const blocked = candidate => candidate?.possibleSpam === true || ['high', 'blocked'].includes(candidate?.securityStatus)
        if (activity.type === 'swapped') return !blocked(activityAsset(activity.sellToken, assets, activity.chainId)) &&
            !blocked(activityAsset(activity.buyToken, assets, activity.chainId))
        if (activity.type === 'sent' || activity.type === 'approved') return !blocked(token)
        return activity.type === 'contract'
    })
}
