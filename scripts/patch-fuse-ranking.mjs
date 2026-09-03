import fs from 'node:fs'

const path = 'apps/api/src/modules/token-catalog.ts'
let source = fs.readFileSync(path, 'utf8')

const scoreBefore = `    }).map((result) => {
        const poolLike = isPoolVaultOrReceiptToken(result.item.token)
        return {
            token: result.item.token,
            index: result.item.index,
            category: poolLike ? 10 : 9,
            fuzzyScore: Number(result.score ?? 1),`
const scoreAfter = `    }).map((result) => {
        const poolLike = isPoolVaultOrReceiptToken(result.item.token)
        const symbolLengthDelta = Math.abs(
            String(result.item.displaySymbol).length - query.length,
        )
        return {
            token: result.item.token,
            index: result.item.index,
            category: poolLike ? 10 : 9,
            fuzzyScore: Number(result.score ?? 1) +
                symbolLengthDelta * 0.04 +
                (poolLike ? 0.12 : 0),`

if (!source.includes(scoreBefore)) {
    throw new Error('Fuse score patch target was not found')
}
source = source.replace(scoreBefore, scoreAfter)

const fallbackBefore = `    let ranked = deterministicRanked
    const exactAddressSearch = /^0x[a-f0-9]{40}$/.test(normalizedSearch)
    if (normalizedSearch && !exactAddressSearch) {
        const selectedIds = new Set(deterministicRanked.map((entry) =>
            createTokenId(entry.token.chainId, entry.token.address)))
        const fuzzyRanked = fuzzySearchRankedEntries(scopedEntries, normalizedSearch)
            .filter((entry) => {
                const identity = createTokenId(entry.token.chainId, entry.token.address)
                if (selectedIds.has(identity)) return false
                selectedIds.add(identity)
                return true
            })
        ranked = [...deterministicRanked, ...fuzzyRanked]
    }
    ranked.sort(compareRankedEntries)`
const fallbackAfter = `    let ranked = deterministicRanked
    const exactAddressSearch = /^0x[a-f0-9]{40}$/.test(normalizedSearch)
    if (
        normalizedSearch &&
        !exactAddressSearch &&
        deterministicRanked.length === 0
    ) {
        ranked = fuzzySearchRankedEntries(scopedEntries, normalizedSearch)
    }
    ranked.sort(compareRankedEntries)`

if (!source.includes(fallbackBefore)) {
    throw new Error('Fuse fallback patch target was not found')
}
source = source.replace(fallbackBefore, fallbackAfter)

fs.writeFileSync(path, source)
console.log('Deterministic-before-fuzzy ranking patch applied.')
