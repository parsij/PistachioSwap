const SHEET_SELECTOR = '.wallet-dialog.wallet-account-dialog.uni-wallet-dialog'
const HANDLE_SELECTOR = '.uni-wallet-mobile-close'

let activeDrag = null
let suppressNextClick = false

function getSheetFromHandle(handle) {
    return handle.closest(SHEET_SELECTOR)
}

function resetSheet(sheet) {
    sheet.classList.remove('is-dragging', 'is-dismissing')
    sheet.style.removeProperty('--wallet-sheet-drag-y')
}

function beginDrag(event) {
    const handle = event.target.closest?.(HANDLE_SELECTOR)
    if (!handle) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const sheet = getSheetFromHandle(handle)
    if (!sheet) return

    const now = performance.now()
    activeDrag = {
        pointerId: event.pointerId,
        handle,
        sheet,
        startY: event.clientY,
        lastY: event.clientY,
        lastTime: now,
        velocityY: 0,
        distance: 0,
        moved: false,
    }

    handle.setPointerCapture?.(event.pointerId)
    sheet.classList.add('is-dragging')
}

function moveDrag(event) {
    const drag = activeDrag
    if (!drag || drag.pointerId !== event.pointerId) return

    const now = performance.now()
    const elapsed = Math.max(1, now - drag.lastTime)
    const stepY = event.clientY - drag.lastY
    drag.velocityY = stepY / elapsed
    drag.lastY = event.clientY
    drag.lastTime = now

    const distance = Math.max(0, event.clientY - drag.startY)
    drag.distance = distance
    drag.moved ||= distance > 4

    if (drag.moved) event.preventDefault()
    drag.sheet.style.setProperty('--wallet-sheet-drag-y', `${distance}px`)
}

function finishDrag(event, cancelled = false) {
    const drag = activeDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    activeDrag = null

    if (drag.handle.hasPointerCapture?.(event.pointerId)) {
        drag.handle.releasePointerCapture(event.pointerId)
    }

    const distanceThreshold = Math.min(150, drag.sheet.offsetHeight * 0.2)
    const fastDownwardFlick = drag.distance > 28 && drag.velocityY > 0.65
    const shouldDismiss = !cancelled &&
        (drag.distance >= distanceThreshold || fastDownwardFlick)

    if (drag.moved) suppressNextClick = true

    drag.sheet.classList.remove('is-dragging')

    if (shouldDismiss) {
        drag.sheet.classList.add('is-dismissing')
        drag.sheet.style.setProperty(
            '--wallet-sheet-drag-y',
            `${Math.max(window.innerHeight, drag.distance + drag.sheet.offsetHeight)}px`,
        )

        window.setTimeout(() => {
            suppressNextClick = false
            drag.handle.click()
            resetSheet(drag.sheet)
        }, 190)
        return
    }

    drag.sheet.style.setProperty('--wallet-sheet-drag-y', '0px')
    window.setTimeout(() => resetSheet(drag.sheet), 190)
}

function suppressDraggedClick(event) {
    if (!suppressNextClick || !event.target.closest?.(HANDLE_SELECTOR)) return
    suppressNextClick = false
    event.preventDefault()
    event.stopPropagation()
}

document.addEventListener('pointerdown', beginDrag, true)
document.addEventListener('pointermove', moveDrag, { capture: true, passive: false })
document.addEventListener('pointerup', (event) => finishDrag(event), true)
document.addEventListener('pointercancel', (event) => finishDrag(event, true), true)
document.addEventListener('click', suppressDraggedClick, true)
