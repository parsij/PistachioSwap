import { useCallback, useEffect, useState } from 'react'

/** Keep input focus while navigating results; trap Tab across the search and its preview. */
export function useSearchNavigation(modalRef, inputRef, searchKey) {
    const [activeIndex, setActiveIndex] = useState(0)
    useEffect(() => setActiveIndex(0), [searchKey])
    useEffect(() => {
        const previous = document.activeElement
        const focus = window.setTimeout(() => inputRef.current?.focus(), 50)
        return () => {
            window.clearTimeout(focus)
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
        }
    }, [inputRef])

    const rows = useCallback(() => [...(modalRef.current?.querySelectorAll('[data-search-result]') ?? [])], [modalRef])
    useEffect(() => {
        const selected = rows()[activeIndex]
        if (activeIndex > 0) selected?.scrollIntoView?.({ block: 'nearest' })
    }, [activeIndex, rows])

    useEffect(() => {
        function trapTab(event) {
            if (event.key !== 'Tab') return
            const controls = [...(modalRef.current?.querySelectorAll('input, button, a[href], [tabindex="0"]') ?? []),
                ...document.querySelectorAll('.token-hover-card button')]
                .filter((node) => !node.disabled && node.getClientRects().length > 0)
            const current = controls.indexOf(document.activeElement)
            if (controls.length && (current < 0 || (!event.shiftKey && current === controls.length - 1) || (event.shiftKey && current === 0))) {
                event.preventDefault()
                controls[event.shiftKey ? controls.length - 1 : 0].focus()
            }
        }
        document.addEventListener('keydown', trapTab)
        return () => document.removeEventListener('keydown', trapTab)
    }, [modalRef])

    function onKeyDown(event) {
        if (event.target === inputRef.current && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault()
            const results = rows()
            if (!results.length) return
            if (event.key === 'Enter') results[Math.min(activeIndex, results.length - 1)]?.click()
            else setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
        }
    }
    return { activeIndex, setActiveIndex, onKeyDown }
}
