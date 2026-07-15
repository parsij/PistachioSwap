import { getApiConfig } from '../../config.js'
import { normalizeAddress } from '../../lib/address.js'
import { isRecord } from '../../lib/http.js'
import { goPlusTokenSecurityRequests } from './goplus-client.js'
import type { GoPlusTokenSecurity } from './types.js'

export function goPlusFlag(value: unknown): boolean | null {
    if (value === '1' || value === 1 || value === true) return true
    if (value === '0' || value === 0 || value === false) return false
    return null
}

function decimalOrNull(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const text = String(value).trim()
    return /^\d+(?:\.\d+)?$/.test(text) ? text : null
}

function sumDexLiquidity(value: unknown) {
    if (!Array.isArray(value)) return null
    let total = 0
    let found = false
    for (const dex of value) {
        if (!isRecord(dex)) continue
        const liquidity = Number(dex.liquidity)
        if (Number.isFinite(liquidity) && liquidity >= 0) {
            total += liquidity
            found = true
        }
    }
    return found ? String(total) : null
}

export function unavailableGoPlusSecurity(
    address: string,
    checkedAt = new Date().toISOString(),
): GoPlusTokenSecurity {
    return {
        provider: 'goplus', chainId: 56, address, available: false, checkedAt,
        isHoneypot: null, cannotBuy: null, cannotSellAll: null,
        hasBlacklist: null, hasWhitelist: null, transferPausable: null,
        taxModifiable: null,
        personalTaxModifiable: null, ownerCanChangeBalance: null,
        hiddenOwner: null, openSource: null, isProxy: null,
        buyTaxFraction: null, sellTaxFraction: null, transferTaxFraction: null,
        holderCount: null, dexLiquidityUsd: null,
    }
}

export function normalizeGoPlusTokenSecurity(
    value: unknown,
    expectedAddress: string,
    checkedAt = new Date().toISOString(),
): GoPlusTokenSecurity {
    const address = normalizeAddress(expectedAddress)
    if (!address || !isRecord(value)) return unavailableGoPlusSecurity(expectedAddress, checkedAt)
    return {
        provider: 'goplus', chainId: 56, address, available: true, checkedAt,
        isHoneypot: goPlusFlag(value.is_honeypot),
        cannotBuy: goPlusFlag(value.cannot_buy),
        cannotSellAll: goPlusFlag(value.cannot_sell_all),
        hasBlacklist: goPlusFlag(value.is_blacklisted),
        hasWhitelist: goPlusFlag(value.is_whitelisted),
        transferPausable: goPlusFlag(value.transfer_pausable),
        taxModifiable: goPlusFlag(value.slippage_modifiable),
        personalTaxModifiable: goPlusFlag(value.personal_slippage_modifiable),
        ownerCanChangeBalance: goPlusFlag(value.owner_change_balance),
        hiddenOwner: goPlusFlag(value.hidden_owner),
        openSource: goPlusFlag(value.is_open_source),
        isProxy: goPlusFlag(value.is_proxy),
        buyTaxFraction: decimalOrNull(value.buy_tax),
        sellTaxFraction: decimalOrNull(value.sell_tax),
        transferTaxFraction: decimalOrNull(value.transfer_tax),
        holderCount: decimalOrNull(value.holder_count),
        dexLiquidityUsd: sumDexLiquidity(value.dex),
    }
}

export async function getGoPlusTokenSecurityBatch(
    addresses: string[],
    signal?: AbortSignal,
) {
    const config = getApiConfig()
    const normalized = [...new Set(addresses
        .map(normalizeAddress)
        .filter((value): value is string => value !== null))]
    const output = new Map(normalized.map((address) => [
        address,
        unavailableGoPlusSecurity(address),
    ]))
    if (!config.goPlus.enabled || !config.goPlus.accessToken) return output

    for (const payload of await goPlusTokenSecurityRequests(normalized, signal)) {
        const result = isRecord(payload) && isRecord(payload.result)
            ? payload.result
            : null
        if (!result) continue
        for (const [rawAddress, value] of Object.entries(result)) {
            const address = normalizeAddress(rawAddress)
            if (!address || !output.has(address)) continue
            output.set(address, normalizeGoPlusTokenSecurity(value, address))
        }
    }
    return output
}

export async function getGoPlusTokenSecurity(
    address: string,
    signal?: AbortSignal,
) {
    const normalized = normalizeAddress(address)
    if (!normalized) return unavailableGoPlusSecurity(address)
    return (await getGoPlusTokenSecurityBatch([normalized], signal)).get(normalized) ??
        unavailableGoPlusSecurity(normalized)
}
