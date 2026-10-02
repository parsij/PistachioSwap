import { useEffect } from 'react'
import { Search } from 'lucide-react'

import './HeaderSearch.css'

function isTextEntryTarget(target) {
    if (!(target instanceof Element)) return false
    return Boolean(
        target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
    )
}

/**
 * Global token-search trigger. The slash shortcut mirrors mature trading UIs
 * without stealing keystrokes from form controls.
 */
export default function HeaderSearch({ label = 'Search', onOpen }) {
    useEffect(() => {
        function handleKeyDown(event) {
            if (
                event.key !== '/' ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                isTextEntryTarget(event.target)
            ) return

            event.preventDefault()
            onOpen?.()
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onOpen])

    return (
        <button
            type="button"
            className="header-search"
            aria-label={`${label} tokens`}
            onClick={onOpen}
        >
            <Search className="header-search-icon" aria-hidden="true" />
            <span className="header-search-label">{label}</span>
            <kbd className="header-search-shortcut" aria-hidden="true">/</kbd>
        </button>
    )
}
