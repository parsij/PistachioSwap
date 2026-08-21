/*
 * Auto-scrolling chain bar. Hold the left mouse button (or a finger) and
 * drag left or right to scrub. CSS animation remains the no-JS fallback.
 */
(() => {
    const LOOP_SECONDS = 48

    function setup(root) {
        const track = root.querySelector('.network-ticker-track')
        if (!track) return

        root.classList.add('is-js')

        let offset = 0
        let half = 0
        let dragging = false
        let lastX = 0
        let lastTime = 0
        let hoverPaused = false
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

        const measure = () => {
            half = track.scrollWidth / 2
        }

        const wrap = (value) => {
            if (half <= 0) return value
            let next = value % half
            if (next > 0) next -= half
            if (next < -half) next += half
            return next
        }

        const apply = () => {
            track.style.transform = `translate3d(${offset}px, 0, 0)`
        }

        const tick = (now) => {
            if (!dragging && !hoverPaused && !reducedMotion.matches && half > 0) {
                const dt = lastTime ? (now - lastTime) / 1000 : 0
                offset = wrap(offset - (half / LOOP_SECONDS) * dt)
                apply()
            }
            lastTime = now
            requestAnimationFrame(tick)
        }

        const dragTo = (clientX) => {
            if (!dragging) return
            if (half <= 0) measure()
            offset = wrap(offset + (clientX - lastX))
            lastX = clientX
            apply()
        }

        const endDrag = () => {
            if (!dragging) return
            dragging = false
            lastTime = 0
            root.classList.remove('is-dragging')
            hoverPaused = root.matches(':hover')
            window.removeEventListener('pointermove', onWindowPointerMove, true)
            window.removeEventListener('pointerup', onWindowPointerUp, true)
            window.removeEventListener('mousemove', onWindowPointerMove, true)
            window.removeEventListener('mouseup', onWindowPointerUp, true)
        }

        const startDrag = (clientX) => {
            if (dragging) return
            if (half <= 0) measure()
            dragging = true
            lastX = clientX
            lastTime = 0
            hoverPaused = false
            root.classList.add('is-dragging')
            window.addEventListener('pointermove', onWindowPointerMove, true)
            window.addEventListener('pointerup', onWindowPointerUp, true)
            window.addEventListener('mousemove', onWindowPointerMove, true)
            window.addEventListener('mouseup', onWindowPointerUp, true)
        }

        const onWindowPointerMove = (event) => {
            dragTo(event.clientX)
        }

        const onWindowPointerUp = () => {
            endDrag()
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

        root.addEventListener('pointerenter', () => {
            if (!dragging) hoverPaused = true
        })
        root.addEventListener('pointerleave', () => {
            if (!dragging) hoverPaused = false
        })

        window.addEventListener('resize', () => {
            const previous = half
            measure()
            if (previous > 0 && half > 0) offset = wrap(offset * (half / previous))
            apply()
        })

        measure()
        apply()
        requestAnimationFrame(tick)
    }

    const start = () => {
        document.querySelectorAll('.network-ticker').forEach(setup)
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start)
    } else {
        start()
    }
})()
