import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Uniswap-derived token hover card behavior', () => {
    it('keeps the uploaded source interaction contract', () => {
        const source = readFileSync(
            resolve('src/features/tokens/components/TokenHoverCard.jsx'),
            'utf8',
        )

        expect(source).toContain('const OPEN_DELAY_MS = 300')
        expect(source).toContain("'(hover: hover) and (pointer: fine)'")
        expect(source).toContain('fetchTokenMarketDetails(token')
        expect(source).toContain('side="right"')
        expect(source).toContain('align="start"')
        expect(source).toContain('sideOffset={8}')
        expect(source).toContain('height={104}')
    })
})
