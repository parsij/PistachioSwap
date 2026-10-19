import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const LEGAL_PAGES = {
    '/legal/terms/index.html': 'TERMS.md',
    '/legal/privacy/index.html': 'PRIVACY.md',
}

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character])
}

function inline(text) {
    return escapeHtml(text)
        .replace(/\[([^\]]+)\]\((\/[^\s)\"<>]+)\)/g, (match, label, href) =>
            href.startsWith('//') ? match : `<a href="${href}">${label}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
}

// A deliberately small renderer for the repository's controlled legal documents.
// Raw HTML is always escaped, and links can only use same-origin absolute paths.
export function renderLegalMarkdown(markdown) {
    return markdown.trim().split(/\n\s*\n/).map((block) => {
        const heading = /^(#{1,3}) (.+)$/.exec(block)
        if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`
        if (block === '---') return '<hr>'
        if (block.startsWith('> ')) return `<blockquote><p>${inline(block.replace(/^> ?/gm, '')).replace(/\n/g, '<br>')}</p></blockquote>`
        if (block.split('\n').every((line) => line.startsWith('- '))) {
            return `<ul>${block.split('\n').map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`
        }
        return `<p>${inline(block).replace(/ {2}\n/g, '<br>').replace(/\n/g, ' ')}</p>`
    }).join('\n')
}

export function legalPagesPlugin(root) {
    return {
        name: 'pistachio-legal-pages',
        transformIndexHtml: {
            order: 'pre',
            handler(html, context) {
                const source = LEGAL_PAGES[context.path]
                if (!source) return html
                const markdown = readFileSync(resolve(root, source), 'utf8')
                return html.replace('<!-- LEGAL_DOCUMENT -->', renderLegalMarkdown(markdown))
            },
        },
    }
}
