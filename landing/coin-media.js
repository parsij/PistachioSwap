async function startThreeCoin(frame) {
    try {
        const { mountLiveCoin } = await import('./coin-live.js')
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

        await mountLiveCoin(frame, {
            animate: !reducedMotion,
            onFirstFrame: (canvas) => {
                frame.dataset.mediaMode = 'three'
                frame.classList.add('is-ready')
                canvas.classList.add('is-ready')
            },
        })
    } catch (error) {
        frame.dataset.mediaMode = 'css-fallback'
        frame.classList.add('is-failed')
        console.warn('[pistachio-swap] Three.js coin failed to start', error)
    }
}

export function setupLandingCoin() {
    const hero = document.querySelector('main .hero')
    if (!hero || hero.classList.contains('hero-with-coin')) return

    const copy = document.createElement('div')
    copy.className = 'hero-copy'
    while (hero.firstChild) copy.appendChild(hero.firstChild)

    const frame = document.createElement('div')
    frame.className = 'hero-coin-frame'
    frame.setAttribute('aria-hidden', 'true')

    hero.classList.add('hero-with-coin')
    hero.append(copy, frame)
    void startThreeCoin(frame)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLandingCoin, { once: true })
} else {
    setupLandingCoin()
}
