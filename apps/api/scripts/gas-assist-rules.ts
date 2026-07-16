import { isAddress, zeroAddress } from 'viem'

import { getPool } from '../src/db/client.js'
import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'

const [command, ...rawArgs] = process.argv.slice(2)
const args = new Map<string, string>()
for (let index = 0; index < rawArgs.length; index += 2) {
    const key = rawArgs[index]
    const value = rawArgs[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
        throw new Error('Arguments must use --name value pairs.')
    }
    args.set(key.slice(2), value)
}

function required(name: string) {
    const value = args.get(name)?.trim()
    if (!value) throw new Error(`--${name} is required.`)
    return value
}

function address(name: string) {
    const value = required(name).toLowerCase()
    if (!isAddress(value) || value === zeroAddress) {
        throw new Error(`--${name} must be a nonzero EVM address.`)
    }
    return value
}

function positiveInteger(name: string, optional = false) {
    const value = args.get(name)?.trim()
    if (!value && optional) return null
    if (!value || !/^[1-9]\d*$/.test(value)) {
        throw new Error(`--${name} must be a positive integer string.`)
    }
    return value
}

function chainId() {
    const value = Number(required('chain-id'))
    if (value !== 56) throw new Error('--chain-id must be 56.')
    return value
}

const pool = getPool()
try {
    if (command === 'add') {
        const chain = chainId()
        const wallet = address('wallet')
        const token = address('token')
        if (token === NATIVE_TOKEN_ADDRESS) throw new Error('Native BNB cannot be a sponsor rule token.')
        const minimum = positiveInteger('minimum-amount-base-units') as string
        const maximum = positiveInteger('maximum-amount-base-units', true)
        if (maximum && BigInt(maximum) < BigInt(minimum)) {
            throw new Error('--maximum-amount-base-units cannot be below the minimum.')
        }
        const expiry = args.get('expires-at')
        if (expiry && !Number.isFinite(Date.parse(expiry))) throw new Error('--expires-at must be ISO-8601.')
        const maxCount = positiveInteger('maximum-sponsorships-per-day', true)
        const maxTotal = positiveInteger('maximum-total-amount-per-day-base-units', true)
        await pool.query(
            `INSERT INTO gas_assist_sponsor_rules (
               chain_id, wallet_address, token_address, minimum_amount_base_units,
               maximum_amount_base_units, expires_at, maximum_sponsorships_per_day,
               maximum_total_amount_per_day_base_units
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [chain, wallet, token, minimum, maximum, expiry ?? null, maxCount, maxTotal],
        )
        console.log('Gas Assist sponsor rule added.')
    } else if (command === 'list') {
        const chain = chainId()
        const wallet = args.has('wallet') ? address('wallet') : null
        const result = await pool.query(
            `SELECT id, chain_id, wallet_address, token_address,
                    minimum_amount_base_units::text, maximum_amount_base_units::text,
                    enabled, expires_at, maximum_sponsorships_per_day,
                    maximum_total_amount_per_day_base_units::text
             FROM gas_assist_sponsor_rules
             WHERE chain_id = $1 AND ($2::text IS NULL OR wallet_address = $2)
             ORDER BY wallet_address, token_address`,
            [chain, wallet],
        )
        console.table(result.rows)
    } else if (['enable', 'disable', 'remove'].includes(command ?? '')) {
        const chain = chainId()
        const wallet = address('wallet')
        const token = address('token')
        const result = command === 'remove'
            ? await pool.query(
                'DELETE FROM gas_assist_sponsor_rules WHERE chain_id=$1 AND wallet_address=$2 AND token_address=$3',
                [chain, wallet, token],
            )
            : await pool.query(
                `UPDATE gas_assist_sponsor_rules SET enabled=$4, updated_at=now()
                 WHERE chain_id=$1 AND wallet_address=$2 AND token_address=$3`,
                [chain, wallet, token, command === 'enable'],
            )
        if (!result.rowCount) throw new Error('Exact sponsor rule not found.')
        console.log(`Gas Assist sponsor rule ${command}d.`)
    } else {
        throw new Error('Command must be add, list, enable, disable, or remove.')
    }
} finally {
    await pool.end()
}
