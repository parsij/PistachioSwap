import { normalizeAddress } from '../../lib/address.js'
import { isRecord } from '../../lib/http.js'
import { honeypotRequest } from './honeypot-client.js'
import type {
    HoneypotFlag,
    HoneypotRisk,
    HoneypotTokenSecurity,
} from './types.js'

function booleanOrNull(value: unknown) {
    return typeof value === 'boolean' ? value : null
}

function numberOrNull(value: unknown) {
    const parsed = Number(value)
    return value !== null && value !== '' && Number.isFinite(parsed)
        ? parsed
        : null
}

function decimalOrNull(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const text = String(value).trim().replace(/%$/, '')
    return /^\d+(?:\.\d+)?$/.test(text) ? text : null
}

function textOrNull(value: unknown, maximum = 240) {
    return typeof value === 'string' && value.trim()
        ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
        : null
}

function normalizeRisk(value: unknown): HoneypotRisk {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[ -]+/g, '_')
    return new Set([
        'very_low', 'low', 'medium', 'high', 'very_high', 'honeypot',
    ]).has(normalized)
        ? normalized as HoneypotRisk
        : 'unknown'
}

function normalizeFlags(value: unknown): HoneypotFlag[] {
    if (!Array.isArray(value)) return []
    return value
        .filter(isRecord)
        .slice(0, 50)
        .map((flag) => ({
            code: textOrNull(flag.flag ?? flag.code ?? flag.name, 100) ?? 'unknown',
            severity: textOrNull(flag.severity, 40),
            description: textOrNull(flag.description, 240),
        }))
}

function countHolderResults(value: unknown, patterns: RegExp[]) {
    if (!Array.isArray(value)) return null
    let count = 0
    for (const item of value) {
        if (!isRecord(item)) continue
        const text = [item.status, item.reason, item.error, item.label]
            .filter((field): field is string => typeof field === 'string')
            .join(' ')
        if (patterns.some((pattern) => pattern.test(text))) count += 1
    }
    return count
}

export function unavailableHoneypotSecurity(
    address: string,
    checkedAt = new Date().toISOString(),
): HoneypotTokenSecurity {
    return {
        provider: 'honeypot', chainId: 56, address, available: false, checkedAt,
        risk: 'unknown', riskLevel: null, isHoneypot: null,
        honeypotReason: null, simulationSuccess: null,
        buyTaxPercent: null, sellTaxPercent: null, transferTaxPercent: null,
        holderFailureCount: null, holderSiphonedCount: null,
        contractOpenSource: null, rootContractOpenSource: null, isProxy: null,
        liquidityUsd: null, pairAddress: null, flags: [],
    }
}

export function normalizeHoneypotTokenSecurity(
    payload: unknown,
    expectedAddress: string,
    checkedAt = new Date().toISOString(),
): HoneypotTokenSecurity {
    const address = normalizeAddress(expectedAddress)
    if (!address || !isRecord(payload)) return unavailableHoneypotSecurity(expectedAddress, checkedAt)
    if (!['token', 'summary', 'honeypotResult', 'simulationResult', 'contractCode', 'pair']
        .some((field) => isRecord(payload[field]))) {
        return unavailableHoneypotSecurity(address, checkedAt)
    }

    const returnedToken = isRecord(payload.token)
        ? normalizeAddress(payload.token.address)
        : null
    if (returnedToken && returnedToken !== address) {
        return unavailableHoneypotSecurity(address, checkedAt)
    }

    const summary = isRecord(payload.summary) ? payload.summary : {}
    const honeypot = isRecord(payload.honeypotResult) ? payload.honeypotResult : {}
    const simulation = isRecord(payload.simulationResult) ? payload.simulationResult : {}
    const contract = isRecord(payload.contractCode) ? payload.contractCode : {}
    const pair = isRecord(payload.pair) ? payload.pair : {}
    const holderAnalysis = isRecord(payload.holderAnalysis) ? payload.holderAnalysis : {}
    const holderResults = holderAnalysis.holders ?? holderAnalysis.results

    return {
        provider: 'honeypot', chainId: 56, address, available: true, checkedAt,
        risk: normalizeRisk(summary.risk),
        riskLevel: numberOrNull(summary.riskLevel),
        isHoneypot: booleanOrNull(honeypot.isHoneypot),
        honeypotReason: textOrNull(honeypot.honeypotReason ?? honeypot.reason),
        simulationSuccess: booleanOrNull(simulation.success),
        buyTaxPercent: decimalOrNull(simulation.buyTax),
        sellTaxPercent: decimalOrNull(simulation.sellTax),
        transferTaxPercent: decimalOrNull(simulation.transferTax),
        holderFailureCount: numberOrNull(holderAnalysis.failed) ??
            countHolderResults(holderResults, [/fail/i, /unable/i]),
        holderSiphonedCount: numberOrNull(holderAnalysis.siphoned) ??
            countHolderResults(holderResults, [/siphon/i, /drain/i]),
        contractOpenSource: booleanOrNull(contract.openSource),
        rootContractOpenSource: booleanOrNull(contract.rootOpenSource),
        isProxy: booleanOrNull(contract.isProxy),
        liquidityUsd: decimalOrNull(pair.liquidity ?? pair.liquidityUsd),
        pairAddress: normalizeAddress(pair.pairAddress ?? pair.address),
        flags: normalizeFlags(Array.isArray(summary.flags) ? summary.flags : payload.flags),
    }
}

export async function getHoneypotTokenSecurity(
    address: string,
    signal?: AbortSignal,
) {
    const payload = await honeypotRequest({ chainId: 56, address, signal })
    return payload === null
        ? unavailableHoneypotSecurity(address)
        : normalizeHoneypotTokenSecurity(payload, address)
}
