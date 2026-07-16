import { getApiConfig } from '../src/config.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../src/lib/address.js'
import { ZERO_X_NATIVE_TOKEN_ADDRESS, normalizeProviderToken } from '../src/providers/quotes/provider-token.js'
import { buildGaslessQuery, type GaslessRequest } from '../src/providers/zero-x/gasless-client.js'
import { getTokenDecimalsBatch } from '../src/providers/token-decimals.js'
import { getTokenPrices } from '../src/providers/alchemy/token-prices.js'
import { gaslessInternals } from '../src/gas-assist/gasless-service.js'
import { createPublicClient, http } from 'viem'
import { bsc } from 'viem/chains'

const CHAIN_ID = 56 as const
const DEFAULT_TAKER = '0xe448af520b5a16293321cf0251c97fd4a1486ce0'
const XAUT = '0x21caef8a43163eea865baee23b9c2e327696a3bf'
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const ZEROX_API_KEY_FIELDS = /api.?key|authorization|headers?|credentials?|password|database(?:url)?|signature|private.?key/i
const HIDDEN_FIELDS = /^(eip712|typeddata|data|signature)$/i

type Endpoint = 'gasless-price' | 'gasless-quote' | 'normal-price'

function arg(name: string) {
    const prefix = `--${name}=`
    return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function required(name: string) {
    const value = arg(name)
    if (!value) throw new Error(`Missing --${name}=...`)
    return value
}

function parseEndpoint(value: string): Endpoint {
    if (value === 'gasless-price' || value === 'gasless-quote' || value === 'normal-price') return value
    throw new Error(`Unsupported endpoint: ${value}`)
}

function parseAmount(value: string, decimals: number) {
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Amount must be a non-negative decimal number.')
    const [whole, fraction = ''] = value.split('.')
    if (fraction.length > decimals) throw new Error(`Amount has more than ${decimals} token decimals.`)
    return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')).toString()
}

function sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !ZEROX_API_KEY_FIELDS.test(key) && !HIDDEN_FIELDS.test(key))
        .map(([key, child]) => [key, sanitize(child)]))
}

function field(body: unknown, name: string): unknown {
    if (!body || typeof body !== 'object') return undefined
    const record = body as Record<string, unknown>
    return record[name] ?? (record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>)[name] : undefined)
}

async function egress() {
    try {
        const response = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) })
        const body = await response.json() as Record<string, unknown>
        let countryName: unknown = null
        try {
            const country = await fetch(`https://restcountries.com/v3.1/alpha/${encodeURIComponent(String(body.country ?? ''))}`, { signal: AbortSignal.timeout(3000) })
            const countryBody = await country.json() as { name?: { common?: string } }
            countryName = countryBody.name?.common ?? null
        } catch { /* country name is optional */ }
        return { ip: body.ip ?? null, countryCode: body.country ?? null, countryName, organization: body.org ?? null }
    } catch {
        return null
    }
}

async function feeFields(rawSellAmount: string, decimals: number, sellToken: string, fees: boolean) {
    if (!fees) return { feesEnabled: false, feeRecipient: null, feeBps: null, feeToken: null }
    const prices = await getTokenPrices({ addresses: [sellToken] })
    const sellPrice = prices.get(sellToken)
    if (!sellPrice) throw new Error(`Cannot calculate production fee: no trusted price for ${sellToken}.`)
    const plan = gaslessInternals.calculateFeePlan(rawSellAmount, decimals, sellPrice, getApiConfig().gasAssist)
    return {
        feesEnabled: true,
        feeRecipient: getApiConfig().fees.treasuryAddress,
        feeBps: plan.dynamicFeeBps,
        feeToken: sellToken,
        feeSummary: gaslessInternals.publicFee(plan),
    }
}

async function main() {
    const endpoint = parseEndpoint(required('endpoint'))
    const taker = normalizeAddress(required('taker'))
    const sellToken = normalizeAddress(required('sell-token'))
    const buyArgument = required('buy-token')
    const buyTokenInternal = buyArgument === 'native' ? NATIVE_TOKEN_ADDRESS : normalizeAddress(buyArgument)
    const humanAmount = required('amount')
    const fees = required('fees')
    if (!taker || !sellToken || !buyTokenInternal || (fees !== 'on' && fees !== 'off')) throw new Error('Invalid address or fees argument.')
    let decimals = sellToken === NATIVE_TOKEN_ADDRESS ? 18 : (await getTokenDecimalsBatch({ addresses: [sellToken] })).get(sellToken)
    if (decimals === null || decimals === undefined) {
        const rpcUrl = getApiConfig().quotes.pancakeSwap.rpcUrl
        if (rpcUrl) {
            const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) })
            decimals = Number(await client.readContract({
                address: sellToken as `0x${string}`,
                abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
                functionName: 'decimals',
            }))
        }
    }
    if (decimals === null || decimals === undefined) throw new Error(`Could not resolve decimals for ${sellToken}.`)
    const rawSellAmount = parseAmount(humanAmount, decimals)
    const buyToken = buyTokenInternal === NATIVE_TOKEN_ADDRESS ? ZERO_X_NATIVE_TOKEN_ADDRESS : normalizeProviderToken({ chainId: CHAIN_ID, address: buyTokenInternal, isNative: false }).zeroX
    const fee = await feeFields(rawSellAmount, decimals, sellToken, fees === 'on')
    const request: GaslessRequest = {
        chainId: CHAIN_ID, sellToken, buyToken, sellAmount: rawSellAmount, taker, recipient: taker,
        ...(fee.feeBps ? { swapFeeRecipient: fee.feeRecipient!, swapFeeBps: fee.feeBps, swapFeeToken: fee.feeToken! } : {}),
    }
    const sellTokenSymbol = sellToken === XAUT ? 'XAUT' : sellToken === USDT ? 'USDT' : 'unknown'
    const fingerprint = { endpoint, chainId: CHAIN_ID, taker, sellToken, sellTokenSymbol, buyToken, buyTokenSymbol: buyToken === ZERO_X_NATIVE_TOKEN_ADDRESS ? 'BNB' : 'token', humanAmount, rawSellAmount, ...fee }
    console.log(JSON.stringify({ type: 'request-fingerprint', ...fingerprint }, null, 2))

    const config = getApiConfig()
    const url = new URL(`${config.quotes.zeroX.baseUrl}/${endpoint === 'normal-price' ? 'swap/allowance-holder/price' : `gasless/${endpoint === 'gasless-price' ? 'price' : 'quote'}`}`)
    if (endpoint === 'normal-price') {
        url.searchParams.set('chainId', String(CHAIN_ID)); url.searchParams.set('sellToken', sellToken); url.searchParams.set('buyToken', buyToken)
        url.searchParams.set('sellAmount', rawSellAmount); url.searchParams.set('taker', taker)
    } else {
        for (const [key, value] of new URLSearchParams(buildGaslessQuery(request))) url.searchParams.set(key, value)
    }
    const response = await fetch(url, { headers: { '0x-api-key': config.quotes.zeroX.apiKey!, '0x-version': 'v2' }, signal: AbortSignal.timeout(config.quotes.timeoutMs) })
    const text = await response.text()
    let body: unknown
    try { body = sanitize(JSON.parse(text)) } catch { body = text.replace(config.quotes.zeroX.apiKey ?? '', '[REDACTED]') }
    const summary = {
        type: 'provider-response', endpoint, httpStatus: response.status, statusText: response.statusText, body,
        errorName: field(body, 'name') ?? field(body, 'reason') ?? field(body, 'code') ?? null, message: field(body, 'message') ?? null,
        zid: field(body, 'zid') ?? null, liquidityAvailable: field(body, 'liquidityAvailable') ?? null,
        issues: field(body, 'issues') ?? null, buyAmount: field(body, 'buyAmount') ?? null,
        minimumBuyAmount: field(body, 'minBuyAmount') ?? null, approvalAvailability: Boolean(field(body, 'approval')),
        tradeAvailability: Boolean(field(body, 'trade')), feeSummary: field(body, 'fees') ?? fee.feeSummary ?? null,
    }
    console.log(JSON.stringify(summary, null, 2))
    if (!response.ok || summary.errorName) process.exitCode = 1
}

const location = await egress()
console.log(JSON.stringify({ type: 'egress', location }, null, 2))
main().catch((error) => { console.error(JSON.stringify({ type: 'diagnostic-error', message: error instanceof Error ? error.message : String(error) }, null, 2)); process.exitCode = 1 })
