import { getAddress } from 'viem'

const HARDENED_MANAGER = Symbol.for(
    'pistachioswap.pistachio-wallet.production-hardened',
)
const ACTIVE_SESSION_VAULT_PREFERENCE = 'activeSessionVaultId'
const LAST_WALLET_ACTIVITY_PREFERENCE = 'lastWalletActivityAt'
const SESSION_RESUME_ELIGIBLE_PREFERENCE = 'sessionResumeEligible'
const SENSITIVE_ACTION_LIMIT = 12
const SENSITIVE_ACTION_WINDOW_MS = 60_000
const GAS_ASSIST_FLOW_WINDOW_MS = 3 * 60_000
const AUTH_CHALLENGE_MAX_TTL_MS = 10 * 60_000
const RPC_TIMEOUT_MS = 15_000
const MAX_RPC_RESPONSE_CHARS = 512 * 1024
const MAX_MESSAGE_CHARS = 128 * 1024
const MAX_TYPED_DATA_CHARS = 256 * 1024
const MAX_TRANSACTION_CHARS = 512 * 1024
const MAX_PROVIDER_PARAMS = 4
const RPC_METHODS = new Set([
    'eth_chainId',
    'eth_getTransactionCount',
    'eth_gasPrice',
    'eth_estimateGas',
    'eth_sendRawTransaction',
])
const SESSION_CLEAR_LOCK_REASONS = new Set([
    'account-mismatch',
    'chain-invariant',
    'connector-disconnect',
    'provider-disconnect',
    'vault-deleted',
])

function walletError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function serializedLength(value) {
    try {
        return JSON.stringify(value).length
    } catch {
        return Number.POSITIVE_INFINITY
    }
}

function assertProviderParams(params) {
    if (!Array.isArray(params) || params.length > MAX_PROVIDER_PARAMS) {
        throw walletError(
            'PISTACHIO_PROVIDER_REQUEST_INVALID',
            'The wallet request contains invalid parameters.',
        )
    }
}

function assertAccount(value, expected) {
    try {
        if (getAddress(value) !== getAddress(expected)) throw new Error('mismatch')
    } catch {
        throw walletError(
            'PISTACHIO_ACCOUNT_MISMATCH',
            'Signing account mismatch.',
        )
    }
}

function assertPayloadLimit(value, maximum, label) {
    if (serializedLength(value) > maximum) {
        throw walletError(
            'PISTACHIO_REQUEST_TOO_LARGE',
            `${label} exceeds the Pistachio Wallet safety limit.`,
        )
    }
}

async function writePreference(manager, key, value) {
    await Promise.resolve(manager.storage?.writePreference?.(key, value))
        .catch(() => undefined)
}

async function persistReadOnlySession(manager) {
    const timestamp = Date.now()
    manager.sessionActive = true
    manager.activeSessionVaultId = manager.vault.vaultId
    manager.resumeReauthPending = true
    manager.lastWalletActivityAt = timestamp
    await Promise.all([
        writePreference(
            manager,
            ACTIVE_SESSION_VAULT_PREFERENCE,
            manager.activeSessionVaultId,
        ),
        writePreference(manager, SESSION_RESUME_ELIGIBLE_PREFERENCE, true),
        writePreference(manager, LAST_WALLET_ACTIVITY_PREFERENCE, timestamp),
    ])
}

function readOnlyAccount(manager) {
    if (manager.phase === 'unlocked' && manager.address) return manager.address
    if (manager.sessionActive && manager.vault?.address) return manager.vault.address
    return null
}

function isGasAssistAuthenticationMessage(
    value,
    {
        walletAddress,
        activeChainId,
        now = Date.now(),
    },
) {
    const message = value?.message
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_CHARS) {
        return false
    }

    const lines = message.split('\n')
    const crossChain = lines[0] === 'PistachioSwap Cross-Chain Authentication'
    const sponsorship = lines[0] === 'PistachioSwap Gas Assist Authentication'
    if ((!crossChain && !sponsorship) || lines.length !== (crossChain ? 11 : 10)) {
        return false
    }
    if (
        lines[1] !== '' ||
        lines[8] !== '' ||
        !lines[3].startsWith('Wallet: ') ||
        !/^Domain: (?:localhost|127\.0\.0\.1|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/u.test(lines[2]) ||
        !/^Nonce: [A-Za-z0-9_-]{16,128}$/u.test(lines[5])
    ) return false

    try {
        if (getAddress(lines[3].slice('Wallet: '.length)) !== getAddress(walletAddress)) {
            return false
        }
    } catch {
        return false
    }

    const expectedChain = Number(activeChainId)
    const chainLine = crossChain
        ? `Source Chain ID: ${expectedChain}`
        : 'Chain ID: 56'
    if (
        lines[4] !== chainLine ||
        !Number.isSafeInteger(expectedChain) ||
        (sponsorship && expectedChain !== 56)
    ) return false

    const issuedAt = Date.parse(lines[6].slice('Issued At: '.length))
    const expiresAt = Date.parse(lines[7].slice('Expiration Time: '.length))
    if (
        !lines[6].startsWith('Issued At: ') ||
        !lines[7].startsWith('Expiration Time: ') ||
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        issuedAt > now + 30_000 ||
        expiresAt <= now ||
        expiresAt - issuedAt > AUTH_CHALLENGE_MAX_TTL_MS
    ) return false

    if (crossChain) {
        return lines[9] === 'This signature authenticates this wallet for cross-chain route mutations on the source chain.' &&
            lines[10] === 'It does not authorize or submit a transaction.'
    }
    return lines[9] === 'This signature authenticates your wallet. It does not authorize a transaction.'
}

/**
 * Applies production session and input hardening to the browser singleton.
 * A passkey authorizes the wallet-management view once per page lifetime. The
 * decrypted key normally remains loaded only while one operation needs it.
 * Gas Assist may reuse one passkey for its exact authentication messages and
 * validated three-transaction MegaFuel package inside a short, wallet-bound scope.
 */
export function hardenPistachioWalletManager(manager) {
    if (!manager || manager[HARDENED_MANAGER]) return manager

    Object.defineProperty(manager, HARDENED_MANAGER, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false,
    })

    const originalSnapshot = manager.snapshot.bind(manager)
    const originalNotify = manager.notify.bind(manager)
    const originalRequestConnection = manager.requestConnection.bind(manager)
    const originalUnlock = manager.unlock.bind(manager)
    const originalReauthenticate = manager.reauthenticate.bind(manager)
    const originalLock = manager.lock.bind(manager)
    const originalSignMessage = manager.signMessage.bind(manager)
    const originalSignTypedData = manager.signTypedData.bind(manager)
    const originalSignMegaFuelTransaction =
        manager.signMegaFuelTransaction.bind(manager)
    const originalSendTransaction = manager.sendTransaction.bind(manager)
    const originalRenamePasskey = typeof manager.renamePasskey === 'function'
        ? manager.renamePasskey.bind(manager)
        : null
    const originalSensitiveMethods = new Map(
        [
            'addBackupPasskey',
            'exportEncryptedBackup',
            'exportKeystore',
            'removePasskey',
            'revealPrivateKey',
            'revealRecoveryPhrase',
            'signMegaFuelPackage',
        ].flatMap((name) => typeof manager[name] === 'function'
            ? [[name, manager[name].bind(manager)]]
            : []),
    )
    let sensitiveActionActive = false
    let sensitiveActionTimestamps = []
    let walletViewAuthorizedVaultId = null
    let currentSensitiveActionKind = 'default'
    let gasAssistFlow = null
    let gasAssistFlowTimer = null

    const clearGasAssistFlow = () => {
        if (gasAssistFlowTimer !== null) {
            globalThis.clearTimeout(gasAssistFlowTimer)
            gasAssistFlowTimer = null
        }
        gasAssistFlow = null
    }

    const gasAssistFlowMatches = () => Boolean(
        gasAssistFlow &&
        gasAssistFlow.expiresAt > Date.now() &&
        manager.vault?.vaultId === gasAssistFlow.vaultId &&
        readOnlyAccount(manager)?.toLowerCase() === gasAssistFlow.walletAddress,
    )

    const armGasAssistFlow = () => {
        if (
            manager.phase !== 'unlocked' ||
            !manager.address ||
            !manager.client ||
            !manager.vault
        ) return false

        clearGasAssistFlow()
        gasAssistFlow = {
            expiresAt: Date.now() + GAS_ASSIST_FLOW_WINDOW_MS,
            vaultId: manager.vault.vaultId,
            walletAddress: manager.address.toLowerCase(),
        }
        gasAssistFlowTimer = globalThis.setTimeout(() => {
            clearGasAssistFlow()
            if (manager.phase === 'unlocked') {
                void manager.lock('gas-assist-flow-expired', { broadcast: false })
            }
        }, GAS_ASSIST_FLOW_WINDOW_MS)
        return true
    }

    manager.snapshot = function snapshot() {
        return Object.freeze({
            ...originalSnapshot(),
            signingPasskeyOnly: true,
            walletViewAuthorized: Boolean(
                this.vault && walletViewAuthorizedVaultId === this.vault.vaultId,
            ),
        })
    }

    manager.notify = function notify() {
        if (
            this.sessionActive &&
            this.vault &&
            this.phase === 'locked'
        ) {
            this.resumeReauthPending = true
        }
        return originalNotify()
    }

    manager.unlock = async function unlock(...args) {
        const address = await originalUnlock(...args)
        walletViewAuthorizedVaultId = this.vault?.vaultId ?? null
        this.notify()
        return address
    }

    manager.reauthenticate = async function reauthenticate(...args) {
        if (this.phase !== 'unlocked' || !this.address || !this.client) {
            if (!this.sessionActive || !this.vault) {
                throw walletError(
                    'PISTACHIO_WALLET_LOCKED',
                    'Open Pistachio Wallet before this protected action.',
                )
            }
            await this.unlock(...args)
            return true
        }
        return originalReauthenticate(...args)
    }

    manager.openWalletView = async function openWalletView() {
        await this.initialize()
        if (!this.vault) {
            this.open('wallet')
            return
        }

        if (this.phase === 'unlocked' && this.address && this.client) {
            walletViewAuthorizedVaultId = this.vault.vaultId
            this.view = 'wallet'
            this.notify()
            return
        }

        if (walletViewAuthorizedVaultId === this.vault.vaultId) {
            if (!this.sessionActive) await persistReadOnlySession(this)
            this.view = 'wallet'
            this.notify()
            return
        }

        // Show the browser passkey state immediately instead of briefly rendering
        // the saved-wallet chooser before unlock() reaches its first state update.
        this.view = 'wallet'
        this.phase = 'unlocking'
        this.error = null
        this.notify()
        try {
            await this.unlock()
        } catch {
            // unlock() publishes the safe locked/error state. Keep the wallet
            // dialog open so the user can retry instead of losing their context.
        }
    }

    manager.activateReadOnlySession = async function activateReadOnlySession(
        vaultId = this.vault?.vaultId,
    ) {
        await this.initialize()
        if (vaultId && this.vault?.vaultId !== vaultId) {
            await this.selectVault(vaultId)
        }
        if (!this.vault) {
            throw walletError(
                'PISTACHIO_VAULT_NOT_FOUND',
                'No saved Pistachio Wallet exists in this browser.',
            )
        }
        if (this.client || this.phase === 'unlocked') {
            await originalLock('read-only-session', { broadcast: false })
                .catch(() => undefined)
        }
        this.client = null
        this.address = null
        this.phase = 'locked'
        this.error = null
        await persistReadOnlySession(this)
        this.connectionBridge?.resolve?.(this.vault.address)
        this.view = null
        this.notify()
        return this.vault.address
    }

    manager.requestConnection = async function requestConnection() {
        await this.initialize()
        if (this.vault) {
            return this.activateReadOnlySession(this.vault.vaultId)
        }
        return originalRequestConnection()
    }

    manager.ensureUnlockedForSigning = async function ensureUnlockedForSigning() {
        if (!this.sessionActive || !this.vault) {
            throw walletError(
                'PISTACHIO_WALLET_LOCKED',
                'Connect Pistachio Wallet before signing.',
            )
        }
        const scopedGasAssistAction = (
            currentSensitiveActionKind === 'gas-assist-auth' ||
            currentSensitiveActionKind === 'gas-assist-package'
        )
        if (
            scopedGasAssistAction &&
            gasAssistFlowMatches() &&
            this.phase === 'unlocked' &&
            this.address &&
            this.client
        ) {
            this.requireUnlocked()
            return
        }
        if (this.phase === 'unlocked' && this.address && this.client) {
            await this.reauthenticate()
        } else {
            await this.unlock()
        }
        this.requireUnlocked()
    }

    manager.lock = async function lock(reason = 'manual', options = {}) {
        clearGasAssistFlow()
        if (reason === 'manual' || SESSION_CLEAR_LOCK_REASONS.has(reason)) {
            walletViewAuthorizedVaultId = null
        }
        if (SESSION_CLEAR_LOCK_REASONS.has(reason) && this.sessionActive) {
            await this.clearActiveSession()
        }
        return originalLock(reason, options)
    }

    const finishSensitiveAction = async ({
        preserveGasAssistUnlock = false,
    } = {}) => {
        sensitiveActionActive = false
        if (
            preserveGasAssistUnlock &&
            gasAssistFlowMatches() &&
            manager.phase === 'unlocked' &&
            manager.address &&
            manager.client
        ) {
            manager.notify()
            return
        }

        clearGasAssistFlow()
        if (!manager.sessionActive || !manager.vault) return

        const preservedView = manager.view
        const notify = manager.notify
        // originalLock normally clears an open wallet view for an active session.
        // Suppress its intermediate snapshot so the same wallet screen stays
        // mounted while decrypted key material is discarded.
        manager.notify = () => undefined
        try {
            await originalLock('sensitive-action-complete', { broadcast: false })
                .catch(() => undefined)
        } finally {
            manager.notify = notify
        }
        manager.view = preservedView
        await persistReadOnlySession(manager)
        manager.notify()
    }

    const wrapSensitiveAction = (
        operation,
        classify = () => 'default',
    ) => async (...args) => {
        const now = Date.now()
        sensitiveActionTimestamps = sensitiveActionTimestamps.filter(
            (timestamp) => now - timestamp < SENSITIVE_ACTION_WINDOW_MS,
        )
        if (sensitiveActionActive) {
            throw walletError(
                'PISTACHIO_SIGNING_REQUEST_ACTIVE',
                'Another sensitive wallet request is already in progress.',
            )
        }
        if (sensitiveActionTimestamps.length >= SENSITIVE_ACTION_LIMIT) {
            throw walletError(
                'PISTACHIO_SENSITIVE_ACTION_RATE_LIMITED',
                'Too many sensitive wallet requests. Wait one minute and try again.',
            )
        }

        const actionKind = classify(...args)
        sensitiveActionTimestamps.push(now)
        sensitiveActionActive = true
        currentSensitiveActionKind = actionKind
        let succeeded = false
        try {
            const result = await operation(...args)
            succeeded = true
            return result
        } finally {
            if (succeeded && actionKind === 'gas-assist-auth') {
                armGasAssistFlow()
            }
            const preserveGasAssistUnlock = (
                succeeded &&
                actionKind === 'gas-assist-auth' &&
                gasAssistFlowMatches()
            )
            currentSensitiveActionKind = 'default'
            await finishSensitiveAction({ preserveGasAssistUnlock })
        }
    }

    const classifyMessage = (value) => isGasAssistAuthenticationMessage(value, {
        walletAddress: readOnlyAccount(manager),
        activeChainId: manager.activeChainId,
    })
        ? 'gas-assist-auth'
        : 'default'
    manager.signMessage = wrapSensitiveAction(
        (value) => originalSignMessage(
            value,
            classifyMessage(value) === 'gas-assist-auth'
                ? { skipReview: true }
                : undefined,
        ),
        classifyMessage,
    )
    manager.signTypedData = wrapSensitiveAction(originalSignTypedData)
    manager.signMegaFuelTransaction = wrapSensitiveAction(
        originalSignMegaFuelTransaction,
    )
    manager.sendTransaction = wrapSensitiveAction(originalSendTransaction)
    for (const [name, operation] of originalSensitiveMethods) {
        manager[name] = wrapSensitiveAction(
            operation,
            () => name === 'signMegaFuelPackage'
                ? 'gas-assist-package'
                : 'default',
        )
    }
    if (originalRenamePasskey) {
        manager.renamePasskey = wrapSensitiveAction(async (...args) => {
            await manager.reauthenticate()
            return originalRenamePasskey(...args)
        })
    }

    manager.providerRequest = async function providerRequest({
        method,
        params = [],
    } = {}) {
        if (typeof method !== 'string' || method.length > 80) {
            throw walletError(
                'PISTACHIO_PROVIDER_REQUEST_INVALID',
                'The wallet request method is invalid.',
            )
        }
        assertProviderParams(params)
        const activeChainHex = `0x${this.activeChainId.toString(16)}`
        if (method === 'eth_chainId') return activeChainHex
        if (method === 'net_version') return String(this.activeChainId)
        if (method === 'eth_accounts') {
            const account = readOnlyAccount(this)
            return account ? [account] : []
        }
        if (method === 'eth_requestAccounts') {
            return [await this.requestConnection()]
        }
        if (method === 'wallet_switchEthereumChain') {
            if (
                params.length !== 1 ||
                !params[0] ||
                typeof params[0] !== 'object' ||
                Array.isArray(params[0]) ||
                typeof params[0].chainId !== 'string' ||
                !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(params[0].chainId)
            ) {
                throw walletError(
                    'PISTACHIO_CHAIN_NOT_ALLOWED',
                    'A valid allowlisted chain is required.',
                )
            }
            await this.switchChain(params[0].chainId)
            return null
        }
        if (method === 'wallet_getCapabilities') {
            return { [activeChainHex]: { atomicBatch: { supported: false } } }
        }
        if (method === 'personal_sign') {
            const [message, account] = params
            if (typeof message !== 'string') {
                throw walletError(
                    'PISTACHIO_PROVIDER_REQUEST_INVALID',
                    'The message to sign is invalid.',
                )
            }
            assertPayloadLimit(message, MAX_MESSAGE_CHARS, 'Message')
            assertAccount(account, readOnlyAccount(this))
            return this.signMessage(message.startsWith('0x')
                ? { messageBytes: message }
                : { message })
        }
        if (method === 'eth_signTypedData_v4') {
            const [account, typedData] = params
            assertAccount(account, readOnlyAccount(this))
            assertPayloadLimit(typedData, MAX_TYPED_DATA_CHARS, 'Typed data')
            return this.signTypedData(typedData)
        }
        if (method === 'eth_signTransaction') {
            if (this.activeChainId !== 56) {
                throw walletError(
                    'PISTACHIO_CHAIN_INVARIANT_FAILED',
                    'Raw transaction signing is available on BNB Chain only.',
                )
            }
            assertPayloadLimit(
                params[0],
                MAX_TRANSACTION_CHARS,
                'Transaction request',
            )
            return this.signMegaFuelTransaction(params[0])
        }
        if (method === 'eth_sendTransaction') {
            assertPayloadLimit(
                params[0],
                MAX_TRANSACTION_CHARS,
                'Transaction request',
            )
            return this.sendTransaction(params[0])
        }
        throw walletError(
            4200,
            `Pistachio Wallet does not support ${method}.`,
        )
    }

    manager.rpcRequest = async function rpcRequest(
        chainId,
        method,
        params,
        rpcUrl = this.rpcUrlForChain(chainId),
    ) {
        if (!RPC_METHODS.has(method) || !Array.isArray(params)) {
            throw walletError(
                'PISTACHIO_RPC_METHOD_NOT_ALLOWED',
                'This wallet RPC method is not allowed.',
            )
        }
        assertPayloadLimit(params, MAX_TRANSACTION_CHARS, 'RPC request')
        const requestId = globalThis.crypto.randomUUID()
        const controller = new AbortController()
        const timer = globalThis.setTimeout(
            () => controller.abort(),
            RPC_TIMEOUT_MS,
        )
        try {
            const response = await this.fetch(rpcUrl, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: requestId,
                    method,
                    params,
                }),
                cache: 'no-store',
                redirect: 'error',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            })
            const declaredLength = Number(
                response.headers.get('content-length') ?? 0,
            )
            if (declaredLength > MAX_RPC_RESPONSE_CHARS) {
                throw walletError(
                    'PISTACHIO_RPC_RESPONSE_TOO_LARGE',
                    'The public RPC response exceeded the wallet safety limit.',
                )
            }
            const text = await response.text()
            if (text.length > MAX_RPC_RESPONSE_CHARS) {
                throw walletError(
                    'PISTACHIO_RPC_RESPONSE_TOO_LARGE',
                    'The public RPC response exceeded the wallet safety limit.',
                )
            }
            let result
            try {
                result = JSON.parse(text)
            } catch {
                throw walletError(
                    'PISTACHIO_TRANSACTION_BROADCAST_FAILED',
                    'The public RPC returned invalid JSON.',
                )
            }
            if (
                !response.ok ||
                result?.jsonrpc !== '2.0' ||
                result?.id !== requestId ||
                result.error
            ) {
                throw walletError(
                    'PISTACHIO_TRANSACTION_BROADCAST_FAILED',
                    `The public RPC for chain ${Number(chainId)} rejected the request.`,
                )
            }
            return result.result
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw walletError(
                    'PISTACHIO_RPC_TIMEOUT',
                    'The public RPC request timed out.',
                )
            }
            throw error
        } finally {
            globalThis.clearTimeout(timer)
        }
    }

    const documentImpl = manager.window?.document
    if (documentImpl?.addEventListener) {
        documentImpl.addEventListener('visibilitychange', () => {
            if (documentImpl.hidden && manager.phase === 'unlocked') {
                void manager.lock('tab-hidden', { broadcast: false })
            }
        })
    }

    manager.notify()
    return manager
}

export const walletManagerProductionInternals = {
    MAX_MESSAGE_CHARS,
    MAX_PROVIDER_PARAMS,
    MAX_RPC_RESPONSE_CHARS,
    MAX_TRANSACTION_CHARS,
    MAX_TYPED_DATA_CHARS,
    AUTH_CHALLENGE_MAX_TTL_MS,
    GAS_ASSIST_FLOW_WINDOW_MS,
    SENSITIVE_ACTION_LIMIT,
    SENSITIVE_ACTION_WINDOW_MS,
    isGasAssistAuthenticationMessage,
    readOnlyAccount,
    serializedLength,
}
