import { getCuratedEvmChain, TOKEN_DISCOVERY_CHAIN_IDS } from '../../../web3/curatedEvmChains.js'
import { getAssetIdentity, isTrustedWalletToken } from '../../tokens/services/portfolio.js'
import { resolveWalletUsdValue } from '../../tokens/services/walletTokens.js'

function decimal(value) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? ''))
    if (!match) return null
    return { units: BigInt(match[1] + (match[2] ?? '')), scale: (match[2] ?? '').length }
}
function sum(left, right) {
    const scale = Math.max(left.scale, right.scale)
    return { units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale), scale }
}

/** Sum trusted, priced holdings per chain without floating-point rounding or history requests. */
export function highestValueWalletChain(tokens = [], fallback = 1) {
    const totals = new Map()
    const seen = new Set()
    for (const token of tokens) {
        const chainId = Number(token?.chainId)
        const identity = getAssetIdentity(token)
        if (!TOKEN_DISCOVERY_CHAIN_IDS.includes(chainId) || seen.has(identity) || !isTrustedWalletToken(token)) continue
        const balance = decimal(token.balance ?? token.formattedBalance)
        const value = decimal(resolveWalletUsdValue(token))
        if (!balance || balance.units <= 0n || !value || value.units <= 0n) continue
        seen.add(identity)
        totals.set(chainId, sum(totals.get(chainId) ?? { units: 0n, scale: 0 }, value))
    }
    let winner = fallback
    let maximum = { units: 0n, scale: 0 }
    for (const chainId of [...totals.keys()].sort((a, b) => a - b)) {
        const total = totals.get(chainId)
        const scale = Math.max(total.scale, maximum.scale)
        if (total.units * 10n ** BigInt(scale - total.scale) > maximum.units * 10n ** BigInt(scale - maximum.scale)) {
            winner = chainId
            maximum = total
        }
    }
    return winner
}

export function nativeSwapInput(chainId = 1) {
    const chain = getCuratedEvmChain(chainId) ?? getCuratedEvmChain(1)
    return { chainId: chain.id, address: '0x0000000000000000000000000000000000000000',
        isNative: true, name: chain.nativeCurrency.name, symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals }
}
