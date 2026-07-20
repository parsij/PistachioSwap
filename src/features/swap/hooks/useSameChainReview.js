import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Purpose: owns same-chain review dialog state, captured quote identity, focus,
 * and review DOM diagnostics without performing execution work.
 * Inputs: `diagnostic` logger, request-key formatter, and the current quote
 * identity/selected quote for stale-dialog checks.
 * Output: dialog state, refs, and named open/close/progress/error operations.
 * Side effects: restores trigger focus and emits existing `review.*` diagnostics.
 * Errors: opening failures are returned to the caller through `openReview`.
 * Security: closes a review when its captured request identity changes.
 */
export function useSameChainReview({ diagnostic, requestKeySuffix, requestKey, selectedQuote }) {
    const [isOpen, setIsOpen] = useState(false)
    const [reviewError, setReviewError] = useState(null)
    const [reviewOperation, setReviewOperation] = useState('idle')
    const requestedOpenRef = useRef(false)
    const capturedIdentityRef = useRef(null)
    const confirmationPendingRef = useRef(false)
    const contentRef = useRef(null)
    const triggerRef = useRef(null)

    const closeReview = useCallback(() => {
        requestedOpenRef.current = false
        capturedIdentityRef.current = null
        setIsOpen(false)
        setReviewError(null)
        setReviewOperation('idle')
        confirmationPendingRef.current = false
        window.setTimeout(() => triggerRef.current?.focus(), 0)
    }, [])

    const handleOpenChange = useCallback((open) => {
        requestedOpenRef.current = open
        if (!open && confirmationPendingRef.current) return
        if (!open) capturedIdentityRef.current = null
        setIsOpen(open)
        if (!open) window.setTimeout(() => triggerRef.current?.focus(), 0)
    }, [])

    const openReview = useCallback(() => {
        setReviewError(null)
        setReviewOperation('idle')
        requestedOpenRef.current = true
        capturedIdentityRef.current = requestKey ?? null
        setIsOpen(true)
    }, [requestKey])
    const setConfirmationPending = useCallback((pending) => {
        confirmationPendingRef.current = pending
    }, [])

    useEffect(() => {
        if (!isOpen) return
        const openIdentity = capturedIdentityRef.current
        if (openIdentity && requestKey && openIdentity === requestKey) return
        diagnostic('review.closed', {
            reason: 'quote-identity-changed',
            openRequestKeySuffix: requestKeySuffix(openIdentity),
            currentRequestKeySuffix: requestKeySuffix(requestKey),
        }, 'warn')
        handleOpenChange(false)
    }, [diagnostic, handleOpenChange, isOpen, requestKey, requestKeySuffix])

    useEffect(() => {
        const content = contentRef.current
        diagnostic('review.open-state.changed', {
            requestedOpen: requestedOpenRef.current,
            actualOpen: isOpen,
            quotePresent: Boolean(selectedQuote),
            dialogMounted: Boolean(content?.isConnected),
            requestKeySuffix: requestKeySuffix(requestKey),
        })
        if (!isOpen) return undefined
        let measurementFrameId = null
        const frameId = window.requestAnimationFrame(() => {
            measurementFrameId = window.requestAnimationFrame(() => {
                const mountedContent = contentRef.current
                if (!mountedContent?.isConnected) {
                    diagnostic('review.dialog.mount-failed', { requestedOpen: requestedOpenRef.current, actualOpen: isOpen, contentMounted: false, requestKeySuffix: requestKeySuffix(requestKey) }, 'error')
                    return
                }
                const computed = window.getComputedStyle(mountedContent)
                const bounds = mountedContent.getBoundingClientRect()
                const centerX = bounds.left + bounds.width / 2
                const centerY = bounds.top + bounds.height / 2
                const topElement = bounds.width > 0 && bounds.height > 0 && document.elementFromPoint ? document.elementFromPoint(centerX, centerY) : null
                const behindApp = Boolean(topElement && topElement !== mountedContent && !mountedContent.contains(topElement))
                const topElementComputed = topElement ? window.getComputedStyle(topElement) : null
                const summary = { contentMounted: true, isConnected: mountedContent.isConnected, computedDisplay: computed.display, computedVisibility: computed.visibility, computedOpacity: computed.opacity, computedPointerEvents: computed.pointerEvents, computedZIndex: computed.zIndex, boundingClientRect: { width: bounds.width, height: bounds.height }, ariaHidden: mountedContent.getAttribute('aria-hidden'), dataState: mountedContent.getAttribute('data-state'), behindApp, topElementTag: topElement?.tagName?.toLowerCase?.() ?? null, topElementClass: typeof topElement?.className === 'string' ? topElement.className.slice(0, 160) : null, topElementZIndex: topElementComputed?.zIndex ?? null, dialogOpacity: computed.opacity, dialogPointerEvents: computed.pointerEvents, dialogDataState: mountedContent.getAttribute('data-state'), inlineStyleOpacity: mountedContent.style.opacity || null, inlineStylePointerEvents: mountedContent.style.pointerEvents || null }
                diagnostic('review.dialog.dom-summary', summary)
                diagnostic('review.opened', { requestKeySuffix: requestKeySuffix(requestKey), contentMounted: true })
                const failedProperties = []
                if (!mountedContent.isConnected) failedProperties.push('isConnected')
                if (computed.display === 'none') failedProperties.push('display')
                if (computed.visibility === 'hidden') failedProperties.push('visibility')
                if (!(Number(computed.opacity) > 0)) failedProperties.push('opacity')
                if (!(bounds.width > 0)) failedProperties.push('width')
                if (!(bounds.height > 0)) failedProperties.push('height')
                if (mountedContent.getAttribute('data-state') !== 'open') failedProperties.push('data-state')
                if (computed.pointerEvents === 'none') failedProperties.push('pointer-events')
                if (behindApp) failedProperties.push('stacking-order')
                if (failedProperties.length > 0) diagnostic('review.dialog.visibility-failed', { ...summary, failedProperties }, 'error')
            })
        })
        return () => { window.cancelAnimationFrame(frameId); if (measurementFrameId !== null) window.cancelAnimationFrame(measurementFrameId) }
    }, [diagnostic, isOpen, requestKey, requestKeySuffix, selectedQuote])

    return { isOpen, reviewError, reviewOperation, contentRef, triggerRef, openReview, closeReview, handleOpenChange, setReviewError, setReviewOperation, setConfirmationPending, clearReviewError: () => setReviewError(null) }
}
