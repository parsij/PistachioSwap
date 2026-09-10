import { InfoIcon } from '../../../shared/components/AppIcons.jsx'
import AppInfoTooltip from '../../../shared/components/AppInfoTooltip.jsx'
import { GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE } from '../../../services/swapExecutionMode.js'
import './TransactionStatus.css'

const GAS_ASSIST_GAS_EXPLANATION =
    "Every blockchain transaction needs gas, paid with that network's native token. On BNB Chain, gas is paid in BNB. Because this wallet is short on BNB, PistachioSwap can sponsor it; the exact Gas Assist fee is shown before you confirm."

function visibleQuoteStatusMessage(message) {
    const text = String(message ?? '').trim()
    if (!text) return null

    const normalized = text.toLowerCase()
    if (
        normalized.includes('gas cap') ||
        normalized.includes('no usable sponsored route') ||
        normalized.includes('no economically valid gas assist route')
    ) {
        return null
    }

    return text
}

/**
 * Renders native-balance, execution-mode, and current visible swap status messages.
 * Internal route-cap failures stay behind the compact "No usable quote" CTA instead
 * of exposing implementation details below the quote.
 */
export default function TransactionStatus({
    nativeBalanceError,
    nativeSymbol,
    executionMessage,
    statusMessage,
}) {
    const showGasAssistInfo = executionMessage === GAS_ASSIST_LOW_NATIVE_BALANCE_MESSAGE
    const visibleStatusMessage = visibleQuoteStatusMessage(statusMessage)

    return (
        <>
            {nativeBalanceError && (
                <p className="swap-status" role="status">
                    Unable to verify the {nativeSymbol} balance. Quoting is disabled.
                </p>
            )}
            {executionMessage && (
                <p className="swap-status" role="status">
                    {executionMessage}
                    {showGasAssistInfo && (
                        <span className="swap-status-info-inline">
                            <AppInfoTooltip
                                ariaLabel="Why Gas Assist needs BNB"
                                icon={<InfoIcon />}
                            >
                                {GAS_ASSIST_GAS_EXPLANATION}
                            </AppInfoTooltip>
                        </span>
                    )}
                </p>
            )}
            {visibleStatusMessage && (
                <p className="swap-status" role="status" aria-live="polite">{visibleStatusMessage}</p>
            )}
        </>
    )
}
