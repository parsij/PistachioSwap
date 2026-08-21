/*
 * Auto-scrolling chain bar that can be grabbed and dragged left or right.
 * CSS animation remains the no-JS fallback.
 */
(() => {
    const LOOP_SECONDS = 48

    function translateX(element) {
        const transform = getComputedStyle(element).transform
        if (!transform || transform === 'none') return 0
        const matrix3d = transform.match(/^matrix3d\((.+)\)$/)
        if (matrix3d) return Number(matrix3d[1].split(',')[12]) || 0
        const matrix = transform.match(/^matrix\((.+)\)$/)
        if (matrix) return Number(matrix[1].split(',')[4]) || 0
        return 0
    }

    function setup(root) {
        const track = root.querySelector('.network-ticker-track')
        if (!track) return

        let offset = translateX(track)
        let half = 0
        let dragging = false
        let pointerId = null
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

        const onDown = (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return
            dragging = true
            pointerId = event.pointerId
            lastX = event.clientX
            lastTime = 0
            root.classList.add('is-dragging')
            try {
                root.setPointerCapture(event.pointerId)
            } catch {
                /* older browsers */
            }
            event.preventDefault()
        }

        const onMove = (event) => {
            if (!dragging || event.pointerId !== pointerId) return
            offset = wrap(offset + (event.clientX - lastX))
            lastX = event.clientX
            apply()
        }

        const onUp = (event) => {
            if (!dragging || event.pointerId !== pointerId) return
            dragging = false
            pointerId = null
            lastTime = 0
            root.classList.remove('is-dragging')
            hoverPaused = root.matches(':hover')
        }

        root.classList.add('is-js')
        measure()
        offset = wrap(offset)
        apply()

        root.addEventListener('pointerdown', onDown)
        root.addEventListener('pointermove', onMove)
        root.addEventListener('pointerup', onUp)
        root.addEventListener('pointercancel', onUp)
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

        requestAnimationFrame(tick)
    }

    document.querySelectorAll('.network-ticker').forEach(setup)
})()
