import { createPublicClient, http } from 'viem'
import { bsc } from 'viem/chains'

import { getApiConfig } from '../config.js'
import { checkDatabase, getPool } from '../db/client.js'

export async function assertGasAssistReady() {
    const config = getApiConfig()
    if (config.gasAssist.mode === 'disabled') return
    await checkDatabase()
    if (config.gasAssist.mode === 'zero-x-gasless') return
    const rules = await getPool().query<{ count: string }>(
        `SELECT count(*)::text AS count FROM gas_assist_sponsor_rules
         WHERE chain_id=56 AND enabled=true AND (expires_at IS NULL OR expires_at > now())`,
    )
    if (BigInt(rules.rows[0]?.count ?? '0') === 0n) {
        throw new Error('Gas Assist readiness failed: no active sponsor rules.')
    }
    const rpcUrl = config.quotes.pancakeSwap.rpcUrl
    if (!rpcUrl) throw new Error('Gas Assist readiness failed: BSC_RPC_URL is required.')
    const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) })
    const code = await client.getCode({
        address: config.gasAssist.swapContractAddress as `0x${string}`,
    })
    if (!code || code === '0x') {
        throw new Error('Gas Assist readiness failed: swap contract has no bytecode on chain 56.')
    }
}
