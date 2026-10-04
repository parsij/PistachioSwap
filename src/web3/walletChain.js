const CHAIN_STATE_TIMEOUT_MS = 10_000
const CHAIN_STATE_POLL_MS = 100

async function loadWagmiActions() {
    const actions = await import('wagmi/actions')
    if (typeof actions.getAccount !== 'function') {
        throw new Error('Wallet account state is unavailable.')
    }
    return actions
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
    const resolveAccount = getAccountState ?? (await loadWagmiActions()).getAccount
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
    switchChainAction,
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
    const actions = (
        getAccountState && switchChainAction
            ? null
            : await loadWagmiActions()
    )
    const resolveAccount = getAccountState ?? actions?.getAccount
    const requestWagmiSwitch = switchChainAction ?? actions?.switchChain

    let account = resolveAccount(config)
    if (Number(account?.chainId) !== targetChainId) {
        if (typeof requestWagmiSwitch === 'function') {
            await requestWagmiSwitch(config, { chainId: targetChainId })
        } else if (typeof switchNetwork === 'function') {
            await switchNetwork(targetChain)
        } else {
            throw new Error('Wallet network switching is unavailable.')
        }
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
