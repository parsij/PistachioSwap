export const BOT_USER_AGENT_NAMES = [
    'Googlebot',
    'Google-Extended',
    'GoogleOther',
    'bingbot',
    'BingPreview',
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'ClaudeBot',
    'Claude-User',
    'anthropic-ai',
    'PerplexityBot',
    'CCBot',
    'Bytespider',
    'Applebot',
    'Amazonbot',
    'Slurp',
    'DuckDuckBot',
    'YandexBot',
    'Baiduspider',
    'facebookexternalhit',
    'meta-externalagent',
]

export const BOT_USER_AGENT_PATTERN = new RegExp(
    BOT_USER_AGENT_NAMES.join('|'),
    'i',
)

export function isBotUserAgent(userAgent) {
    return BOT_USER_AGENT_PATTERN.test(String(userAgent ?? ''))
}

export function isAppIndexPath(pathname = '/') {
    const path = String(pathname).split('?')[0]
    return path === '/' || path === '/index.html'
}

export function shouldServeLandingHtml({ userAgent, pathname = '/' } = {}) {
    if (!isBotUserAgent(userAgent)) return false
    return isAppIndexPath(pathname)
}
