import { getApiConfig } from '../src/config.js'
import { closeDatabase, getPool } from '../src/db/client.js'
import { normalizeAddress } from '../src/lib/address.js'
import { createPrepaidChainClient } from '../src/gas-assist/prepaid/chain-client.js'
import { parseFixed } from '../src/gas-assist/prepaid/fixed-point.js'
import { getSponsorshipTokenEvidence } from '../src/gas-assist/prepaid/token-evidence.js'
import type { Address } from 'viem'

type Args = Record<string, string | boolean>

function parseArgs(values: string[]) {
    const args: Args = {}
    for (let index = 0; index < values.length; index += 1) {
        const item = values[index]!
        if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`)
        const name = item.slice(2)
        const next = values[index + 1]
        if (!next || next.startsWith('--')) args[name] = true
        else {
            args[name] = next
            index += 1
        }
    }
    return args
}

function required(args: Args, name: string) {
    const value = args[name]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} is required.`)
    return value.trim()
}

function integer(args: Args, name: string, fallback?: number) {
    const raw = args[name]
    if (raw === undefined && fallback !== undefined) return fallback
    const parsed = Number(raw)
    if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`)
    return parsed
}

async function verifyToken(args: Args, address: Address) {
    const chain = createPrepaidChainClient()
    const [code, onchainDecimals, evidence] = await Promise.all([
        chain.getCode(address),
        chain.getTokenDecimals(address),
        getSponsorshipTokenEvidence(address),
    ])
    if (!code || code === '0x') throw new Error('The token address has no deployed bytecode.')
    const suppliedDecimals = integer(args, 'decimals')
    if (suppliedDecimals !== onchainDecimals) throw new Error('Supplied decimals do not match the token contract.')
    if (!evidence.priceUsdMicros || evidence.liquidityUsdMicros <= 0n) {
        throw new Error('Trusted pricing and liquidity evidence are required.')
    }
    if (evidence.transferBehavior !== 'exact' || !['trusted', 'low'].includes(evidence.securityStatus)) {
        throw new Error('Token transfer behavior or security could not be proven safe.')
    }
    return { suppliedDecimals, evidence }
}

async function add(args: Args) {
    const chainId = integer(args, 'chain-id')
    if (chainId !== 56) throw new Error('Only --chain-id 56 is supported.')
    const address = normalizeAddress(required(args, 'token')) as Address | null
    if (!address) throw new Error('--token must be a valid address.')
    const symbol = required(args, 'symbol').toUpperCase()
    if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) throw new Error('--symbol is invalid.')
    const { suppliedDecimals, evidence } = await verifyToken(args, address)
    const config = getApiConfig().sponsorship
    const minimumLiquidity = parseFixed(String(args['minimum-liquidity-usd'] ?? config.minimumPaymentTokenLiquidityUsd))
    if (evidence.liquidityUsdMicros < minimumLiquidity) throw new Error('Observed liquidity is below the requested minimum.')
    await getPool().query(
        `INSERT INTO sponsorship_payment_tokens
         (chain_id,token_address,symbol,decimals,enabled,fee_payment_enabled,
          approval_sponsorship_enabled,normal_swap_sponsorship_enabled,is_stablecoin,
          payment_priority,minimum_liquidity_usd_micros,minimum_gross_trade_usd_micros,
          maximum_price_age_seconds,maximum_price_deviation_bps,exact_transfer_required,
          fee_on_transfer_allowed,rebasing_allowed,strict_security_required)
         VALUES (56,$1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,false,false,true)
         ON CONFLICT (chain_id,token_address) DO NOTHING`,
        [address, symbol, suppliedDecimals, args['fee-payment'] === true,
            args['approval-sponsorship'] === true, args['normal-swap-sponsorship'] === true,
            args.stablecoin === true, integer(args, 'priority', 0), minimumLiquidity.toString(),
            parseFixed(String(args['minimum-gross-trade-usd'] ?? config.minimumGrossTradeUsd)).toString(),
            integer(args, 'maximum-price-age-seconds', config.maximumPriceAgeSeconds),
            integer(args, 'maximum-price-deviation-bps', config.maximumPriceDeviationBps)],
    )
    console.log(`Added sponsorship token ${symbol} (${address}).`)
}

async function list() {
    const result = await getPool().query<{
        chainId: number
        tokenAddress: string
        symbol: string
        decimals: number
        enabled: boolean
        feePaymentEnabled: boolean
        approvalSponsorshipEnabled: boolean
        normalSwapSponsorshipEnabled: boolean
        isStablecoin: boolean
        paymentPriority: number
    }>(
        `SELECT chain_id AS "chainId",token_address AS "tokenAddress",symbol,decimals,enabled,
                fee_payment_enabled AS "feePaymentEnabled",
                approval_sponsorship_enabled AS "approvalSponsorshipEnabled",
                normal_swap_sponsorship_enabled AS "normalSwapSponsorshipEnabled",
                is_stablecoin AS "isStablecoin",payment_priority AS "paymentPriority"
         FROM sponsorship_payment_tokens ORDER BY payment_priority DESC,token_address`,
    )
    console.table(result.rows)
}

async function setEnabled(args: Args, enabled: boolean) {
    const address = normalizeAddress(required(args, 'token'))
    if (!address) throw new Error('--token must be a valid address.')
    const result = await getPool().query(
        `UPDATE sponsorship_payment_tokens SET enabled=$2,updated_at=now()
         WHERE chain_id=56 AND token_address=$1`,
        [address, enabled],
    )
    if (!result.rowCount) throw new Error('Sponsorship token was not found.')
    console.log(`${enabled ? 'Enabled' : 'Disabled'} sponsorship token ${address}.`)
}

async function remove(args: Args) {
    const address = normalizeAddress(required(args, 'token'))
    if (!address) throw new Error('--token must be a valid address.')
    const result = await getPool().query(
        `DELETE FROM sponsorship_payment_tokens WHERE chain_id=56 AND token_address=$1 AND enabled=false`,
        [address],
    )
    if (!result.rowCount) throw new Error('Disable the sponsorship token before removing it.')
    console.log(`Removed sponsorship token ${address}.`)
}

async function update(args: Args) {
    const address = normalizeAddress(required(args, 'token'))
    if (!address) throw new Error('--token must be a valid address.')
    const updates: string[] = []
    const values: unknown[] = [address]
    const set = (column: string, value: unknown) => {
        values.push(value)
        updates.push(`${column}=$${values.length}`)
    }
    if (args.priority !== undefined) set('payment_priority', integer(args, 'priority'))
    if (args['minimum-liquidity-usd'] !== undefined) set('minimum_liquidity_usd_micros', parseFixed(String(args['minimum-liquidity-usd'])).toString())
    if (args['maximum-price-age-seconds'] !== undefined) set('maximum_price_age_seconds', integer(args, 'maximum-price-age-seconds'))
    if (args['maximum-price-deviation-bps'] !== undefined) set('maximum_price_deviation_bps', integer(args, 'maximum-price-deviation-bps'))
    if (args.stablecoin !== undefined) set('is_stablecoin', args.stablecoin === true || args.stablecoin === 'true')
    if (args['fee-payment'] !== undefined) set('fee_payment_enabled', args['fee-payment'] === true || args['fee-payment'] === 'true')
    if (args['approval-sponsorship'] !== undefined) set('approval_sponsorship_enabled', args['approval-sponsorship'] === true || args['approval-sponsorship'] === 'true')
    if (args['normal-swap-sponsorship'] !== undefined) set('normal_swap_sponsorship_enabled', args['normal-swap-sponsorship'] === true || args['normal-swap-sponsorship'] === 'true')
    if (updates.length === 0) throw new Error('No supported update fields were supplied.')
    const result = await getPool().query(
        `UPDATE sponsorship_payment_tokens SET ${updates.join(',')},updated_at=now()
         WHERE chain_id=56 AND token_address=$1`,
        values,
    )
    if (!result.rowCount) throw new Error('Sponsorship token was not found.')
    console.log(`Updated sponsorship token ${address}.`)
}

const [command, ...rawArgs] = process.argv.slice(2)
const args = parseArgs(rawArgs)
try {
    if (command === 'add') await add(args)
    else if (command === 'list') await list()
    else if (command === 'enable') await setEnabled(args, true)
    else if (command === 'disable') await setEnabled(args, false)
    else if (command === 'remove') await remove(args)
    else if (command === 'update') await update(args)
    else throw new Error('Expected add, list, enable, disable, remove, or update.')
} finally {
    await closeDatabase()
}
