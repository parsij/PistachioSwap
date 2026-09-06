const RELEASE_BASE = 'https://github.com/parsij/3d-gold-coin/releases/download/landing-media'

const MEDIA = {
    posterWebp: `${RELEASE_BASE}/coin-poster.webp`,
    posterJpg: `${RELEASE_BASE}/coin-poster.jpg`,
    low: `${RELEASE_BASE}/coin-low.mp4`,
    medium: `${RELEASE_BASE}/coin-medium.mp4`,
    high: `${RELEASE_BASE}/coin-high.mp4`,
    ultra: `${RELEASE_BASE}/coin-ultra.mp4`,
}

const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra']
const VIDEO_START_TIMEOUT_MS = 6000
const VIDEO_ADVANCE_CHECK_MS = 1800
const IS_IOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const HERO_STYLES = `
.hero.hero-with-coin {
    display: grid;
    grid-template-columns: minmax(0, 1.06fr) minmax(360px, 0.94fr);
    gap: clamp(32px, 5vw, 72px);
    align-items: center;
    min-height: min(680px, calc(100vh - 112px));
    padding: 62px 0 34px;
    text-align: left;
}

.hero-with-coin .hero-copy { min-width: 0; }
.hero-with-coin .eyebrow { margin-bottom: 24px; }
.hero-with-coin .hero-signature {
    margin: 0 0 20px;
    font-size: clamp(56px, 7vw, 94px);
    transform-origin: left center;
}
.hero-with-coin h1 {
    max-width: 17ch;
    margin-inline: 0;
    font-size: clamp(35px, 4.3vw, 54px);
}
.hero-with-coin .hero-lede {
    max-width: 56ch;
    margin: 24px 0 0;
}
.hero-with-coin .hero-actions { justify-content: flex-start; }

.hero-coin-frame {
    position: relative;
    width: min(100%, 560px);
    aspect-ratio: 1;
    margin-left: auto;
    isolation: isolate;
}

.hero-coin-frame::before {
    position: absolute;
    z-index: -1;
    inset: 15%;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(138 194 124 / 12%), transparent 70%);
    content: '';
    filter: blur(24px);
    pointer-events: none;
}

.hero-coin-poster,
.hero-coin-video,
.hero-coin-live {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    -webkit-mask-image: radial-gradient(circle at center, #000 62%, rgb(0 0 0 / 92%) 76%, transparent 98%);
    mask-image: radial-gradient(circle at center, #000 62%, rgb(0 0 0 / 92%) 76%, transparent 98%);
    pointer-events: none;
}

/* Keep video visible to WebKit while it starts. The poster hides it from the user. */
.hero-coin-video {
    z-index: 1;
    opacity: 1;
}

.hero-coin-live {
    z-index: 2;
    opacity: 0;
    transition: opacity 260ms ease;
}
.hero-coin-live.is-ready { opacity: 1; }

.hero-coin-poster {
    z-index: 3;
    opacity: 1;
    transition: opacity 260ms ease;
}
.hero-coin-poster.is-faded { opacity: 0; }

@media (max-width: 900px) {
    .hero.hero-with-coin {
        grid-template-columns: 1fr;
        gap: 18px;
        min-height: 0;
        padding-top: 44px;
        text-align: center;
    }
    .hero-with-coin .hero-signature {
        margin-inline: auto;
        transform-origin: center;
    }
    .hero-with-coin h1 {
        max-width: 24ch;
        margin-inline: auto;
    }
    .hero-with-coin .hero-lede { margin-inline: auto; }
    .hero-with-coin .hero-actions { justify-content: center; }
    .hero-coin-frame {
        width: min(100%, 500px);
        margin: 2px auto 0;
    }
}

@media (max-width: 520px) {
    .hero.hero-with-coin {
        gap: 12px;
        padding-bottom: 20px;
    }
    .hero-coin-frame {
        width: min(112vw, 430px);
        margin-top: -2px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .hero-coin-video,
    .hero-coin-live { display: none; }
    .hero-coin-poster { opacity: 1 !important; }
}
`

function isHighEndIOS() {
    if (!IS_IOS) return false
    const dpr = window.devicePixelRatio || 1
    const cores = navigator.hardwareConcurrency || 6
    const longSide = Math.max(window.screen?.width || 0, window.screen?.height || 0)
    return dpr >= 3 && cores >= 6 && longSide * dpr >= 2550
}

function qualityIndex(name) {
    return Math.max(0, QUALITY_ORDER.indexOf(name))
}

function displayQuality(frame) {
    const dprCap = isHighEndIOS() ? 3 : 2
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    const targetPixels = Math.max(frame.clientWidth, 320) * dpr
    if (targetPixels <= 520) return 'low'
    if (targetPixels <= 820) return 'medium'
    if (targetPixels <= 1050) return 'high'
    return 'ultra'
}

function connectionQuality() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    if (!connection) return isHighEndIOS() ? 'ultra' : 'high'
    if (connection.saveData) return 'low'

    const effectiveType = String(connection.effectiveType || '').toLowerCase()
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'low'
    if (effectiveType === '3g') return 'medium'

    const downlink = Number(connection.downlink)
    if (Number.isFinite(downlink) && downlink > 0) {
        if (downlink < 1.5) return 'low'
        if (downlink < 4) return 'medium'
        if (downlink < 10) return 'high'
        return 'ultra'
    }

    return effectiveType === '4g' ? 'high' : 'medium'
}

function chooseAutomaticQuality(frame) {
    if (isHighEndIOS()) return 'ultra'
    const byDisplay = displayQuality(frame)
    const byConnection = connectionQuality()
    return QUALITY_ORDER[Math.min(qualityIndex(byDisplay), qualityIndex(byConnection))]
}

function installStyles() {
    if (document.getElementById('hero-coin-styles')) return
    const style = document.createElement('style')
    style.id = 'hero-coin-styles'
    style.textContent = HERO_STYLES
    document.head.appendChild(style)
}

function createCoinMedia() {
    const frame = document.createElement('div')
    frame.className = 'hero-coin-frame'
    frame.setAttribute('aria-hidden', 'true')

    const picture = document.createElement('picture')
    picture.className = 'hero-coin-picture'

    const source = document.createElement('source')
    source.type = 'image/webp'
    source.srcset = MEDIA.posterWebp

    const poster = document.createElement('img')
    poster.className = 'hero-coin-poster'
    poster.src = MEDIA.posterJpg
    poster.alt = ''
    poster.width = 1080
    poster.height = 1080
    poster.loading = 'eager'
    poster.decoding = 'async'
    poster.fetchPriority = 'high'
    picture.append(source, poster)

    const video = document.createElement('video')
    video.className = 'hero-coin-video'
    video.muted = true
    video.defaultMuted = true
    video.autoplay = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.poster = MEDIA.posterJpg
    video.disablePictureInPicture = true
    video.disableRemotePlayback = true
    video.setAttribute('tabindex', '-1')
    video.setAttribute('muted', '')
    video.setAttribute('autoplay', '')
    video.setAttribute('loop', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')

    frame.append(video, picture)
    return { frame, poster, video }
}

function createController(video, poster, frame) {
    let mode = 'poster'
    let videoQualityMode = 'auto'
    let activeVideoQuality = null
    let playbackGeneration = 0
    let videoCleanup = null
    let liveCleanup = null
    let activeAttemptPlay = null
    let liveReason = null

    const resolveVideoQuality = () =>
        videoQualityMode === 'auto' ? chooseAutomaticQuality(frame) : videoQualityMode

    const clearVideoAttempt = () => {
        playbackGeneration += 1
        activeAttemptPlay = null
        videoCleanup?.()
        videoCleanup = null
    }

    const stopVideo = ({ clearSource = false } = {}) => {
        try { video.pause() } catch {}
        if (clearSource) {
            video.removeAttribute('src')
            try { video.load() } catch {}
        }
    }

    const stopLive = () => {
        liveCleanup?.()
        liveCleanup = null
        delete frame.dataset.liveFallback
        delete frame.dataset.liveFallbackReason
    }

    const startLive = async (reason = 'manual-rendering-on') => {
        if (mode === 'rendering' && liveCleanup) return 'rendering'

        clearVideoAttempt()
        stopVideo({ clearSource: true })
        stopLive()

        mode = 'rendering'
        liveReason = reason
        frame.dataset.mediaMode = 'live-loading'
        frame.dataset.liveFallback = 'loading'
        frame.dataset.liveFallbackReason = reason
        video.style.visibility = 'hidden'
        poster.classList.remove('is-faded')

        try {
            const { mountLiveCoin } = await import('./coin-live.js')
            const cleanup = await mountLiveCoin(frame, {
                quality: 'auto',
                onFirstFrame: (canvas) => {
                    if (mode !== 'rendering') return
                    frame.dataset.liveFallback = 'ready'
                    frame.dataset.mediaMode = 'rendering'
                    canvas.classList.add('is-ready')
                    poster.classList.add('is-faded')
                },
            })

            if (mode !== 'rendering') {
                cleanup?.()
                return mode
            }

            liveCleanup = cleanup
            return 'rendering'
        } catch (error) {
            frame.dataset.liveFallback = 'failed'
            mode = 'poster'
            poster.classList.remove('is-faded')
            console.warn('[pistachio-swap] live coin render failed', error)
            return 'poster'
        }
    }

    const startVideo = (reason = 'manual-rendering-off') => {
        clearVideoAttempt()
        stopLive()

        mode = 'video'
        liveReason = null
        frame.dataset.mediaMode = 'video-loading'
        delete frame.dataset.liveFallback
        delete frame.dataset.liveFallbackReason
        video.style.visibility = 'visible'
        poster.classList.remove('is-faded')

        const quality = resolveVideoQuality()
        activeVideoQuality = quality
        frame.dataset.quality = quality
        frame.dataset.highEndIOS = String(isHighEndIOS())
        video.dataset.quality = quality

        const nextSrc = MEDIA[quality]
        if (video.getAttribute('src') !== nextSrc) {
            video.src = nextSrc
        }

        const generation = playbackGeneration
        let firstFrameShown = false
        let playbackVerified = false
        let startTimeoutId = 0
        let advanceTimeoutId = 0
        let rejectedTimeoutId = 0

        const isCurrent = () => mode === 'video' && generation === playbackGeneration

        const clearTimers = () => {
            clearTimeout(startTimeoutId)
            clearTimeout(advanceTimeoutId)
            clearTimeout(rejectedTimeoutId)
        }

        const fallback = (fallbackReason) => {
            if (!isCurrent() || playbackVerified) return
            clearTimers()
            void startLive(`video-${fallbackReason}`)
        }

        const revealVideoFrame = () => {
            if (!isCurrent() || firstFrameShown) return
            firstFrameShown = true
            frame.dataset.mediaMode = 'video'
            poster.classList.add('is-faded')
        }

        const verifyAdvancingPlayback = () => {
            if (!isCurrent() || playbackVerified) return
            const initialTime = video.currentTime
            clearTimeout(advanceTimeoutId)
            advanceTimeoutId = window.setTimeout(() => {
                if (!isCurrent()) return
                const advanced = !video.paused && video.currentTime >= initialTime + 0.08
                if (!advanced) {
                    fallback('not-advancing')
                    return
                }
                playbackVerified = true
                clearTimeout(startTimeoutId)
            }, VIDEO_ADVANCE_CHECK_MS)
        }

        const onPlaying = () => {
            if (!isCurrent()) return
            clearTimeout(rejectedTimeoutId)
            const showAndVerify = () => {
                revealVideoFrame()
                verifyAdvancingPlayback()
            }
            if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback(showAndVerify)
            } else {
                requestAnimationFrame(showAndVerify)
            }
        }

        const attemptPlay = () => {
            if (!isCurrent() || playbackVerified) return
            video.muted = true
            video.defaultMuted = true
            const playback = video.play()
            playback?.catch?.(() => {
                if (!isCurrent() || playbackVerified) return
                clearTimeout(rejectedTimeoutId)
                rejectedTimeoutId = window.setTimeout(() => fallback('autoplay-rejected'), 1500)
            })
        }

        const onError = () => fallback('error')
        const onStalled = () => {
            if (!isCurrent() || playbackVerified) return
            window.setTimeout(() => {
                if (isCurrent() && !playbackVerified && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
                    fallback('stalled')
                }
            }, 1200)
        }

        video.addEventListener('playing', onPlaying)
        video.addEventListener('loadeddata', attemptPlay)
        video.addEventListener('canplay', attemptPlay)
        video.addEventListener('error', onError)
        video.addEventListener('stalled', onStalled)

        videoCleanup = () => {
            clearTimers()
            video.removeEventListener('playing', onPlaying)
            video.removeEventListener('loadeddata', attemptPlay)
            video.removeEventListener('canplay', attemptPlay)
            video.removeEventListener('error', onError)
            video.removeEventListener('stalled', onStalled)
        }
        activeAttemptPlay = attemptPlay

        startTimeoutId = window.setTimeout(() => {
            if (isCurrent() && !playbackVerified) fallback('start-timeout')
        }, VIDEO_START_TIMEOUT_MS)

        try { video.load() } catch {}
        attemptPlay()
        console.info(`[pistachio-swap] video mode: ${quality} (${reason})`)
        return quality
    }

    const setVideoQuality = (value) => {
        const normalized = String(value).trim().toLowerCase()
        if (normalized !== 'auto' && !QUALITY_ORDER.includes(normalized)) {
            console.warn('[pistachio-swap] video quality must be low, medium, high, ultra, or auto')
            return null
        }

        videoQualityMode = normalized
        const resolved = resolveVideoQuality()
        console.info(`[pistachio-swap] video quality: ${normalized} -> ${resolved}`)
        if (mode === 'video') startVideo('video-quality-change')
        return resolved
    }

    window.rendering = {
        on: () => startLive('manual-rendering-on'),
        off: () => startVideo('manual-rendering-off'),
        get: () => ({
            mode,
            liveReason,
            liveQuality: window.coinQuality?.get?.() ?? null,
            videoQuality: {
                mode: videoQualityMode === 'auto' ? 'auto' : 'manual',
                requested: videoQualityMode,
                resolved: resolveVideoQuality(),
                active: activeVideoQuality,
            },
        }),
    }

    window.videoQuality = {
        set: setVideoQuality,
        get: () => ({
            mode: videoQualityMode === 'auto' ? 'auto' : 'manual',
            requested: videoQualityMode,
            resolved: resolveVideoQuality(),
            active: activeVideoQuality,
            levels: [...QUALITY_ORDER, 'auto'],
        }),
        low: () => setVideoQuality('low'),
        medium: () => setVideoQuality('medium'),
        high: () => setVideoQuality('high'),
        ultra: () => setVideoQuality('ultra'),
        auto: () => setVideoQuality('auto'),
        levels: [...QUALITY_ORDER, 'auto'],
    }

    document.addEventListener('touchstart', () => activeAttemptPlay?.(), { passive: true })
    document.addEventListener('pointerdown', () => activeAttemptPlay?.(), { passive: true })
    window.addEventListener('pageshow', () => activeAttemptPlay?.())
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') activeAttemptPlay?.()
    })

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        mode = 'poster'
        frame.dataset.mediaMode = 'poster'
        return
    }

    startVideo('initial')
}

export function setupLandingCoin() {
    const hero = document.querySelector('main .hero')
    if (!hero || hero.classList.contains('hero-with-coin')) return

    installStyles()

    const copy = document.createElement('div')
    copy.className = 'hero-copy'
    while (hero.firstChild) copy.appendChild(hero.firstChild)

    const { frame, poster, video } = createCoinMedia()
    hero.classList.add('hero-with-coin')
    hero.append(copy, frame)
    createController(video, poster, frame)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLandingCoin, { once: true })
} else {
    setupLandingCoin()
}
