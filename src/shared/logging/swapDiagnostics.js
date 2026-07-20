import { isUserRejectedError } from '../../services/swapTransaction.js'
import { CrossChainExecutionError } from '../../features/cross-chain/services/crossChainExecution.js'

const SWAP_DIAGNOSTIC_PREFIX = '[pistachio-swap]'

/**
 * Produces a stable, non-sensitive suffix for correlating request identities in logs.
 * @param {unknown} value Full request identity.
 * @returns {string} Eight-character deterministic hash suffix.
 * @sideEffects None.
 * @security The original identity is not emitted, but this is not a cryptographic hash.
 */
export function requestKeySuffix(value) {
    let hash = 2166136261
    for (const character of String(value ?? '')) {
        hash ^= character.charCodeAt(0)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

function diagnosticValue(value) {
    if (typeof value === 'bigint') return value.toString()
    if (Array.isArray(value)) return value.map(diagnosticValue)
    if (!value || typeof value !== 'object') return value ?? null
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, diagnosticValue(entry)]))
}

/**
 * Emits the existing structured swap diagnostic event.
 * @param {string} event Stable diagnostic event name.
 * @param {object} [payload] JSON-compatible event fields.
 * @param {'debug'|'warn'|'error'} [level] Console level.
 * @returns {void}
 * @sideEffects Writes one entry to the browser console.
 * @security Callers must avoid secrets; BigInt values are normalized for logging.
 */
export function logSwapDiagnostic(event, payload = {}, level = 'debug') {
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'debug'
    const logger = console[method] ?? console.debug
    logger(SWAP_DIAGNOSTIC_PREFIX, diagnosticValue({
        event,
        flow: 'same-chain',
        at: new Date().toISOString(),
        ...payload,
    }))
}

/** @param {object|null} token @returns {object|null} Safe token fields for diagnostics. */
export function tokenDiagnostic(token) {
    if (!token) return null
    return {
        chainId: Number(token.chainId) || null,
        symbol: token.symbol ?? null,
        address: token.address ?? null,
        decimals: Number(token.decimals) || null,
        isNative: token.isNative === true,
    }
}

/** @param {object|null} request @returns {object|null} Quote request fields used by diagnostics. */
export function requestDiagnostic(request) {
    if (!request) return null
    return {
        chainId: request.chainId,
        mode: request.mode,
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        sellAmount: request.sellAmount,
        buyAmount: request.buyAmount,
        sellTokenDecimals: request.sellTokenDecimals,
        buyTokenDecimals: request.buyTokenDecimals,
        takerAddress: request.takerAddress,
        slippageBps: request.slippageBps,
    }
}

/** @param {object|null} quoteResponse @returns {object|null} Safe normalized quote fields for diagnostics. */
export function quoteDiagnostic(quoteResponse) {
    const selected = quoteResponse?.selectedQuote
    if (!selected) return null
    return {
        provider: selected.provider ?? null,
        chainId: selected.chainId ?? null,
        mode: selected.mode ?? null,
        sellToken: selected.sellToken ?? null,
        buyToken: selected.buyToken ?? null,
        sellAmount: selected.sellAmount ?? null,
        buyAmount: selected.buyAmount ?? null,
        minimumBuyAmount: selected.minimumBuyAmount ?? null,
        maximumSellAmount: selected.maximumSellAmount ?? null,
        allowanceTarget: selected.allowanceTarget ?? null,
        expiresAt: selected.expiresAt ?? null,
        transactionTo: selected.transaction?.to ?? null,
        transactionValue: selected.transaction?.value ?? null,
        transactionGas: selected.transaction?.gas ?? null,
        hasTransactionData: Boolean(selected.transaction?.data && selected.transaction.data !== '0x'),
        approval: selected.approval ? {
            mode: selected.approval.mode ?? null,
            token: selected.approval.token ?? null,
            spender: selected.approval.spender ?? null,
            contract: selected.approval.contract ?? null,
            requiredAmount: selected.approval.requiredAmount ?? null,
        } : null,
    }
}

/** @param {object|null} quoteResponse @returns {object} Canonical approval fields for diagnostics. */
export function approvalMetadataDiagnostic(quoteResponse) {
    const selected = quoteResponse?.selectedQuote
    const approval = selected?.approval
    return {
        hasApproval: Boolean(approval),
        mode: approval?.mode ?? null,
        contract: approval?.contract ?? null,
        spender: approval?.spender ?? null,
        token: approval?.token ?? null,
        requiredAmount: approval?.requiredAmount ?? null,
        provider: selected?.provider ?? null,
        transactionTarget: selected?.transaction?.to ?? null,
        chainId: selected?.chainId ?? null,
    }
}

/** @param {object|null} transaction @returns {object|null} Safe transaction fields for diagnostics. */
export function transactionDiagnostic(transaction) {
    if (!transaction) return null
    return {
        chainId: transaction.chainId ?? null,
        to: transaction.to ?? null,
        value: transaction.value?.toString?.() ?? String(transaction.value ?? ''),
        gas: transaction.gas?.toString?.() ?? (transaction.gas ?? null),
        hasData: Boolean(transaction.data && transaction.data !== '0x'),
    }
}

function safeExecutionDiagnosticText(value) {
    if (typeof value !== 'string') return value ?? null
    return value
        .replace(/(https?:\/\/[^\s?#]+)(?:\?[^\s#]*)?/giu, '$1?[redacted]')
        .replace(/0x[a-fA-F0-9]{80,}/gu, (hex) => `0x...[${hex.slice(-8)}]`)
        .slice(0, 8_000)
}

/**
 * Converts an error/cause chain into the redacted structure used by execution logs.
 * @param {unknown} error Error-like value.
 * @param {number} [depth] Internal cause depth.
 * @returns {object|null} Redacted error snapshot.
 * @sideEffects None.
 * @security URL queries and long hexadecimal payloads are removed before logging.
 */
export function executionErrorSnapshot(error, depth = 0) {
    if (!error || typeof error !== 'object' || depth > 3) return null
    return {
        name: safeExecutionDiagnosticText(error.name),
        message: safeExecutionDiagnosticText(error.message),
        stack: safeExecutionDiagnosticText(error.stack),
        shortMessage: safeExecutionDiagnosticText(error.shortMessage),
        details: safeExecutionDiagnosticText(error.details),
        metaMessages: Array.isArray(error.metaMessages)
            ? error.metaMessages.map(safeExecutionDiagnosticText)
            : null,
        cause: executionErrorSnapshot(error.cause, depth + 1),
    }
}

function errorChainContains(error, pattern) {
    let current = error
    while (current && typeof current === 'object') {
        if (pattern.test(String(current.message ?? current.details ?? ''))) return true
        current = current.cause
    }
    return false
}

/**
 * Maps a cross-chain wallet/execution failure to the existing safe visible message.
 * @param {unknown} error Execution failure.
 * @param {string} sourceChainName Human-readable source chain.
 * @returns {string} User-visible error message.
 * @sideEffects None.
 */
export function crossChainExecutionMessage(error, sourceChainName) {
    if (isUserRejectedError(error)) return 'Transaction request rejected.'
    if (errorChainContains(error, /illegal invocation/iu)) {
        return 'The connected wallet could not process this transaction.'
    }
    const phase = error instanceof CrossChainExecutionError ? error.phase : null
    return {
        'switch-chain': `Switch to ${sourceChainName} to continue.`,
        'resolve-provider': 'Wallet provider is not ready.',
        'resolve-wallet-client': 'Wallet client is not ready.',
        'send-approval': 'Approval transaction could not be opened in your wallet.',
        'send-deposit': 'Swap transaction could not be opened in your wallet.',
    }[phase] ?? (error instanceof Error
        ? error.message
        : 'Cross-chain execution is not ready for this route.')
}
