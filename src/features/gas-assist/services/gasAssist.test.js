import { describe, expect, it } from 'vitest'

import { getGasAssistBaseUrl } from './gasAssist.js'

describe('Gas Assist API boundary', () => {
    it('derives the sponsorship API base from the quote endpoint', () => {
        expect(getGasAssistBaseUrl('https://api.example.com/v1/quote'))
            .toBe('https://api.example.com')
        expect(getGasAssistBaseUrl('/api/v1/quote')).toBe('/api')
    })

    it('fails closed for endpoints outside the PistachioSwap quote contract', () => {
        expect(() => getGasAssistBaseUrl('/v1/sponsorship/config')).toThrow(/requires/i)
        expect(() => getGasAssistBaseUrl('')).toThrow(/requires/i)
    })
})
