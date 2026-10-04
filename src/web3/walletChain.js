const CHAIN_STATE_TIMEOUT_MS = 10_000
const CHAIN_STATE_POLL_MS = 100

async function loadGetAccount() {
    const actions = await import('wagmi/actions')
    if (typeof actions.getAccount !== 'function') {
        throw new Error('Wallet account state is unavailable.')
    }
    return actions.getAccount
}

export async function waitForWalletChain({
    config,
    targetChainId,
    timeoutMs = CHAIN_STATE_TIMEOUT_MS,
    pollMs = CHAIN_STATE_POLL_MS,
    getAccountState,
    now = Date.now,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
    if (!config) throw new Error('Wallet network state is unavailable.')
    const expectedChainId = Number(targetChainId)
    if (!Number.isSafeInteger(expectedChainId)) {
        throw new Error('Target network is invalid.')
    }
    const resolveAccount = getAccountState ?? await loadGetAccount()
    const deadline = now() + timeoutMs
    do {
        const account = resolveAccount(config)
        if (Number(account?.chainId) === expectedChainId) return account
        await sleep(pollMs)
    } while (now() < deadline)
    throw new Error('Wallet did not report the requested network in time.')
}

export async function ensureWalletChain({
    config,
    targetChain,
    switchNetwork,
    timeoutMs = CHAIN_STATE_TIMEOUT_MS,
    pollMs = CHAIN_STATE_POLL_MS,
    getAccountState,
    now = Date.now,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
    if (!config) throw new Error('Wallet network state is unavailable.')
    const targetChainId = Number(targetChain?.id)
    if (!Number.isSafeInteger(targetChainId)) {
        throw new Error('Target network is invalid.')
    }
    if (typeof switchNetwork !== 'function') {
        throw new Error('Wallet network switching is unavailable.')
    }

    const resolveAccount = getAccountState ?? await loadGetAccount()
    let account = resolveAccount(config)
    if (Number(account?.chainId) !== targetChainId) {
        await switchNetwork(targetChain)
        account = await waitForWalletChain({
            config,
            targetChainId,
            timeoutMs,
            pollMs,
            getAccountState: resolveAccount,
            now,
            sleep,
        })
    }
    return account
}
