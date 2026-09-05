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
.hero-coin-video {
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

.hero-coin-video {
    z-index: 2;
    opacity: 0;
    transition: opacity 260ms ease;
}

.hero-coin-video.is-ready {
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
    .hero-coin-video {
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

    frame.append(picture, video)
    return { frame, poster, video }
}

function startCoinMedia(video, poster, frame) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const quality = chooseQuality(frame)
    video.dataset.quality = quality
    video.src = MEDIA[quality]

    const reveal = () => {
        requestAnimationFrame(() => {
            video.classList.add('is-ready')
            poster.classList.add('is-faded')
        })
    }

    video.addEventListener('playing', reveal, { once: true })
    video.addEventListener('error', () => {
        video.classList.remove('is-ready')
        poster.classList.remove('is-faded')
    }, { once: true })

    video.load()
    const playback = video.play()
    if (playback?.catch) playback.catch(() => {})
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
