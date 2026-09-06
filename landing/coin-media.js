const RELEASE_BASE = 'https://github.com/parsij/3d-gold-coin/releases/download/landing-media'

const MEDIA = {
    posterWebp: `${RELEASE_BASE}/coin-poster.webp`,
    posterJpg: `${RELEASE_BASE}/coin-poster.jpg`,
    gif: `${RELEASE_BASE}/coin-fallback.gif`,
    low: `${RELEASE_BASE}/coin-low.mp4`,
    medium: `${RELEASE_BASE}/coin-medium.mp4`,
    high: `${RELEASE_BASE}/coin-high.mp4`,
    ultra: `${RELEASE_BASE}/coin-ultra.mp4`,
}

const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra']
const GIF_LOAD_TIMEOUT_MS = 7000
const VIDEO_START_TIMEOUT_MS = 4500

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

.hero-with-coin .hero-copy {
    min-width: 0;
}

.hero-with-coin .eyebrow {
    margin-bottom: 24px;
}

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

.hero-with-coin .hero-actions {
    justify-content: flex-start;
}

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
.hero-coin-gif,
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
}

.hero-coin-poster {
    z-index: 1;
    opacity: 1;
    transition: opacity 260ms ease;
}

.hero-coin-gif,
.hero-coin-video,
.hero-coin-live {
    z-index: 2;
    opacity: 0;
    transition: opacity 260ms ease;
}

.hero-coin-gif.is-ready,
.hero-coin-video.is-ready,
.hero-coin-live.is-ready {
    opacity: 1;
}

.hero-coin-poster.is-faded {
    opacity: 0;
}

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

    .hero-with-coin .hero-lede {
        margin-inline: auto;
    }

    .hero-with-coin .hero-actions {
        justify-content: center;
    }

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
    .hero-coin-gif,
    .hero-coin-video,
    .hero-coin-live {
        display: none;
    }

    .hero-coin-poster {
        opacity: 1 !important;
    }
}
`

function qualityIndex(name) {
    return Math.max(0, QUALITY_ORDER.indexOf(name))
}

function displayQuality(frame) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const targetPixels = Math.max(frame.clientWidth, 320) * dpr

    if (targetPixels <= 520) return 'low'
    if (targetPixels <= 820) return 'medium'
    if (targetPixels <= 1050) return 'high'
    return 'ultra'
}

function connectionQuality() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection

    if (!connection) return 'high'
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

function chooseQuality(frame) {
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

    const gif = document.createElement('img')
    gif.className = 'hero-coin-gif'
    gif.alt = ''
    gif.width = 480
    gif.height = 480
    gif.loading = 'eager'
    gif.decoding = 'async'
    gif.fetchPriority = 'high'

    const video = document.createElement('video')
    video.className = 'hero-coin-video'
    video.muted = true
    video.defaultMuted = true
    video.autoplay = true
    video.loop = true
    video.playsInline = true
    video.preload = 'metadata'
    video.poster = MEDIA.posterJpg
    video.disablePictureInPicture = true
    video.setAttribute('tabindex', '-1')
    video.setAttribute('muted', '')
    video.setAttribute('autoplay', '')
    video.setAttribute('loop', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')

    frame.append(picture, gif, video)
    return { frame, poster, gif, video }
}

function stopGif(gif) {
    gif.removeAttribute('src')
    gif.remove()
}

function stopVideo(video) {
    try {
        video.pause()
    } catch {}
    video.removeAttribute('src')
    video.load()
    video.remove()
}

async function startLiveFallback(gif, video, poster, frame, reason) {
    if (frame.dataset.liveFallback === 'loading' || frame.dataset.liveFallback === 'ready') return
    frame.dataset.liveFallback = 'loading'
    frame.dataset.liveFallbackReason = reason

    gif?.classList.remove('is-ready')
    video?.classList.remove('is-ready')
    poster.classList.remove('is-faded')
    if (gif?.isConnected) stopGif(gif)
    if (video?.isConnected) stopVideo(video)

    try {
        const { mountLiveCoin } = await import(/* @vite-ignore */ './coin-live.js')
        await mountLiveCoin(frame, {
            onFirstFrame: (canvas) => {
                frame.dataset.liveFallback = 'ready'
                canvas.classList.add('is-ready')
                poster.classList.add('is-faded')
            },
        })
    } catch (error) {
        frame.dataset.liveFallback = 'failed'
        poster.classList.remove('is-faded')
        console.warn('[pistachio-swap] live coin fallback failed', error)
    }
}

function startVideoFallback(gif, video, poster, frame, gifReason) {
    if (frame.dataset.videoFallback === 'started') return
    frame.dataset.videoFallback = 'started'
    frame.dataset.gifFallbackReason = gifReason

    if (gif.isConnected) stopGif(gif)
    poster.classList.remove('is-faded')

    const quality = chooseQuality(frame)
    video.dataset.quality = quality
    video.src = MEDIA[quality]

    let revealed = false
    let liveStarted = false
    let timeoutId = 0

    const liveFallback = (reason) => {
        if (revealed || liveStarted) return
        liveStarted = true
        clearTimeout(timeoutId)
        void startLiveFallback(gif, video, poster, frame, reason)
    }

    const revealVideo = () => {
        if (liveStarted) return
        revealed = true
        clearTimeout(timeoutId)

        const show = () => {
            video.classList.add('is-ready')
            poster.classList.add('is-faded')
        }

        if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback(show)
        } else {
            requestAnimationFrame(show)
        }
    }

    video.addEventListener('playing', revealVideo, { once: true })
    video.addEventListener('error', () => liveFallback('video-error'), { once: true })
    video.addEventListener('stalled', () => {
        if (!revealed && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
            liveFallback('video-stalled')
        }
    }, { once: true })

    timeoutId = window.setTimeout(() => {
        if (!revealed || video.paused || video.currentTime <= 0) {
            liveFallback('video-start-timeout')
        }
    }, VIDEO_START_TIMEOUT_MS)

    video.load()
    const playback = video.play()
    if (playback?.catch) {
        playback.catch(() => liveFallback('autoplay-rejected'))
    }
}

function startCoinMedia(gif, video, poster, frame) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let gifResolved = false
    const gifTimeout = window.setTimeout(() => {
        if (gifResolved) return
        gifResolved = true
        startVideoFallback(gif, video, poster, frame, 'gif-load-timeout')
    }, GIF_LOAD_TIMEOUT_MS)

    gif.addEventListener('load', () => {
        if (gifResolved) return
        gifResolved = true
        clearTimeout(gifTimeout)
        frame.dataset.mediaMode = 'gif'
        requestAnimationFrame(() => {
            gif.classList.add('is-ready')
            poster.classList.add('is-faded')
        })
    }, { once: true })

    gif.addEventListener('error', () => {
        if (gifResolved) return
        gifResolved = true
        clearTimeout(gifTimeout)
        startVideoFallback(gif, video, poster, frame, 'gif-error')
    }, { once: true })

    gif.src = MEDIA.gif
}

export function setupLandingCoin() {
    const hero = document.querySelector('main .hero')
    if (!hero || hero.classList.contains('hero-with-coin')) return

    installStyles()

    const copy = document.createElement('div')
    copy.className = 'hero-copy'
    while (hero.firstChild) copy.appendChild(hero.firstChild)

    const { frame, poster, gif, video } = createCoinMedia()
    hero.classList.add('hero-with-coin')
    hero.append(copy, frame)

    startCoinMedia(gif, video, poster, frame)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLandingCoin, { once: true })
} else {
    setupLandingCoin()
}
