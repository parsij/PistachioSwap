import {
    buildUniswapVolumeCatalog,
    loadPersistedUniswapVolumeCatalog,
} from '../src/modules/uniswap-volume-tokens.js'

const persisted = await loadPersistedUniswapVolumeCatalog()

if (!process.env.THE_GRAPH_API_KEY?.trim()) {
    console.log(JSON.stringify({
        status: persisted ? 'persisted-only' : 'missing-api-key',
        missing: ['THE_GRAPH_API_KEY'],
        persisted: persisted
            ? {
                  generatedAt: persisted.generatedAt,
                  tokenCount: persisted.tokens.length,
                  configuredChainIds: persisted.configuredChainIds,
                  successfulChainIds: persisted.successfulChainIds,
                  failedChainIds: persisted.failedChainIds,
              }
            : null,
    }, null, 2))
    process.exit(0)
}

const catalog = await buildUniswapVolumeCatalog()
console.log(JSON.stringify({
    status: catalog.tokens.length > 0 ? 'ok' : 'empty',
    generatedAt: catalog.generatedAt,
    tokenCount: catalog.tokens.length,
    configuredChainIds: catalog.configuredChainIds,
    successfulChainIds: catalog.successfulChainIds,
    failedChainIds: catalog.failedChainIds,
    partial: catalog.partial,
    diagnostics: catalog.diagnostics,
}, null, 2))
