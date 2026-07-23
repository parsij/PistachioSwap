import { buildFallbackTokenCatalog, parseFallbackTokenBuildArgs } from '../src/token-discovery/fallback-token-build.js'

try {
    const options = parseFallbackTokenBuildArgs(process.argv.slice(2))
    const result = await buildFallbackTokenCatalog(options)
    console.log(`Fallback token build ${result.dryRun ? 'dry run' : 'complete'}.`)
    for (const chain of result.chains) {
        console.log(`${chain.chainId} ${chain.name}: ${chain.count} input address(es)`)
    }
    if (!result.dryRun) {
        console.log(`Generated ${result.records.length} fallback token record(s).`)
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
}
