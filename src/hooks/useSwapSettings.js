import { useState } from 'react'

import {
    readSwapSettings,
    writeSwapSettings,
} from '../services/swapSettings.js'

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
