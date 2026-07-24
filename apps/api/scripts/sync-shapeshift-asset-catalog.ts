import {
    DEFAULT_SHAPESHIFT_ASSET_DATA_URL,
    DEFAULT_SHAPESHIFT_ASSET_PUBLIC_BASE_URL,
    DEFAULT_SHAPESHIFT_ASSET_REF,
    syncShapeShiftAssetCatalog,
} from '../src/token-discovery/shapeshift-asset-catalog.js'

const result = await syncShapeShiftAssetCatalog()
const importedTotal = Object.values(result.diagnostics.imported)
    .reduce((sum, count) => sum + count, 0)
const excludedTotal = Object.values(result.diagnostics.excluded)
    .reduce((sum, count) => sum + count, 0)

console.log('ShapeShift asset catalog synchronized.')
console.log(`Path: ${result.path}`)
console.log(`Ref: ${process.env.SHAPESHIFT_ASSET_REF?.trim() || DEFAULT_SHAPESHIFT_ASSET_REF}`)
console.log(`URL: ${process.env.SHAPESHIFT_ASSET_DATA_URL?.trim() || DEFAULT_SHAPESHIFT_ASSET_DATA_URL}`)
console.log(`Public base URL: ${process.env.SHAPESHIFT_ASSET_PUBLIC_BASE_URL?.trim() || DEFAULT_SHAPESHIFT_ASSET_PUBLIC_BASE_URL}`)
console.log(`Imported tokens: ${importedTotal}`)
console.log(`Excluded assets: ${excludedTotal}`)
console.log('Imported by chain:')
for (const [chainId, count] of Object.entries(result.diagnostics.imported)
    .sort((left, right) => Number(left[0]) - Number(right[0]))) {
    console.log(`  ${chainId}: ${count}`)
}
console.log('Exclusion reasons:')
for (const [reason, count] of Object.entries(result.diagnostics.excluded)
    .sort((left, right) => left[0].localeCompare(right[0]))) {
    console.log(`  ${reason}: ${count}`)
}
