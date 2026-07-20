import { useEffect, useRef, useState } from 'react'

import {
    AUTO_SLIPPAGE_BPS,
    formatSlippageInput,
    getSlippageSeverity,
    getWarningLabel,
    parseSlippageInput,
} from '../model/settingsValidation.js'

/**
 * Owns the temporary slippage draft while the persisted settings object remains
 * authoritative. Valid values retain the existing immediate parent update behavior.
 * @param {object} config Persisted settings, open state, and change callback.
 * @returns {object} Draft values, validation state, refs, and semantic handlers.
 * @sideEffects Calls `onSettingsChange` for valid edits/close commits and schedules focus via rAF.
 * @security Invalid or empty custom values fall back to automatic slippage on close.
 */
export function useSettingsDraft({ settings, open, onSettingsChange }) {
    const autoButtonRef = useRef(null)
    const customInputRef = useRef(null)
    const [draftMode, setDraftMode] = useState(settings.slippageMode)
    const [customInput, setCustomInput] = useState(() => initialCustomInput(settings))
    const [customError, setCustomError] = useState(null)
    const persistedMode = settings.slippageMode
    const persistedCustomBps = settings.customSlippageBps
    const isAuto = draftMode === 'auto'
    const isCustom = draftMode === 'custom'
    const parsedDraft = parseSlippageInput(customInput)
    const draftCustomBps = parsedDraft.valid ? parsedDraft.bps : null
    const activeSeverity = isCustom ? getSlippageSeverity(draftCustomBps) : 'normal'
    const warningLabel = getWarningLabel(activeSeverity)

    useEffect(() => {
        if (open) return
        setDraftMode(persistedMode)
        setCustomInput(initialCustomInput({ slippageMode: persistedMode, customSlippageBps: persistedCustomBps }))
        setCustomError(null)
    }, [open, persistedCustomBps, persistedMode])

    function selectAuto() {
        setDraftMode('auto')
        setCustomError(null)
        setCustomInput(formatSlippageInput(AUTO_SLIPPAGE_BPS))
        onSettingsChange({ ...settings, slippageMode: 'auto' })
    }

    function beginCustomEditing() {
        if (isCustom) {
            customInputRef.current?.focus()
            return
        }
        setDraftMode('custom')
        setCustomInput('')
        setCustomError(null)
        window.requestAnimationFrame(() => customInputRef.current?.focus())
    }

    function handleCustomPointerDown(event) {
        if (!isCustom) {
            event.preventDefault()
            beginCustomEditing()
        }
    }

    function handleCustomFocus() {
        if (!isCustom) beginCustomEditing()
    }

    function updateCustom(event) {
        const nextValue = event.target.value
        if (!/^\d*(?:\.\d{0,2})?$/.test(nextValue)) return
        setDraftMode('custom')
        setCustomInput(nextValue)
        const parsed = parseSlippageInput(nextValue)
        if (parsed.empty) {
            setCustomError(null)
            return
        }
        if (!parsed.valid) {
            setCustomError(parsed.error)
            return
        }
        setCustomError(null)
        onSettingsChange({ ...settings, slippageMode: 'custom', customSlippageBps: parsed.bps })
    }

    function handleCustomBlur() {
        const parsed = parseSlippageInput(customInput)
        if (parsed.empty) {
            setCustomError(null)
            return
        }
        if (!parsed.valid) {
            setCustomError(parsed.error)
            return
        }
        setCustomInput(formatSlippageInput(parsed.bps))
        setCustomError(null)
    }

    function handleCustomKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault()
            customInputRef.current?.blur()
        }
        if (event.key === 'Escape') {
            event.preventDefault()
            const committed = Number.isInteger(settings.customSlippageBps)
            setDraftMode(committed ? 'custom' : 'auto')
            setCustomInput(formatSlippageInput(committed ? settings.customSlippageBps : AUTO_SLIPPAGE_BPS))
            setCustomError(null)
            customInputRef.current?.blur()
        }
    }

    function resetFromSettings() {
        setDraftMode(settings.slippageMode)
        setCustomInput(initialCustomInput(settings))
        setCustomError(null)
    }

    function commitOnClose() {
        const parsed = parseSlippageInput(customInput)
        if (isCustom && parsed.valid) {
            onSettingsChange({ ...settings, slippageMode: 'custom', customSlippageBps: parsed.bps })
        }
        if (isCustom && !parsed.valid) {
            onSettingsChange({ ...settings, slippageMode: 'auto' })
            setDraftMode('auto')
            setCustomInput(formatSlippageInput(AUTO_SLIPPAGE_BPS))
            setCustomError(null)
        }
    }

    return { autoButtonRef, customInputRef, isAuto, isCustom, customInput, customError, activeSeverity, warningLabel, selectAuto, beginCustomEditing, handleCustomPointerDown, handleCustomFocus, updateCustom, handleCustomBlur, handleCustomKeyDown, resetFromSettings, commitOnClose }
}

function initialCustomInput(settings) {
    return settings.slippageMode === 'custom' && Number.isInteger(settings.customSlippageBps)
        ? formatSlippageInput(settings.customSlippageBps)
        : formatSlippageInput(AUTO_SLIPPAGE_BPS)
}
