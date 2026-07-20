import { useState } from 'react'

import {
    readSwapSettings,
    writeSwapSettings,
} from '../services/swapSettings.js'

/**
 * Owns validated persisted swap settings.
 * @returns {[object, Function]} Current settings and a setter that normalizes/writes storage.
 * @sideEffects Reads localStorage on initialization and writes it on updates.
 */
export function useSwapSettings() {
    const [settings, setSettingsState] = useState(() => readSwapSettings())

    function setSettings(next) {
        setSettingsState((current) => {
            const value = typeof next === 'function' ? next(current) : next
            return writeSwapSettings(value)
        })
    }

    return [settings, setSettings]
}
