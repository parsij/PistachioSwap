const RELEASE_BASE = 'https://github.com/parsij/3d-gold-coin/releases/download/landing-media'
const MEDIA_REVISION = 'alpha-hq10-20260906-1715'
const STATIC_POSTER = `${RELEASE_BASE}/coin-poster.webp?v=${MEDIA_REVISION}`

const STATIC_COIN_STYLES = `
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
.hero-coin-static {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    pointer-events: none;
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
`

function installStaticCoinStyles() {
    if (document.getElementById('hero-coin-styles')) return
    const style = document.createElement('style')
    style.id = 'hero-coin-styles'
    style.textContent = STATIC_COIN_STYLES
    document.head.appendChild(style)
}

export function setupStaticLandingCoin() {
    const hero = document.querySelector('main .hero')
    if (!hero || hero.classList.contains('hero-with-coin')) return

    installStaticCoinStyles()

    const copy = document.createElement('div')
    copy.className = 'hero-copy'
    while (hero.firstChild) copy.appendChild(hero.firstChild)

    const frame = document.createElement('div')
    frame.className = 'hero-coin-frame'
    frame.dataset.mediaMode = 'crawler-static'
    frame.setAttribute('aria-hidden', 'true')

    const poster = document.createElement('img')
    poster.className = 'hero-coin-static'
    poster.src = STATIC_POSTER
    poster.alt = ''
    poster.width = 480
    poster.height = 480
    poster.loading = 'eager'
    poster.decoding = 'async'
    poster.fetchPriority = 'high'

    frame.appendChild(poster)
    hero.classList.add('hero-with-coin')
    hero.append(copy, frame)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupStaticLandingCoin, { once: true })
} else {
    setupStaticLandingCoin()
}
