import type { Pool } from 'pg'
import {
    createPublicClient,
    http,
    isAddress,
    isAddressEqual,
    toHex,
    zeroAddress,
} from 'viem'
import { bsc } from 'viem/chains'

import { getApiConfig } from '../config.js'
import { getPool } from '../db/client.js'
import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from '../lib/address.js'
import { getTokenPrices } from '../providers/alchemy/token-prices.js'
import { getCoinGeckoToken } from '../providers/coingecko/token-data.js'
import { moralisWalletTokenService } from '../providers/moralis/wallet-token-spam.js'
import { tokenSecurityService } from '../providers/security/token-security.js'
import { GasAssistError } from './errors.js'
import { buildExactApproval, hashPrivateScope, parseAmountIn } from './exact-approval.js'
import { loadSwapIntent } from './intents.js'
import { paymasterClient } from './paymaster.js'
import { authorizeRule, loadExactSponsorRule } from './rules.js'

const erc20ReadAbi = [
    {
        type: 'function', name: 'balanceOf', stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
    },
    {
        type: 'function', name: 'allowance', stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        type: 'function', name: 'decimals', stateMutability: 'view',
        inputs: [], outputs: [{ type: 'uint8' }],
    },
] as const

let publicClient: ReturnType<typeof createPublicClient> | null = null
function getPublicClient() {
    if (publicClient) return publicClient
    const rpcUrl = getApiConfig().quotes.pancakeSwap.rpcUrl
    if (!rpcUrl) throw new GasAssistError('RPC_NOT_CONFIGURED', 'A BSC RPC is required for Gas Assist.', 503)
    publicClient = createPublicClient({ chain: bsc, transport: http(rpcUrl) })
    return publicClient
}

export type EligibilityInput = {
    chainId: number
    walletAddress: string
    tokenAddress: string
    amountIn: string
    swapIntentId: string
    clientIp: string
}

function normalizeInput(input: EligibilityInput) {
    const wallet = normalizeAddress(input.walletAddress)
    const token = normalizeAddress(input.tokenAddress)
    if (input.chainId !== 56) throw new GasAssistError('WRONG_CHAIN', 'Gas Assist supports only chain 56.')
    if (!wallet || wallet === zeroAddress) throw new GasAssistError('WALLET_NOT_ALLOWED', 'A valid nonzero wallet is required.')
    if (!token || token === zeroAddress || token === NATIVE_TOKEN_ADDRESS) {
        throw new GasAssistError('TOKEN_NOT_ALLOWED', 'Gas Assist supports exact ERC-20 token contracts only.')
    }
    if (typeof input.swapIntentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.swapIntentId)) {
        throw new GasAssistError('SWAP_INTENT_NOT_FOUND', 'A current swap intent is required.')
    }
    return {
        wallet: wallet as `0x${string}`,
        token: token as `0x${string}`,
        amount: parseAmountIn(input.amountIn),
    }
}

function decimalParts(value: string) {
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'A trusted token price is unavailable.', 503)
    const [whole, fraction = ''] = value.split('.')
    return {
        integer: BigInt(`${whole}${fraction}`),
        decimals: fraction.length,
    }
}

function assertApprovalUsdCap(amount: bigint, decimals: number, price: string) {
    const priceParts = decimalParts(price)
    const capParts = decimalParts(getApiConfig().gasAssist.maximumApprovalUsd)
    const valueSide =
        amount * priceParts.integer * 10n ** BigInt(capParts.decimals)
    const capSide =
        capParts.integer *
        10n ** BigInt(decimals + priceParts.decimals)
    if (valueSide > capSide) {
        throw new GasAssistError('MAXIMUM_APPROVAL_USD_EXCEEDED', 'The approval exceeds the Gas Assist USD cap.', 403)
    }
}

async function assertLimits(
    database: Pool,
    rule: Awaited<ReturnType<typeof loadExactSponsorRule>> & {},
    walletHash: string,
    ipHash: string,
    amount: bigint,
) {
    const result = await database.query<{
        walletCount: string
        ipCount: string
        ruleCount: string
        ruleAmount: string
    }>(
        `SELECT
           COALESCE(sum(sponsored_count) FILTER (WHERE wallet_address_hash=$2),0)::text AS "walletCount",
           COALESCE(sum(sponsored_count) FILTER (WHERE ip_hash=$3),0)::text AS "ipCount",
           COALESCE(sum(sponsored_count) FILTER (WHERE sponsor_rule_id=$4),0)::text AS "ruleCount",
           COALESCE(sum(sponsored_amount_base_units) FILTER (WHERE sponsor_rule_id=$4),0)::text AS "ruleAmount"
         FROM gas_assist_daily_usage WHERE usage_date=(now() at time zone 'utc')::date AND chain_id=$1`,
        [56, walletHash, ipHash, rule.id],
    )
    const usage = result.rows[0]!
    const config = getApiConfig().gasAssist
    if (BigInt(usage.walletCount) >= BigInt(config.dailyWalletLimit)) {
        throw new GasAssistError('WALLET_DAILY_LIMIT', 'The wallet Gas Assist daily limit has been reached.', 429)
    }
    if (BigInt(usage.ipCount) >= BigInt(config.dailyIpLimit)) {
        throw new GasAssistError('IP_DAILY_LIMIT', 'The Gas Assist network daily limit has been reached.', 429)
    }
    if (
        rule.maximumSponsorshipsPerDay !== null &&
        BigInt(usage.ruleCount) >= BigInt(rule.maximumSponsorshipsPerDay)
    ) {
        throw new GasAssistError('RULE_DAILY_LIMIT', 'The sponsor rule daily limit has been reached.', 429)
    }
    if (
        rule.maximumTotalAmountPerDayBaseUnits !== null &&
        BigInt(usage.ruleAmount) + amount > BigInt(rule.maximumTotalAmountPerDayBaseUnits)
    ) {
        throw new GasAssistError('RULE_DAILY_AMOUNT_LIMIT', 'The sponsor rule daily amount limit would be exceeded.', 429)
    }
}

export async function validateEligibility(
    input: EligibilityInput,
    options: { database?: Pool; checkPaymaster?: boolean } = {},
) {
    const config = getApiConfig()
    if (!config.gasAssist.enabled) throw new GasAssistError('GAS_ASSIST_DISABLED', 'Gas Assist is disabled.', 503)
    const database = options.database ?? getPool()
    const { wallet, token, amount } = normalizeInput(input)
    const spender = config.gasAssist.swapContractAddress as `0x${string}`

    const rule = authorizeRule(
        await loadExactSponsorRule(database, 56, wallet, token),
        amount,
    )
    if (config.gasAssist.allowedTokens.size > 0 && !config.gasAssist.allowedTokens.has(token)) {
        throw new GasAssistError('TOKEN_NOT_ALLOWED', 'This token is not in the backend Gas Assist safety list.', 403)
    }

    const intent = await loadSwapIntent(input.swapIntentId, database)
    if (!intent) throw new GasAssistError('SWAP_INTENT_NOT_FOUND', 'The swap intent was not found.', 404)
    if (intent.status !== 'active') throw new GasAssistError('SWAP_INTENT_INACTIVE', 'The swap intent is no longer active.', 409)
    if (intent.expiresAt <= new Date()) throw new GasAssistError('SWAP_INTENT_EXPIRED', 'The swap intent has expired.', 409)
    if (
        intent.chainId !== 56 ||
        intent.walletAddress !== wallet ||
        intent.sellTokenAddress !== token ||
        BigInt(intent.amountIn) !== amount
    ) {
        throw new GasAssistError('SWAP_INTENT_MISMATCH', 'The swap intent does not match this wallet, token, and amount.', 403)
    }
    if (
        !intent.routeExecutableThroughSwapContract ||
        !intent.swapContractAddress ||
        !isAddressEqual(intent.swapContractAddress as `0x${string}`, spender)
    ) {
        throw new GasAssistError(
            'SWAP_INTENT_NOT_CUSTOM_CONTRACT',
            'The current quote does not execute through the configured PistachioSwap contract.',
            409,
        )
    }

    const client = getPublicClient()
    const [tokenCode, spenderCode, balance, allowance, decimals, nativeBalance] = await Promise.all([
        client.getCode({ address: token }),
        client.getCode({ address: spender }),
        client.readContract({ address: token, abi: erc20ReadAbi, functionName: 'balanceOf', args: [wallet] }),
        client.readContract({ address: token, abi: erc20ReadAbi, functionName: 'allowance', args: [wallet, spender] }),
        client.readContract({ address: token, abi: erc20ReadAbi, functionName: 'decimals' }),
        client.getBalance({ address: wallet }),
    ])
    if (!tokenCode || tokenCode === '0x') throw new GasAssistError('TOKEN_NOT_CONTRACT', 'The token contract has no bytecode.')
    if (!spenderCode || spenderCode === '0x') throw new GasAssistError('SWAP_CONTRACT_NOT_DEPLOYED', 'The configured PistachioSwap contract has no bytecode.', 503)
    if (balance < amount) throw new GasAssistError('INSUFFICIENT_TOKEN_BALANCE', 'The wallet token balance is below the swap amount.')
    if (allowance >= amount) return { status: 'already-approved' as const, rule, intent }

    const data = buildExactApproval(spender, amount)
    let gasEstimate: bigint
    try {
        gasEstimate = await client.estimateGas({ account: wallet, to: token, data, value: 0n })
    } catch {
        if (allowance > 0n) throw new GasAssistError('ALLOWANCE_RESET_REQUIRED', 'This token may require resetting its current allowance to zero.')
        throw new GasAssistError('GAS_ESTIMATION_FAILED', 'Normal approval gas could not be estimated safely.', 503)
    }
    const gasLimit = (gasEstimate * 120n + 99n) / 100n
    if (gasLimit > BigInt(config.gasAssist.maximumGasLimit)) {
        throw new GasAssistError('GAS_LIMIT_EXCEEDED', 'The approval gas estimate exceeds the sponsor cap.', 403)
    }
    const gasPrice = await client.getGasPrice()
    if (nativeBalance >= gasLimit * gasPrice) {
        return { status: 'normal-approval-required' as const, rule, intent }
    }

    const [security, moralis, coinGecko, prices] = await Promise.all([
        tokenSecurityService.refresh(token),
        moralisWalletTokenService.getWalletTokens(wallet),
        getCoinGeckoToken(token),
        getTokenPrices({ addresses: [token] }),
    ])
    const moralisToken = moralis.tokens.get(token)
    if (moralisToken?.possibleSpam === true) throw new GasAssistError('TOKEN_POSSIBLE_SPAM', 'Possible-spam tokens cannot use Gas Assist.', 403)
    if (security.securityStatus === 'high' || security.securityStatus === 'blocked') {
        throw new GasAssistError('TOKEN_SECURITY_BLOCKED', 'High-risk or blocked tokens cannot use Gas Assist.', 403)
    }
    if (security.securityStatus === 'unknown') {
        throw new GasAssistError('TOKEN_SECURITY_UNKNOWN', 'Token security could not be established.', 503)
    }
    if (config.walletTokens.blocklist.has(token)) {
        throw new GasAssistError('TOKEN_MANUALLY_BLOCKED', 'This token is manually blocked.', 403)
    }
    if (!coinGecko && moralisToken?.verifiedContract !== true) {
        throw new GasAssistError('TOKEN_NOT_RECOGNIZED', 'Only exact-address recognized tokens can use Gas Assist.', 403)
    }
    const trustedPrice = prices.get(token) ?? coinGecko?.priceUSD ?? null
    if (!trustedPrice) throw new GasAssistError('TRUSTED_PRICE_UNAVAILABLE', 'A trusted token price is unavailable.', 503)
    assertApprovalUsdCap(amount, Number(decimals), trustedPrice)

    const secret = config.gasAssist.ipHashSecret as string
    const walletHash = hashPrivateScope(secret, wallet)
    const ipHash = hashPrivateScope(secret, input.clientIp)
    await assertLimits(database, rule, walletHash, ipHash, amount)

    const nonce = await client.getTransactionCount({ address: wallet, blockTag: 'pending' })
    const transaction = {
        chainId: 56 as const,
        from: wallet,
        to: token,
        data,
        value: '0x0' as const,
        gas: toHex(gasLimit),
        nonce: toHex(nonce),
        gasPrice: '0x0' as const,
    }
    if (options.checkPaymaster !== false) {
        const sponsorable = await paymasterClient.isSponsorable({
            from: transaction.from,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            gas: transaction.gas,
        })
        if (!sponsorable) throw new GasAssistError('PAYMASTER_NOT_SPONSORABLE', 'The paymaster declined this exact approval.', 409)
    }
    return {
        status: 'sponsorable' as const,
        rule,
        intent,
        transaction,
        amount,
        gasLimit,
        walletHash,
        ipHash,
    }
}

export function validateEligibilityQuery(value: unknown): EligibilityInput {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const allowed = new Set([
        'chainId', 'walletAddress', 'tokenAddress', 'amountIn', 'swapIntentId',
    ])
    if (Object.keys(record).some((key) => !allowed.has(key))) {
        throw new GasAssistError('UNSAFE_REQUEST_FIELD', 'The request contains a field Gas Assist does not accept.')
    }
    const chainId = Number(record.chainId)
    const walletAddress = String(record.walletAddress ?? '')
    const tokenAddress = String(record.tokenAddress ?? '')
    const amountIn = String(record.amountIn ?? '')
    const swapIntentId = String(record.swapIntentId ?? '')
    if (!isAddress(walletAddress) || !isAddress(tokenAddress)) {
        throw new GasAssistError('INVALID_ADDRESS', 'Valid wallet and token addresses are required.')
    }
    return { chainId, walletAddress, tokenAddress, amountIn, swapIntentId, clientIp: '' }
}
