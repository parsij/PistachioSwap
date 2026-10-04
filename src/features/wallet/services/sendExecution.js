import {
    createWalletClient,
    custom,
    getAddress,
} from 'viem'

import { getPistachioWalletManager } from '../../passkey/services/walletManager.js'
import { PISTACHIO_CONNECTOR_ID } from '../../passkey/services/constants.js'

const PROVIDER_CHAIN_TIMEOUT_MS = 10_000
const PROVIDER_CHAIN_POLL_MS = 100

function normalizedAddress(value) {
    try {
        return getAddress(value)
    } catch {
        return null
    }
}

function parseProviderChainId(value) {
    if (typeof value !== 'string' || !/^0x[0-9a-f]+$/iu.test(value)) return null
    const chainId = Number(BigInt(value))
    return Number.isSafeInteger(chainId) ? chainId : null
}

function localSessionAddress(snapshot) {
    return normalizedAddress(
        snapshot?.address ??
        (snapshot?.sessionActive ? snapshot?.vault?.address : null),
    )
}

function localManagerProvider(manager) {
    return {
        request: (request) => manager.providerRequest(request),
    }
}

async function waitForProviderChain({
    provider,
    targetChainId,
    timeoutMs = PROVIDER_CHAIN_TIMEOUT_MS,
    pollMs = PROVIDER_CHAIN_POLL_MS,
    now = Date.now,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
    const deadline = now() + timeoutMs
    do {
        const chainId = parseProviderChainId(
            await provider.request({ method: 'eth_chainId' }),
        )
        if (chainId === Number(targetChainId)) return chainId
        await sleep(pollMs)
    } while (now() < deadline)
    throw new Error('Wallet did not switch to the selected token network in time.')
}

async function verifyProviderAccount(provider, connectedAddress) {
    const expectedAddress = normalizedAddress(connectedAddress)
    const accounts = await provider.request({ method: 'eth_accounts' })
    const providerAddress = normalizedAddress(
        Array.isArray(accounts) ? accounts[0] : null,
    )
    if (!expectedAddress || providerAddress !== expectedAddress) {
        throw new Error('The wallet account changed before the send.')
    }
    return expectedAddress
}

async function resolveLocalPistachioWallet({
    connectedAddress,
    targetChain,
    manager = getPistachioWalletManager(),
    createClient = createWalletClient,
    createTransport = custom,
}) {
    await manager.initialize()
    const snapshot = manager.snapshot()
    const expectedAddress = normalizedAddress(connectedAddress)
    if (
        snapshot?.sessionActive !== true ||
        !expectedAddress ||
        localSessionAddress(snapshot) !== expectedAddress
    ) {
        return null
    }

    // Send is asset-scoped. The selected token's chain is the signing chain.
    // This intentionally does not depend on the swap page's active network.
    await manager.switchChain(targetChain.id)
    const provider = localManagerProvider(manager)
    await waitForProviderChain({
        provider,
        targetChainId: targetChain.id,
    })
    const account = await verifyProviderAccount(provider, expectedAddress)
    const walletClient = createClient({
        account,
        chain: targetChain,
        transport: createTransport(provider),
    })
    return {
        account,
        connectorId: PISTACHIO_CONNECTOR_ID,
        provider,
        walletClient,
    }
}

async function resolveConnectorWallet({
    connectedAddress,
    targetChain,
    connector,
    createClient = createWalletClient,
    createTransport = custom,
}) {
    if (!connector || typeof connector.getProvider !== 'function') {
        throw new Error('The connected wallet provider is unavailable.')
    }

    let provider = await connector.getProvider({ chainId: targetChain.id })
    let currentChainId = parseProviderChainId(
        await provider.request({ method: 'eth_chainId' }),
    )
    if (currentChainId !== Number(targetChain.id)) {
        if (typeof connector.switchChain === 'function') {
            await connector.switchChain({ chainId: targetChain.id })
        } else {
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${Number(targetChain.id).toString(16)}` }],
            })
        }
        provider = await connector.getProvider({ chainId: targetChain.id })
        currentChainId = await waitForProviderChain({
            provider,
            targetChainId: targetChain.id,
        })
    }
    if (currentChainId !== Number(targetChain.id)) {
        throw new Error('The wallet is not on the selected token network.')
    }

    const account = await verifyProviderAccount(provider, connectedAddress)
    const walletClient = createClient({
        account,
        chain: targetChain,
        transport: createTransport(provider),
    })
    return {
        account,
        connectorId: connector.id ?? null,
        provider,
        walletClient,
    }
}

/**
 * Resolve a transaction client from the selected asset's chain rather than
 * from the swap page's current chain.
 */
export async function resolveSendWallet({
    connectedAddress,
    targetChain,
    connector,
    manager,
    createClient,
    createTransport,
}) {
    if (!targetChain?.id) throw new Error('The selected token network is unavailable.')

    // Pistachio Wallet has its own chain-bound signer. Use it directly so a
    // stale AppKit/Wagmi page-network snapshot cannot block the passkey flow.
    if (!connector || connector.id === PISTACHIO_CONNECTOR_ID) {
        const local = await resolveLocalPistachioWallet({
            connectedAddress,
            targetChain,
            manager,
            createClient,
            createTransport,
        })
        if (local) return local
        if (connector?.id === PISTACHIO_CONNECTOR_ID) {
            throw new Error('Reconnect Pistachio Wallet before sending.')
        }
    }

    return resolveConnectorWallet({
        connectedAddress,
        targetChain,
        connector,
        createClient,
        createTransport,
    })
}

export async function submitSendPlan({
    walletClient,
    targetChain,
    plan,
}) {
    if (!walletClient || Number(walletClient.chain?.id) !== Number(targetChain?.id)) {
        throw new Error('The send wallet is not bound to the selected token network.')
    }

    if (plan?.kind === 'native') {
        return walletClient.sendTransaction({
            account: walletClient.account,
            chain: targetChain,
            to: plan.request.to,
            value: plan.amountWei,
        })
    }
    if (plan?.kind === 'erc20') {
        return walletClient.writeContract({
            account: walletClient.account,
            chain: targetChain,
            address: plan.request.address,
            abi: plan.request.abi,
            functionName: plan.request.functionName,
            args: plan.request.args,
        })
    }
    throw new Error('The reviewed send is invalid.')
}

export const sendExecutionInternals = {
    localSessionAddress,
    parseProviderChainId,
    waitForProviderChain,
    verifyProviderAccount,
}
