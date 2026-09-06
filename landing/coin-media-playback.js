function setupCoinPlaybackFallback() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const video = document.querySelector('.hero-coin-video')

    if (!video || reducedMotion.matches) return

    // Safari is stricter about autoplay policy than most Chromium browsers.
    // Set both the DOM properties and the literal boolean attributes before
    // retrying playback so iPhone Safari sees a muted inline autoplay video.
    video.muted = true
    video.defaultMuted = true
    video.autoplay = true
    video.loop = true
    video.playsInline = true
    video.controls = false
    video.preload = 'auto'

    video.setAttribute('muted', '')
    video.setAttribute('autoplay', '')
    video.setAttribute('loop', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.removeAttribute('controls')

    let interactionRetryInstalled = false

    const tryPlay = () => {
        if (reducedMotion.matches || !video.src || document.hidden) return

        video.muted = true
        const playback = video.play()
        if (!playback?.catch) return

        playback.catch(() => {
            // iOS may reject autoplay, notably under Low Power Mode or another
            // media policy. The first user interaction is then allowed to start
            // the same muted inline video without exposing controls.
            if (interactionRetryInstalled) return
            interactionRetryInstalled = true

            const resumeFromInteraction = () => {
                video.muted = true
                video.play().catch(() => {})
            }

            document.addEventListener('touchstart', resumeFromInteraction, {
                once: true,
                passive: true,
            })
            document.addEventListener('pointerdown', resumeFromInteraction, {
                once: true,
                passive: true,
            })
        })
    }

    video.addEventListener('loadeddata', tryPlay)
    video.addEventListener('canplay', tryPlay)
    window.addEventListener('pageshow', tryPlay)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tryPlay()
    })

    tryPlay()
}

function startCoinPlaybackFallback() {
    // coin-media.js is imported before this module and creates the hero coin on
    // DOMContentLoaded. Waiting one animation frame also covers cached/instant
    // module execution and keeps this helper independent of creation order.
    requestAnimationFrame(setupCoinPlaybackFallback)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCoinPlaybackFallback, { once: true })
} else {
    startCoinPlaybackFallback()
}
