import {
    buildUniswapVolumeCatalog,
    loadPersistedUniswapVolumeCatalog,
    writeUniswapVolumeCatalogAtomic,
} from '../src/modules/uniswap-volume-tokens.js'

const previous = await loadPersistedUniswapVolumeCatalog()
const catalog = await buildUniswapVolumeCatalog()

if (catalog.tokens.length === 0) {
    if (previous && previous.tokens.length > 0) {
        console.log(JSON.stringify({
            status: 'kept-previous',
            reason: 'provider-refresh-empty',
            previousGeneratedAt: previous.generatedAt,
            previousTokenCount: previous.tokens.length,
            diagnostics: catalog.diagnostics,
        }, null, 2))
        process.exit(0)
    }
    console.error(JSON.stringify({
        status: 'failed',
        reason: 'empty-catalog',
        diagnostics: catalog.diagnostics,
    }, null, 2))
    process.exit(1)
}

const file = await writeUniswapVolumeCatalogAtomic(catalog)
console.log(JSON.stringify({
    status: 'written',
    file,
    generatedAt: catalog.generatedAt,
    tokenCount: catalog.tokens.length,
    configuredChainIds: catalog.configuredChainIds,
    successfulChainIds: catalog.successfulChainIds,
    failedChainIds: catalog.failedChainIds,
    partial: catalog.partial,
}, null, 2))
