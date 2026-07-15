import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
    createAppMetadata,
    selectBrandingPath,
} from './appKitMetadata.js'

describe('AppKit configuration', () => {
    it('prefers PistachioLogo.svg and uses an absolute same-origin URL', () => {
        expect(
            createAppMetadata({
                origin: 'http://localhost:5173',
                availableAssets: [
                    '/favicon.svg',
                    '/PistachioLogo.svg',
                ],
            }),
        ).toMatchObject({
            url: 'http://localhost:5173',
            icons: [
                'http://localhost:5173/PistachioLogo.svg',
            ],
        })
    })

    it('uses favicon.svg only when the main logo is absent', () => {
        expect(
            selectBrandingPath(['/favicon.svg']),
        ).toBe('/favicon.svg')
    })

    it('initializes AppKit once outside React rendering', () => {
        const appKitPath = fileURLToPath(
            new URL('./appKit.js', import.meta.url),
        )
        const source = readFileSync(appKitPath, 'utf8')

        expect(source.match(/createAppKit\(/g)).toHaveLength(1)
        expect(source).toContain('globalThis[APPKIT_CONTEXT_KEY]')
        expect(source).not.toContain('useEffect')
        expect(source).not.toMatch(/function App(?:KitProvider)?\s*\(/)
    })
})
