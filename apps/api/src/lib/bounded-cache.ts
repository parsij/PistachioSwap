export function setBoundedCacheEntry<K, V>(
    cache: Map<K, V>,
    key: K,
    value: V,
    maximumEntries = 5_000,
) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
        throw new Error('Cache capacity must be a positive integer.')
    }
    cache.delete(key)
    while (cache.size >= maximumEntries) {
        cache.delete(cache.keys().next().value!)
    }
    cache.set(key, value)
}
