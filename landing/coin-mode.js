const CRAWLER_USER_AGENT = /(?:Googlebot|Google-InspectionTool|bingbot|DuckDuckBot|Baiduspider|Yandex(?:Bot|Images)|Slurp|Sogou|Applebot|facebookexternalhit|Twitterbot|LinkedInBot|Discordbot|Slackbot|WhatsApp|TelegramBot|Pinterestbot|PetalBot|AhrefsBot|SemrushBot|GPTBot|ChatGPT-User|ClaudeBot|Claude-User|PerplexityBot|CCBot|Bytespider)/i

export function isCrawlerUserAgent(userAgent) {
    return CRAWLER_USER_AGENT.test(String(userAgent || ''))
}
