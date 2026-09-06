import './mobile-stability.css'
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

/*
 * Native <details> toggles remove their contents immediately when closing, so
 * CSS alone cannot reliably animate both directions. Keep the element open
 * until the closing height animation finishes, and reverse from the current
 * visual height if the user clicks again mid-animation.
 */
export function setupFaqDetails(details) {
    const summary = details.querySelector(':scope > summary')
    if (!summary) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let desiredOpen = details.open
    let animation = null
    let animationId = 0

    const clearAnimatedStyles = () => {
        details.style.removeProperty('height')
        details.style.removeProperty('overflow')
    }

    const setOpen = (nextOpen) => {
        desiredOpen = nextOpen

        if (reducedMotion.matches || typeof details.animate !== 'function') {
            animationId += 1
            animation?.cancel()
            animation = null
            details.open = nextOpen
            clearAnimatedStyles()
            return
        }

        const id = ++animationId
        const currentHeight = details.getBoundingClientRect().height
        animation?.cancel()

        if (nextOpen && !details.open) details.open = true

        details.style.height = `${currentHeight}px`
        details.style.overflow = 'hidden'

        const targetHeight = nextOpen
            ? details.scrollHeight
            : summary.getBoundingClientRect().height

        animation = details.animate(
            [
                { height: `${currentHeight}px` },
                { height: `${targetHeight}px` },
            ],
            {
                duration: 260,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
        )

        animation.onfinish = () => {
            if (id !== animationId) return
            details.open = nextOpen
            animation = null
            clearAnimatedStyles()
        }
        animation.oncancel = () => {
            if (id === animationId) animation = null
        }
    }

    summary.addEventListener('click', (event) => {
        event.preventDefault()
        setOpen(!desiredOpen)
    })
}

function startLandingInteractions() {
    document.querySelectorAll('.network-ticker').forEach(setupTicker)
    document.querySelectorAll('.faq details').forEach(setupFaqDetails)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLandingInteractions)
} else {
    startLandingInteractions()
}
