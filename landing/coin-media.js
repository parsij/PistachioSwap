const RELEASE_BASE = 'https://github.com/parsij/3d-gold-coin/releases/download/landing-media'

const MEDIA = {
    poster: `${RELEASE_BASE}/coin-poster.webp`,
    low: `${RELEASE_BASE}/coin-low.mp4`,
}

const VIDEO_START_TIMEOUT_MS = 3500

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
    background: var(--bg);
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
    mix-blend-mode: lighten;
    -webkit-mask-image: radial-gradient(circle at center, #000 62%, rgb(0 0 0 / 92%) 76%, transparent 98%);
    mask-image: radial-gradient(circle at center, #000 62%, rgb(0 0 0 / 92%) 76%, transparent 98%);
}

.hero-coin-poster {
    z-index: 1;
    opacity: 1;
    transition: opacity 260ms ease;
}

.hero-coin-video,
.hero-coin-live {
    z-index: 2;
    opacity: 0;
    transition: opacity 260ms ease;
}

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
    .hero-coin-video,
    .hero-coin-live {
        display: none;
    }

    .hero-coin-poster {
        opacity: 1 !important;
    }
}
`

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

    const poster = document.createElement('img')
    poster.className = 'hero-coin-poster'
    poster.src = MEDIA.poster
    poster.alt = ''
    poster.width = 1080
    poster.height = 1080
    poster.loading = 'eager'
    poster.decoding = 'async'
    poster.fetchPriority = 'high'

    const video = document.createElement('video')
    video.className = 'hero-coin-video'
    video.muted = true
    video.defaultMuted = true
    video.autoplay = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.poster = MEDIA.poster
    video.disablePictureInPicture = true
    video.setAttribute('tabindex', '-1')
    video.setAttribute('muted', '')
    video.setAttribute('autoplay', '')
    video.setAttribute('loop', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')

    frame.append(poster, video)
    return { frame, poster, video }
}

function stopVideo(video) {
    try {
        video.pause()
    } catch {}
    video.removeAttribute('src')
    video.load()
    video.remove()
}

async function startLiveFallback(video, poster, frame, reason) {
    if (frame.dataset.liveFallback === 'loading' || frame.dataset.liveFallback === 'ready') return
    frame.dataset.liveFallback = 'loading'
    frame.dataset.liveFallbackReason = reason

    video?.classList.remove('is-ready')
    poster.classList.remove('is-faded')
    if (video?.isConnected) stopVideo(video)

    try {
        const { mountLiveCoin } = await import('./coin-live.js')
        await mountLiveCoin(frame, {
            onFirstFrame: (canvas) => {
                frame.dataset.liveFallback = 'ready'
                frame.dataset.mediaMode = 'live'
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

function startVideo(video, poster, frame) {
    video.dataset.quality = 'low'
    video.src = MEDIA.low

    let revealed = false
    let liveStarted = false
    let timeoutId = 0

    const liveFallback = (reason) => {
        if (revealed || liveStarted) return
        liveStarted = true
        clearTimeout(timeoutId)
        void startLiveFallback(video, poster, frame, reason)
    }

    const revealVideo = () => {
        if (liveStarted) return
        revealed = true
        clearTimeout(timeoutId)

        const show = () => {
            frame.dataset.mediaMode = 'video'
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

function startCoinMedia(video, poster, frame) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    startVideo(video, poster, frame)
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

    startCoinMedia(video, poster, frame)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLandingCoin, { once: true })
} else {
    setupLandingCoin()
}
