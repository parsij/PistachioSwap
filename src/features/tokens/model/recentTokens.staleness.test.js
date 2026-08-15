// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
    getRecentStorageKey,
    readRecentTokens,
    sanitizeStoredToken,
    writeRecentTokens,
} from './tokenSelectorState.js'

const ADDRESS = '0xfec3cf1a1c9288813585984cd6a457f22fcd2cee'

function currentRecord(overrides = {}) {
    return {
        classificationVersion: 6,
        chainId: 56,
        address: ADDRESS,
        name: 'Some Token',
        symbol: 'SOME',
        decimals: 18,
        recognitionStatus: 'established',
        recognitionReasons: ['established-market-asset'],
        spamStatus: 'clean',
        possibleSpam: false,
        verifiedContract: true,
        securityStatus: 'low',
        visibility: 'primary',
        classificationTier: 'established',
        classificationReasons: ['established-market-asset'],
        priceConfidence: 'unknown',
        ...overrides,
    }
}

afterEach(() => window.localStorage.clear())

describe('recent-token staleness', () => {
    it('keeps a record saved under the current classification', () => {
        writeRecentTokens(56, [sanitizeStoredToken(currentRecord())])
        expect(readRecentTokens(56)).toHaveLength(1)
    })

    it('drops a record whose classification is no longer current', () => {
        // The saved snapshot decides whether the risk prompt appears again, so
        // a token flagged after it was saved must not stay silently trusted.
        const stale = sanitizeStoredToken(currentRecord())
        writeRecentTokens(56, [{ ...stale, classificationVersion: 5 }])
        expect(readRecentTokens(56)).toEqual([])
    })

    it('drops a record missing its classification fields entirely', () => {
        writeRecentTokens(56, [{
            savedAt: Date.now(),
            chainId: 56,
            address: ADDRESS,
            symbol: 'SOME',
            visibility: 'primary',
        }])
        expect(readRecentTokens(56)).toEqual([])
    })

    it('ages out a record older than the retention window', () => {
        const saved = sanitizeStoredToken(currentRecord())
        const ancient = Date.now() - (31 * 24 * 60 * 60 * 1000)
        writeRecentTokens(56, [{ ...saved, savedAt: ancient }])
        expect(readRecentTokens(56)).toEqual([])
    })

    it('rotates the storage key with the classification version', () => {
        expect(getRecentStorageKey(56)).toBe(
            'pistachioswap:recent-token-searches:v6:56',
        )
        expect(getRecentStorageKey('all')).toBe(
            'pistachioswap:recent-token-searches:v6:all',
        )
    })

    it('ignores records left behind under a superseded key', () => {
        window.localStorage.setItem(
            'pistachioswap:recent-token-searches:v4:56',
            JSON.stringify([currentRecord()]),
        )
        expect(readRecentTokens(56)).toEqual([])
    })
})
