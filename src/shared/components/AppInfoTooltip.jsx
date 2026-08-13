import { useCallback, useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'

const HOVER_CLOSE_DELAY_MS = 90
let activePinnedClose = null

/**
 * Small explanatory info control that supports both pointer hover and click/tap.
 * Hover stays open while the pointer is over either the icon or the explanation.
 * Click/tap pins it until an outside interaction or Escape closes it.
 */
export default function AppInfoTooltip({
    ariaLabel,
    children,
    icon,
    triggerClassName = 'swap-info-trigger',
    contentClassName = 'swap-info-tooltip',
    arrowClassName = 'swap-info-tooltip-arrow',
    side = 'top',
    align = 'center',
    sideOffset = 7,
    collisionPadding = 12,
    stopPropagation = false,
}) {
    const [open, setOpen] = useState(false)
    const contentId = useId()
    const triggerRef = useRef(null)
    const contentRef = useRef(null)
    const closeTimerRef = useRef(null)
    const pinnedRef = useRef(false)
    const triggerHoveredRef = useRef(false)
    const contentHoveredRef = useRef(false)

    const cancelScheduledClose = useCallback(() => {
        if (closeTimerRef.current !== null) {
            window.clearTimeout(closeTimerRef.current)
            closeTimerRef.current = null
        }
    }, [])

    const closeCompletely = useCallback(() => {
        if (activePinnedClose === closeCompletely) activePinnedClose = null
        pinnedRef.current = false
        triggerHoveredRef.current = false
        contentHoveredRef.current = false
        cancelScheduledClose()
        setOpen(false)
    }, [cancelScheduledClose])

    const scheduleTransientClose = useCallback(() => {
        cancelScheduledClose()
        if (pinnedRef.current) return
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null
            if (!pinnedRef.current && !triggerHoveredRef.current && !contentHoveredRef.current) {
                setOpen(false)
            }
        }, HOVER_CLOSE_DELAY_MS)
    }, [cancelScheduledClose])

    useEffect(() => () => {
        if (activePinnedClose === closeCompletely) activePinnedClose = null
        cancelScheduledClose()
    }, [cancelScheduledClose, closeCompletely])

    useEffect(() => {
        if (!open) return undefined

        function closeOnOutsidePointer(event) {
            if (!pinnedRef.current) return
            const target = event.target
            if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return
            closeCompletely()
        }

        document.addEventListener('pointerdown', closeOnOutsidePointer, true)
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
    }, [closeCompletely, open])

    function openFromHover() {
        triggerHoveredRef.current = true
        cancelScheduledClose()
        setOpen(true)
    }

    function leaveTrigger() {
        triggerHoveredRef.current = false
        scheduleTransientClose()
    }

    function enterContent() {
        contentHoveredRef.current = true
        cancelScheduledClose()
        setOpen(true)
    }

    function leaveContent() {
        contentHoveredRef.current = false
        scheduleTransientClose()
    }

    function pinOpen(event) {
        if (stopPropagation) event.stopPropagation()
        if (activePinnedClose && activePinnedClose !== closeCompletely) activePinnedClose()
        pinnedRef.current = true
        activePinnedClose = closeCompletely
        cancelScheduledClose()
        setOpen(true)
    }

    function stopPointerPropagation(event) {
        if (stopPropagation) event.stopPropagation()
    }

    function handleOpenChange(nextOpen) {
        if (nextOpen) {
            setOpen(true)
            return
        }
        closeCompletely()
    }

    return (
        <Popover.Root open={open} onOpenChange={handleOpenChange}>
            <Popover.Anchor asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    className={triggerClassName}
                    aria-label={ariaLabel}
                    aria-describedby={open ? contentId : undefined}
                    onPointerEnter={openFromHover}
                    onPointerLeave={leaveTrigger}
                    onMouseEnter={openFromHover}
                    onMouseLeave={leaveTrigger}
                    onFocus={openFromHover}
                    onBlur={leaveTrigger}
                    onPointerDown={stopPointerPropagation}
                    onClick={pinOpen}
                >
                    {icon}
                </button>
            </Popover.Anchor>
            <Popover.Portal container={document.body}>
                <Popover.Content
                    ref={contentRef}
                    id={contentId}
                    role="tooltip"
                    className={contentClassName}
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    collisionPadding={collisionPadding}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    onFocusOutside={(event) => {
                        if (pinnedRef.current) event.preventDefault()
                    }}
                    onPointerEnter={enterContent}
                    onPointerLeave={leaveContent}
                    onMouseEnter={enterContent}
                    onMouseLeave={leaveContent}
                    onPointerDown={stopPointerPropagation}
                    onClick={stopPointerPropagation}
                    onPointerDownOutside={(event) => {
                        if (triggerRef.current?.contains(event.target)) event.preventDefault()
                    }}
                >
                    {children}
                    <Popover.Arrow className={arrowClassName} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
