import { auditFallbackTokenCatalog } from '../src/token-discovery/fallback-token-build.js'

const result = await auditFallbackTokenCatalog()
for (const chain of result.chains) {
    console.log(`${chain.chainId} ${chain.name}`)
    console.log(`  input addresses: ${chain.inputCount}`)
    console.log(`  generated tokens: ${chain.generatedCount}`)
    console.log(`  native: ${chain.native}`)
    console.log(`  wrapped native: ${chain.wrappedNative}`)
    console.log(`  symbols: ${chain.symbols.join(', ') || '(none)'}`)
    console.log(`  addresses: ${chain.addresses.join(', ') || '(none)'}`)
    console.log(`  local icons: ${chain.localIcons.map((icon) => `${icon.address}=${icon.status}`).join(', ') || '(none)'}`)
}
if (result.errors.length > 0) {
    console.error('Fallback token audit errors:')
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
} else {
    console.log('Fallback token audit passed.')
}
