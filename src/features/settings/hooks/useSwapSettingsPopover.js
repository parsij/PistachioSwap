import { cloneElement, createElement, Fragment, isValidElement, useState } from 'react'

import { formatSlippageBps, getSlippageSeverity } from '../model/settingsValidation.js'
import { useSettingsDraft } from './useSettingsDraft.js'

/**
 * Coordinates Radix open state, trigger decoration, and the settings draft.
 * @param {object} config Persisted settings, trigger child, and settings callback.
 * @returns {object} Popover state, decorated trigger, draft API, and open callback.
 * @sideEffects Delegates valid settings changes to the persisted parent hook.
 */
export function useSwapSettingsPopover({ children, settings, onSettingsChange }) {
    const [open, setOpen] = useState(false)
    const draft = useSettingsDraft({ settings, open, onSettingsChange })
    const committedCustomBps = settings.slippageMode === 'custom' && Number.isInteger(settings.customSlippageBps) ? settings.customSlippageBps : null
    const committedSeverity = getSlippageSeverity(committedCustomBps)
    const settingsTrigger = createSettingsTrigger({ children, showValue: !open && committedCustomBps !== null, formattedValue: committedCustomBps === null ? '' : formatSlippageBps(committedCustomBps), severity: committedSeverity })

    function handleOpenChange(nextOpen) {
        if (nextOpen) {
            draft.resetFromSettings()
            setOpen(true)
            return
        }
        draft.commitOnClose()
        setOpen(false)
    }

    return { open, settingsTrigger, handleOpenChange, draft }
}

function createSettingsTrigger({ children, showValue, formattedValue, severity }) {
    if (!showValue || !isValidElement(children)) return children
    const existingClassName = children.props.className ?? ''
    return cloneElement(children, {
        className: [existingClassName, 'settings-trigger-with-value', `settings-trigger-${severity}`].filter(Boolean).join(' '),
        'aria-label': `Swap settings, custom slippage ${formattedValue}`,
        children: createElement(
            Fragment,
            null,
            createElement('span', { className: 'settings-trigger-value' }, formattedValue),
            createElement('span', { className: 'settings-trigger-icon' }, children.props.children),
        ),
    })
}
