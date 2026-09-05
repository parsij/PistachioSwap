import './coin-media.js'

/*
 * Auto-scrolling chain bar. Drag left or right with the mouse (or a finger)
 * to scrub. CSS animation remains the no-JS fallback.
 */
function setupTicker(root) {
    const track = root.querySelector('.network-ticker-track')
    if (!track) return

    root.classList.add('is-js')

    let half = 0
    let dragging = false
    let startX = 0
    let startScroll = 0
    let lastTime = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const LOOP_SECONDS = 48

    const measure = () => {
        half = Math.floor(track.scrollWidth / 2)
    }

    const wrapScroll = () => {
        if (half <= 0) return
        if (root.scrollLeft >= half) root.scrollLeft -= half
        else if (root.scrollLeft < 0) root.scrollLeft += half
    }

    const tick = (now) => {
        if (!dragging && !reducedMotion.matches && half > 0) {
            const dt = lastTime ? (now - lastTime) / 1000 : 0
            root.scrollLeft += (half / LOOP_SECONDS) * dt
            wrapScroll()
        }
        lastTime = now
        requestAnimationFrame(tick)
    }

    const onMove = (clientX) => {
        if (!dragging) return
        root.scrollLeft = startScroll - (clientX - startX)
        wrapScroll()
        startX = clientX
        startScroll = root.scrollLeft
    }

    const endDrag = () => {
        if (!dragging) return
        dragging = false
        lastTime = 0
        root.classList.remove('is-dragging')
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', endDrag)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', endDrag)
    }

    const startDrag = (clientX) => {
        if (dragging) return
        if (half <= 0) measure()
        dragging = true
        startX = clientX
        startScroll = root.scrollLeft
        lastTime = 0
        root.classList.add('is-dragging')
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', endDrag)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', endDrag)
    }

    const onPointerMove = (event) => {
        onMove(event.clientX)
    }

    const onMouseMove = (event) => {
        if (event.buttons !== 1) {
            endDrag()
            return
        }
        onMove(event.clientX)
    }

    root.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        startDrag(event.clientX)
    }, { passive: false })

    root.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        startDrag(event.clientX)
    })

    root.addEventListener('dragstart', (event) => {
        event.preventDefault()
    })

    window.addEventListener('resize', measure)
    track.querySelectorAll('img').forEach((image) => {
        if (!image.complete) image.addEventListener('load', measure, { once: true })
    })

    measure()
    requestAnimationFrame(tick)
}

function startTickers() {
    document.querySelectorAll('.network-ticker').forEach(setupTicker)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startTickers)
} else {
    startTickers()
}
