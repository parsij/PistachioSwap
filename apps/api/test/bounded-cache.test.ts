import { describe, expect, it } from 'vitest'

import { setBoundedCacheEntry } from '../src/lib/bounded-cache.js'

describe('bounded cache insertion', () => {
    it('evicts the oldest entry and refreshes replacement recency', () => {
        const cache = new Map<string, number>()
        setBoundedCacheEntry(cache, 'a', 1, 2)
        setBoundedCacheEntry(cache, 'b', 2, 2)
        setBoundedCacheEntry(cache, 'a', 3, 2)
        setBoundedCacheEntry(cache, 'c', 4, 2)

        expect([...cache.entries()]).toEqual([['a', 3], ['c', 4]])
    })
})
