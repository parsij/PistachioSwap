import { auditShapeShiftAssetCatalog } from '../src/token-discovery/shapeshift-asset-catalog.js'

const catalog = await auditShapeShiftAssetCatalog()

console.log('ShapeShift asset catalog audit passed.')
console.log(`Generated at: ${catalog.generatedAt}`)
console.log(`Source ref: ${catalog.source.ref}`)
console.log(`Token count: ${catalog.ids.length}`)
console.log('Tokens by chain:')
for (const [chainId, info] of Object.entries(catalog.chains)
    .sort((left, right) => Number(left[0]) - Number(right[0]))) {
    console.log(`  ${chainId}: ${info.count}`)
}
