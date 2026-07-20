import {
    createWalletClient,
    custom,
    formatUnits,
    getAddress,
    isAddress,
    isHex,
} from 'viem'
import { sendTransaction } from 'viem/actions'
import {
    getAccount,
    waitForTransactionReceipt,
} from 'wagmi/actions'
import { multiplyUsdAmount } from '../../../services/fiatValue.js'
import { withPreparedSourceGasCosts } from './crossChainRoutes.js'

const CHAIN_STATE_TIMEOUT_MS = 10_000
const CHAIN_STATE_POLL_MS = 100

/**
 * Estimates source gas/cost for the already validated prepared route.
 * @param {object} input Public client, prepared route, account, native balance/price/decimals, and diagnostic callback.
 * @returns {Promise<object>} Normalized costs plus native-gas sufficiency.
 * @throws When the prepared transaction or RPC estimate is invalid/unavailable.
 * @sideEffects Performs RPC gas/fee reads; never prompts or submits through a wallet.
 */
export async function estimatePreparedCrossChainCosts({
    publicClient,
    preparedRoute,
    account,
    nativeBalanceWei,
    nativePriceUsd,
    nativeDecimals = 18,
    now = Date.now,
    onDiagnostic,
}) {
    if (!publicClient || typeof publicClient.estimateGas !== 'function') {
        throw new Error('Source gas estimate unavailable')
    }
    const startedAt = now()
    const sourceChainId = Number(preparedRoute?.sourceAsset?.chainId)
    const nativeInput = String(preparedRoute?.sourceAsset?.address ?? '').toLowerCase() ===
        '0x0000000000000000000000000000000000000000'
    const steps = (preparedRoute?.steps ?? []).filter((step) =>
        Number(step.chainId) === sourceChainId &&
        step.transaction &&
        ['approval', 'source-transaction'].includes(step.type) &&
        !(nativeInput && step.type === 'approval'),
    )
    if (!steps.some((step) => step.type === 'source-transaction')) {
        throw new Error('The prepared route has no source transaction to estimate.')
    }

    const gasResults = await Promise.all(steps.map(async (step) => {
        const transaction = step.transaction
        try {
            const gas = await publicClient.estimateGas({
                account,
                to: transaction.to,
                data: transaction.data ?? '0x',
                value: transaction.value == null ? 0n : BigInt(transaction.value),
            })
            return { gas, source: 'client' }
        } catch (error) {
            // A deposit that depends on a preceding approval cannot always be
            // simulated against current state. Relay's prepared estimate is
            // metadata only and is never forwarded as a wallet gas limit.
            if (transaction.gasEstimate && /^\d+$/.test(transaction.gasEstimate) &&
                BigInt(transaction.gasEstimate) > 0n) {
                return {
                    gas: BigInt(transaction.gasEstimate),
                    source: 'prepared-fallback',
                }
            }
            throw error
        }
    }))
    const gasEstimates = gasResults.map(({ gas }) => gas)
    const gasEstimateSources = gasResults.map(({ source }) => source)
    const totalGas = gasEstimates.reduce((sum, gas) => sum + BigInt(gas), 0n)
    let effectiveGasPrice
    try {
        const fees = await publicClient.estimateFeesPerGas()
        effectiveGasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? null
    } catch {
        effectiveGasPrice = null
    }
    if (effectiveGasPrice === null || effectiveGasPrice === undefined) {
        effectiveGasPrice = await publicClient.getGasPrice()
    }
    const totalSourceGasWei = totalGas * BigInt(effectiveGasPrice)
    const sourceGasNative = formatUnits(totalSourceGasWei, nativeDecimals)
    // This is display pricing only. It never participates in route validation,
    // transaction construction, or any trusted security-price decision.
    const sourceGasUsd = nativePriceUsd
        ? multiplyUsdAmount(sourceGasNative, nativePriceUsd)
        : null
    const costs = withPreparedSourceGasCosts(preparedRoute.costs, {
        sourceGasNative,
        sourceGasUsd,
    })
    const sufficientNativeGas = nativeBalanceWei === null || nativeBalanceWei === undefined
        ? null
        : BigInt(nativeBalanceWei) >= totalSourceGasWei
    onDiagnostic?.({
        provider: preparedRoute.provider,
        routeIdSuffix: String(preparedRoute.publicRouteId ?? '').slice(-8) || null,
        confidence: 'prepared',
        sourceGasEstimated: true,
        providerFeeAvailable: costs.providerFeeUsd !== null,
        destinationGasAvailable: costs.destinationGasUsd !== null,
        sponsoredAvailable: costs.sponsoredUsd !== null,
        totalAvailable: costs.totalEstimatedUsd !== null,
        estimationDurationMs: Math.max(0, now() - startedAt),
    })
    return {
        costs,
        totalGas,
        effectiveGasPrice: BigInt(effectiveGasPrice),
        totalSourceGasWei,
        sufficientNativeGas,
        estimatedStepCount: steps.length,
        gasEstimateSources,
    }
}

export class CrossChainExecutionError extends Error {
    constructor(phase, message, cause) {
        super(message, { cause })
        this.name = 'CrossChainExecutionError'
        this.phase = phase
    }
}

function executionError(phase, message, cause, onPhase, metadata) {
    onPhase?.(phase, metadata, cause)
    return new CrossChainExecutionError(phase, message, cause)
}

function accountAddress(value) {
    try {
        return getAddress(value)
    } catch {
        return null
    }
}

export async function waitForSourceChain({
    config,
    sourceChainId,
    timeoutMs = CHAIN_STATE_TIMEOUT_MS,
    getAccountState = getAccount,
    now = Date.now,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
    const deadline = now() + timeoutMs
    do {
        const account = getAccountState(config)
        if (Number(account.chainId) === Number(sourceChainId)) return account
        await sleep(CHAIN_STATE_POLL_MS)
    } while (now() < deadline)
    throw new Error('Wagmi did not report the requested source chain in time.')
}

export function createConnectorWalletClient({
    account,
    chain,
    provider,
    createClient = createWalletClient,
    createTransport = custom,
}) {
    if (!provider || typeof provider.request !== 'function') {
        throw new Error('The active connector did not provide an EIP-1193 provider.')
    }
    return createClient({
        account,
        chain,
        transport: createTransport(provider),
    })
}

/**
 * Resolves the connected connector/provider/wallet client on the required source chain.
 * @param {object} input Wagmi config, connected address, source/destination chains, switch callback, and phase logger.
 * @returns {Promise<object>} Validated connector/provider/wallet client tuple.
 * @throws {CrossChainExecutionError} For chain switching/provider/client/account failures.
 * @sideEffects May request a network switch; does not submit a transaction.
 */
export async function resolveCurrentCrossChainWallet({
    config,
    connectedAddress,
    sourceChain,
    destinationChainId = null,
    switchNetwork,
    onPhase,
    getAccountState = getAccount,
    createClient = createWalletClient,
    createTransport = custom,
}) {
    const baseMetadata = {
        sourceChainId: sourceChain.id,
        destinationChainId,
    }
    let account = getAccountState(config)
    if (Number(account.chainId) !== Number(sourceChain.id)) {
        onPhase?.('switch-chain', baseMetadata)
        try {
            await switchNetwork(sourceChain)
            account = await waitForSourceChain({
                config,
                sourceChainId: sourceChain.id,
                getAccountState,
            })
        } catch (error) {
            throw executionError(
                'switch-chain',
                `Switch to ${sourceChain.name} to continue.`,
                error,
                onPhase,
                baseMetadata,
            )
        }
    }

    onPhase?.('resolve-connector', baseMetadata)
    const connector = account.connector
    if (!connector || typeof connector.getProvider !== 'function') {
        const cause = new Error('The active Wagmi account has no connector provider.')
        throw executionError(
            'resolve-provider',
            'Wallet provider is not ready.',
            cause,
            onPhase,
            baseMetadata,
        )
    }

    let provider
    try {
        onPhase?.('resolve-provider', {
            ...baseMetadata,
            connectorId: connector.id ?? null,
            connectorName: connector.name ?? null,
        })
        provider = await connector.getProvider({ chainId: sourceChain.id })
    } catch (error) {
        throw executionError(
            'resolve-provider',
            'Wallet provider is not ready.',
            error,
            onPhase,
            baseMetadata,
        )
    }

    try {
        onPhase?.('resolve-wallet-client', {
            ...baseMetadata,
            connectorId: connector.id ?? null,
            connectorName: connector.name ?? null,
            providerType: provider?.constructor?.name ?? connector.type ?? null,
        })
        const accounts = await provider.request({ method: 'eth_accounts' })
        const expectedAddress = accountAddress(connectedAddress)
        const activeAddress = accountAddress(account.addresses?.[0] ?? account.address)
        const providerAddress = accountAddress(Array.isArray(accounts) ? accounts[0] : null)
        if (!expectedAddress || activeAddress !== expectedAddress || providerAddress !== expectedAddress) {
            throw new Error('The current connector account does not match the connected wallet.')
        }
        const walletClient = createConnectorWalletClient({
            account: expectedAddress,
            chain: sourceChain,
            provider,
            createClient,
            createTransport,
        })
        if (Number(walletClient.chain?.id) !== Number(sourceChain.id) ||
            accountAddress(walletClient.account?.address) !== expectedAddress) {
            throw new Error('The current wallet client does not match the source chain and account.')
        }
        return { account: expectedAddress, connector, provider, walletClient }
    } catch (error) {
        throw executionError(
            'resolve-wallet-client',
            'Wallet client is not ready.',
            error,
            onPhase,
            baseMetadata,
        )
    }
}

/**
 * Revalidates and submits one prepared cross-chain approval/source step.
 * @param {object} input Wallet/account/chains/step/route validation and diagnostic callbacks.
 * @returns {Promise<string>} Submitted transaction hash.
 * @throws {CrossChainExecutionError} For binding, provider, wallet, or send failures.
 * @sideEffects Requests an explicit wallet transaction and broadcasts only after validation.
 */
export async function sendPreparedCrossChainTransaction({
    walletClient,
    connectedAddress,
    sourceChain,
    destinationChainId,
    step,
    routeId,
    validateRoute,
    onPhase,
    send = sendTransaction,
}) {
    const phase = step.type === 'approval' ? 'send-approval' : 'send-deposit'
    const metadata = {
        sourceChainId: sourceChain.id,
        destinationChainId,
        walletClientChainId: walletClient?.chain?.id ?? null,
        routeId,
        transactionTarget: step.transaction?.to,
    }
    try {
        validateRoute?.()
        const account = accountAddress(connectedAddress)
        const transaction = step.transaction
        if (!account || accountAddress(walletClient?.account?.address) !== account) {
            throw new Error('The wallet client account changed before submission.')
        }
        if (Number(step.chainId) !== Number(sourceChain.id) ||
            Number(walletClient?.chain?.id) !== Number(sourceChain.id)) {
            throw new Error('The prepared transaction is not on the active source chain.')
        }
        if (!isAddress(transaction?.to ?? '')) {
            throw new Error('The prepared transaction target is invalid.')
        }
        const data = transaction.data ?? '0x'
        if (!isHex(data, { strict: true })) {
            throw new Error('The prepared transaction calldata is invalid.')
        }
        const value = transaction.value == null ? 0n : BigInt(transaction.value)
        const request = {
            account,
            chain: sourceChain,
            to: transaction.to,
            data,
            value,
        }
        if (transaction.gas != null) {
            const gas = BigInt(transaction.gas)
            if (gas <= 0n) throw new Error('The prepared transaction gas limit is invalid.')
            request.gas = gas
        }
        onPhase?.(phase, metadata)
        return await send(walletClient, request)
    } catch (error) {
        throw executionError(
            phase,
            step.type === 'approval'
                ? 'Approval transaction could not be opened in your wallet.'
                : 'Swap transaction could not be opened in your wallet.',
            error,
            onPhase,
            metadata,
        )
    }
}

export async function waitForCrossChainApproval({
    config,
    chainId,
    hash,
    onPhase,
    wait = waitForTransactionReceipt,
}) {
    const metadata = { sourceChainId: chainId, transactionHash: hash }
    onPhase?.('wait-approval', metadata)
    try {
        const receipt = await wait(config, { chainId, hash, confirmations: 1 })
        if (receipt.status !== 'success') throw new Error('The approval transaction reverted.')
        return receipt
    } catch (error) {
        throw executionError(
            'wait-approval',
            'Approval transaction was not confirmed.',
            error,
            onPhase,
            metadata,
        )
    }
}
