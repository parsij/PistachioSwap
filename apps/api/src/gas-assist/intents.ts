import type { Pool } from 'pg'

import { getApiConfig } from '../config.js'
import { getPool } from '../db/client.js'
import type {
    NormalizedQuote,
    QuoteRequest,
} from '../providers/quotes/types.js'

export type SwapIntent = {
    id: string
    chainId: number
    walletAddress: string
    sellTokenAddress: string
    buyTokenAddress: string
    amountIn: string
    swapContractAddress: string | null
    providerQuoteId: string
    routeExecutableThroughSwapContract: boolean
    status: string
    expiresAt: Date
}

export async function persistSwapIntent(
    request: QuoteRequest,
    quote: NormalizedQuote,
    database?: Pool,
) {
    const config = getApiConfig().gasAssist
    if (config.mode !== 'megafuel-legacy' || !config.swapContractAddress) return null
    const activeDatabase = database ?? getPool()
    const swapContract = config.swapContractAddress
    const routeExecutableThroughSwapContract =
        quote.allowanceTarget === swapContract &&
        quote.transaction.to === swapContract &&
        quote.transaction.value === '0'
    const expiresAt = new Date(quote.expiresAt)
    const result = await activeDatabase.query<{ id: string }>(
        `INSERT INTO gas_assist_swap_intents (
           chain_id, wallet_address, sell_token_address, buy_token_address,
           amount_in, swap_contract_address, provider_quote_id,
           route_executable_through_swap_contract, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
            request.chainId,
            request.takerAddress,
            request.sellToken,
            request.buyToken,
            request.sellAmount,
            swapContract,
            quote.quoteId,
            routeExecutableThroughSwapContract,
            expiresAt,
        ],
    )
    return {
        id: result.rows[0]!.id,
        compatible: routeExecutableThroughSwapContract,
    }
}

export async function loadSwapIntent(id: string, database: Pool = getPool()) {
    const result = await database.query<SwapIntent>(
        `SELECT id, chain_id AS "chainId", wallet_address AS "walletAddress",
                sell_token_address AS "sellTokenAddress",
                buy_token_address AS "buyTokenAddress", amount_in::text AS "amountIn",
                swap_contract_address AS "swapContractAddress",
                provider_quote_id AS "providerQuoteId",
                route_executable_through_swap_contract AS "routeExecutableThroughSwapContract",
                status, expires_at AS "expiresAt"
         FROM gas_assist_swap_intents WHERE id=$1 LIMIT 1`,
        [id],
    )
    return result.rows[0] ?? null
}
