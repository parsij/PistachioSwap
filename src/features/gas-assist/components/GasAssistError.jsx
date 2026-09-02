const messages = {
    BELOW_SPONSOR_MINIMUM: 'The amount is too small for Gas Assist.',
    ABOVE_SPONSOR_MAXIMUM: 'The amount is above the Gas Assist limit.',
    GAS_ASSIST_RULE_NOT_FOUND: 'Gas Assist is not available for this token yet.',
    SWAP_INTENT_NOT_CUSTOM_CONTRACT: 'This route cannot use Gas Assist.',
    ONCHAIN_APPROVAL_REQUIRED: 'This token needs a one-time on-chain approval before it can be swapped.',
    UNLIMITED_PERMIT_NOT_ALLOWED: 'This token requested an unsafe unlimited approval.',
    SELL_VALUE_TOO_LOW: 'The swap amount is too small for Gas Assist.',
    GAS_ASSIST_FEE_NOT_REPRESENTABLE: 'The Gas Assist fee is too large for this trade.',
    GROSS_TRADE_VALUE_UNECONOMIC: 'The swap amount is too small for Gas Assist.',
    NET_TRADE_VALUE_UNECONOMIC: 'Too little would remain to swap after the Gas Assist fee.',
    PAYMENT_EXCEEDS_GROSS_INPUT: 'The Gas Assist fee would leave nothing to swap.',
    CROSS_CHAIN_COST_EXCEEDS_INPUT: 'Cross-chain route costs and Gas Assist fees would consume the swap amount.',
    INVALID_CROSS_CHAIN_ROUTE_COST: 'This route did not provide a safe cost estimate.',
    CROSS_CHAIN_SPONSORSHIP_PREVIEW_INVALID: 'The cross-chain fee quote was inconsistent. Refresh and try again.',
    SPONSORSHIP_PREVIEW_INVALID_RESPONSE: 'The Gas Assist fee quote was inconsistent. Refresh and try again.',
    OUTPUT_VALUE_UNECONOMIC: 'The expected output is too small.',
    PAYMENT_TRANSFER_UNECONOMIC: 'This amount is too small to cover the sponsored transaction.',
    USER_OUTPUT_TOO_LOW: 'The expected output is too small after fees.',
    PRICE_IMPACT_TOO_HIGH: 'Price impact is too high for this swap.',
    QUOTE_EXPIRED: 'The price expired. Refresh and try again.',
    INTENT_EXPIRED: 'This wallet request expired. Try again.',
    ORDER_EXPIRED: 'This Gas Assist quote expired. Create a fresh quote.',
    CROSS_CHAIN_ROUTE_EXPIRED: 'This cross-chain route expired. Refresh and try again.',
    PRESIGNED_PACKAGE_QUOTE_TOO_SHORT: 'This route does not have enough time left to sign safely. Refresh and try again.',
    ALLOWANCE_ALREADY_SUFFICIENT: 'This token is already approved. Refresh and continue the swap.',
    ACTIVE_ORDER_EXISTS: 'A Gas Assist swap is already active for this wallet.',
    ORDER_REQUOTE_REQUIRED: 'The price changed too much. Refresh and try again.',
    CROSS_CHAIN_SPONSORSHIP_UNSTABLE: 'The exact sponsored route changed. Refresh and try again.',
    CROSS_CHAIN_GATEWAY_TIMEOUT: 'Gas Assist took too long to confirm this route. Try again.',
    GAS_ASSIST_UNAVAILABLE: 'Gas Assist is temporarily unavailable. Try again.',
    SPONSORED_ACTION_REVERTED: 'This swap could not be simulated. Refresh and try again.',
    SPONSORED_NATIVE_GAS_CAP_EXCEEDED: 'This route exceeds the sponsored BNB gas-cost limit. Choose a lower-gas route or try again.',
    SPONSORSHIP_ORDER_FAILED: 'Gas Assist could not complete this swap. Try again.',
    ATOMIC_RECEIPT_INVALID: 'The sponsored transaction confirmed without paying the Gas Assist fee. Try again.',
    ATOMIC_SWAP_REVERTED: 'The sponsored swap reverted on-chain. Try again.',
    UNSIGNED_EIP7702_AUTHORIZATION: 'The wallet did not sign the one-transaction Gas Assist authorization. Try again.',
    SPONSORED_ROUTE_UNAVAILABLE: 'No safe Gas Assist route is available right now.',
    PRESIGNED_PACKAGE_REQUIRES_UNISWAP: 'This route cannot currently use the one-tap Gas Assist flow.',
    PRESIGNED_PACKAGE_NONCE_MISMATCH: 'Your wallet nonce changed. Refresh and try again.',
    SPONSORSHIP_PACKAGE_NONCE_MISMATCH: 'Your wallet nonce changed. Refresh and try again.',
    PRESIGNED_PACKAGE_STATE_CONFLICT: 'This Gas Assist swap changed state. Refresh its status.',
    ORDER_STATE_CONFLICT: 'This Gas Assist swap changed state. Refresh its status.',
    PAYMENT_TOKEN_DISABLED: 'Gas Assist is no longer available for this token.',
    PAYMENT_TOKEN_EVIDENCE_STALE: 'This token cannot be safely priced right now.',
    INSUFFICIENT_PAYMENT_TOKEN_BALANCE: 'Your token balance is too low for this swap.',
    PAYMASTER_REJECTED: 'The sponsor declined this transaction.',
    PAYMASTER_TIMEOUT: 'The sponsor service timed out. Try again.',
    PAYMASTER_UNAVAILABLE: 'The sponsor service is temporarily unavailable.',
    PAYMASTER_POLICY_TIMEOUT: 'The sponsor policy service timed out. Try again.',
    PAYMASTER_POLICY_UNAVAILABLE: 'The sponsor policy service is temporarily unavailable.',
    PAYMASTER_POLICY_UPDATE_FAILED: 'The sponsor could not authorize this exact transaction.',
    SPONSORSHIP_NETWORK_ERROR: 'Could not reach Gas Assist. Check your connection and try again.',
    SPONSORSHIP_REQUEST_ABORTED: 'The Gas Assist request was cancelled.',
    SPONSORSHIP_INVALID_RESPONSE: 'Gas Assist returned an invalid response.',
    SPONSORSHIP_EMPTY_RESPONSE: 'Gas Assist returned an empty response.',
    SPONSORSHIP_CONFIG_LOADING: 'Gas Assist is still loading.',
    SPONSORSHIP_CONFIG_UNAVAILABLE: 'Gas Assist configuration could not be loaded.',
    SPONSORSHIP_DISABLED: 'Gas Assist is currently unavailable.',
    SPONSORSHIP_CONTEXT_MISSING: 'This Gas Assist session ended. Start again.',
    PISTACHIO_ACCOUNT_MISMATCH: 'The connected wallet changed. Start again.',
    ATOMIC_PATH_UNAVAILABLE: 'This swap cannot run as one sponsored transaction right now.',
    SEQUENTIAL_PACKAGE_DISABLED: 'Same-chain Gas Assist no longer uses sequential transactions.',
    PISTACHIO_WALLET_REQUIRED: 'Gas Assist requires Pistachio Wallet.',
    WALLET_NOT_CONNECTED: 'Connect Pistachio Wallet first.',
    SWAP_TOKENS_MISSING: 'Choose both swap tokens first.',
    SWAP_AMOUNT_INVALID: 'Enter a valid token amount.',
    SLIPPAGE_INVALID: 'The slippage setting is invalid.',
}

function diagnosticLines(error) {
    if (typeof error === 'string') return error ? [error] : []
    const lines = []
    const code = error?.code ? String(error.code) : ''
    const message = error?.message ? String(error.message) : ''
    if (code) lines.push(code)
    if (message && message !== code) lines.push(message)
    const extra = error?.details?.backendDetails ?? error?.details
    if (Array.isArray(extra?.mismatches) && extra.mismatches.length > 0) {
        lines.push(`fields: ${extra.mismatches.join(', ')}`)
    } else if (extra && typeof extra === 'object') {
        try {
            const serialized = JSON.stringify(extra)
            if (serialized && serialized !== '{}' && serialized.length < 500) lines.push(serialized)
        } catch {
            // Ignore details that cannot be shown.
        }
    }
    if (Number.isInteger(error?.status) && error.status > 0) lines.push(`HTTP ${error.status}`)
    return [...new Set(lines)]
}

/** Shows the friendly Gas Assist copy plus the live backend/wallet code for on-device debugging. */
export default function GasAssistError({ error }) {
    const code = typeof error === 'string' ? error : error?.code
    const message = messages[code] ?? 'Gas Assist could not complete this swap. Try again.'
    const diagnostics = diagnosticLines(error).filter((line) => line !== message)
    return (
        <div className="gas-assist-error" role="alert">
            <p>{message}</p>
            {diagnostics.length > 0 && (
                <pre className="gas-assist-error-diagnostics">{diagnostics.join('\n')}</pre>
            )}
        </div>
    )
}
