import { getApiConfig } from '../src/config.js'
import { normalizeAddress } from '../src/lib/address.js'
import { ProviderError } from '../src/lib/errors.js'
import {
    chunkAlchemyPortfolioNetworks,
    getAlchemyPortfolioChainIds,
    getAlchemyPortfolioNetwork,
    getChainIdForAlchemyPortfolioNetwork,
    type AlchemyPortfolioNetwork,
} from '../src/providers/alchemy/portfolio-networks.js'
import {
    ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY,
    clearAlchemyPortfolioSupportCacheForTest,
    fetchAlchemyPortfolioNetworkBatch,
    fetchAlchemyPortfolioTokens,
} from '../src/providers/alchemy/portfolio-tokens.js'

function argument(name: string) {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

async function boundedMap<T, R>(
    values: readonly T[],
    operation: (value: T, index: number) => Promise<R>,
) {
    const results = new Array<R>(values.length)
    let cursor = 0
    await Promise.all(Array.from(
        {
            length: Math.min(
                ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY,
                values.length,
            ),
        },
        async () => {
            while (cursor < values.length) {
                const index = cursor++
                results[index] = await operation(values[index], index)
            }
        },
    ))
    return results
}

function safeFailure(error: unknown) {
    return error instanceof ProviderError
        ? {
              httpStatus: error.upstreamStatus,
              safeCode: error.code,
          }
        : {
              httpStatus: null,
              safeCode: 'ALCHEMY_PORTFOLIO_UNAVAILABLE',
          }
}

async function main() {
    const walletAddress = normalizeAddress(argument('--address'))
    if (!walletAddress) {
        console.error('A valid --address is required.')
        process.exitCode = 1
        return
    }

    const config = getApiConfig()
    if (!config.alchemy.portfolio.enabled || !config.alchemy.apiKey) {
        console.error(
            'Alchemy Portfolio must be explicitly enabled and configured in apps/api/.env.',
        )
        process.exitCode = 1
        return
    }
    const providerConfig = {
        apiKey: config.alchemy.apiKey,
        timeoutMs: config.alchemy.portfolio.timeoutMs,
        maxPages: config.alchemy.portfolio.maxPages,
    }
    const chainIds = [...getAlchemyPortfolioChainIds()].sort(
        (left, right) => left - right,
    )
    const networks = chainIds.map(
        (chainId) => getAlchemyPortfolioNetwork(chainId)!,
    )
    const batches = chunkAlchemyPortfolioNetworks(networks)
    console.log(JSON.stringify({
        provider: 'alchemy-portfolio',
        operation: 'normal-batches',
        addressSuffix: walletAddress.slice(-4),
        maximumNetworksPerBatch: 5,
        concurrency: ALCHEMY_PORTFOLIO_BATCH_CONCURRENCY,
        batches: batches.map((batch, batchIndex) => ({
            batchIndex,
            chainIds: batch.map((network) =>
                getChainIdForAlchemyPortfolioNetwork(network)),
            networks: batch,
            networkCount: batch.length,
            validSize: batch.length <= 5,
        })),
    }, null, 2))

    const individual = await boundedMap(
        networks,
        async (network: AlchemyPortfolioNetwork) => {
            const chainId = getChainIdForAlchemyPortfolioNetwork(network)!
            try {
                const result = await fetchAlchemyPortfolioNetworkBatch({
                    walletAddress,
                    networks: [network],
                }, { config: providerConfig })
                return {
                    chainId,
                    network,
                    httpStatus: 200,
                    safeCode: result.failureCode,
                    tokenCount: result.tokens.length,
                    pageCount: result.pageCount,
                    outcome: 'supported' as const,
                }
            } catch (error) {
                const safe = safeFailure(error)
                return {
                    chainId,
                    network,
                    ...safe,
                    tokenCount: 0,
                    pageCount: 0,
                    outcome: safe.safeCode === 'ALCHEMY_PORTFOLIO_REQUEST_INVALID'
                        ? 'provider-rejected' as const
                        : 'temporary-failure' as const,
                }
            }
        },
    )
    for (const result of individual) {
        console.log(JSON.stringify({
            operation: 'single-network-test',
            ...result,
        }))
    }

    clearAlchemyPortfolioSupportCacheForTest()
    let completeUsable = false
    try {
        const result = await fetchAlchemyPortfolioTokens({
            walletAddress,
            chainIds,
        }, { config: providerConfig })
        completeUsable = result.successfulChainIds.length > 0
        console.log(JSON.stringify({
            operation: 'complete-portfolio-test',
            httpStatus: 200,
            safeCode: result.failureCode,
            tokenCount: result.tokens.length,
            pageCount: result.pageCount,
            queriedChainIds: result.queriedChainIds,
            successfulChainIds: result.successfulChainIds,
            failedChainIds: result.failedChainIds,
            providerRejectedChainIds: result.providerRejectedChainIds,
            partial: result.partial,
        }))
    } catch (error) {
        console.log(JSON.stringify({
            operation: 'complete-portfolio-test',
            ...safeFailure(error),
            tokenCount: 0,
            pageCount: 0,
            partial: true,
        }))
    }

    const supported = individual.filter((result) =>
        result.outcome === 'supported')
    const providerRejected = individual.filter((result) =>
        result.outcome === 'provider-rejected')
    const temporaryFailures = individual.filter((result) =>
        result.outcome === 'temporary-failure')
    console.log(JSON.stringify({
        operation: 'summary',
        supportedNetworks: supported.map(({ chainId, network }) => ({
            chainId,
            network,
        })),
        providerRejectedNetworks: providerRejected.map(({ chainId, network }) => ({
            chainId,
            network,
        })),
        temporaryFailures: temporaryFailures.map(({
            chainId,
            network,
            safeCode,
        }) => ({ chainId, network, safeCode })),
    }, null, 2))
    process.exitCode = supported.length > 0 || completeUsable ? 0 : 1
}

main().catch(() => {
    console.error('Alchemy Portfolio diagnostic failed safely.')
    process.exitCode = 1
})
