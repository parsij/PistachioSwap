import InfoTooltip from './InfoTooltip.jsx'

function WarningIcon() {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.63 2.63a1.58 1.58 0 0 1 2.74 0l7.08 12.27a1.58 1.58 0 0 1-1.37 2.37H2.92a1.58 1.58 0 0 1-1.37-2.37L8.63 2.63Z" fill="currentColor" /><path d="M10 6.3v5.1" fill="none" stroke="#191919" strokeLinecap="round" strokeWidth="1.8" /><circle cx="10" cy="14.1" r="1" fill="#191919" /></svg>
}

/**
 * Renders the max-slippage section and delegates draft/focus behavior to the settings hook.
 * @param {object} props Draft values, validation state, refs, and semantic callbacks.
 * @returns {import('react').ReactElement} Existing slippage labels, controls, warnings, and error alert.
 * @sideEffects Input callbacks may persist valid settings through the owning hook; no storage is accessed here.
 * @accessibility Preserves the existing button, input, status, alert, and tooltip labels.
 */
export default function SlippageSettingsSection({ draft }) {
    return <section className="slippage-setting">
        <div className="slippage-setting-row">
            <div className="slippage-label-column">
                <div className="settings-row-label"><span>Max slippage</span><InfoTooltip label="The maximum price movement allowed before the transaction is cancelled." /></div>
                {draft.warningLabel && <div className={['slippage-warning', `slippage-warning-${draft.activeSeverity}`].join(' ')} role="status"><WarningIcon /><span>{draft.warningLabel}</span></div>}
            </div>
            <div className={['slippage-combined-control', draft.isAuto ? 'is-auto' : 'is-custom', draft.activeSeverity === 'high' ? 'is-high' : '', draft.activeSeverity === 'very-high' ? 'is-very-high' : '', draft.customError ? 'is-invalid' : ''].filter(Boolean).join(' ')}>
                <button ref={draft.autoButtonRef} type="button" className="slippage-auto-button" onClick={draft.selectAuto} aria-pressed={draft.isAuto} aria-label="Use automatic slippage of 2.5%">Auto</button>
                <label className="slippage-custom-control" onPointerDown={draft.handleCustomPointerDown}>
                    <span className="sr-only">Custom slippage percentage</span>
                    <input ref={draft.customInputRef} value={draft.customInput} onChange={draft.updateCustom} onFocus={draft.handleCustomFocus} onBlur={draft.handleCustomBlur} onKeyDown={draft.handleCustomKeyDown} inputMode="decimal" autoComplete="off" spellCheck="false" placeholder="" aria-label="Custom slippage percentage" aria-invalid={Boolean(draft.customError)} />
                    <span className="slippage-percent-symbol" aria-hidden="true">%</span>
                </label>
            </div>
        </div>
        {draft.customError && draft.customInput.trim() !== '' && <p className="settings-error" role="alert">{draft.customError}</p>}
    </section>
}
