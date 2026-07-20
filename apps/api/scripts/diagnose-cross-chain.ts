import { performance } from 'node:perf_hooks'

import { getApiConfig } from '../src/config.js'
import {
    CrossChainQuoteError,
    CrossChainRegistry,
} from '../src/cross-chain/registry.js'
import type { CrossChainProviderName } from '../src/cross-chain/types.js'
import {
    routeSupportsRequest,
    validateCrossChainRequest,
} from '../src/cross-chain/validation.js'

function argument(name: string) {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : undefined
}

const request = validateCrossChainRequest({
    mode: 'exactIn',
    sourceChainId: argument('source-chain'),
    destinationChainId: argument('destination-chain'),
    sourceToken: argument('sell-token'),
    destinationToken: argument('buy-token'),
    amount: argument('amount'),
    account: argument('owner'),
    recipient: argument('owner'),
    slippageBps: 50,
})
const registry = new CrossChainRegistry()
const config = getApiConfig().crossChain
const configuration = (provider: CrossChainProviderName) => ({
    across: {
        enabled: config.across.enabled,
        configured: Boolean(config.across.apiKey && config.across.integratorId),
    },
    'debridge-dln': {
        enabled: config.debridge.enabled,
        configured: true,
    },
    relay: {
        enabled: config.relay.enabled,
        configured: true,
    },
    chainflip: {
        enabled: config.chainflip.enabled,
        configured: Boolean(config.chainflip.brokerApiUrl),
    },
    '0x-cross-chain': {
        enabled: config.zeroX.enabled,
        configured: Boolean(config.zeroX.apiKey),
    },
})[provider]

const started = performance.now()
let routeSummaries: Array<Record<string, unknown>> = []
let quoteFailure: { code: string; message: string } | null = null
const reports = await Promise.all(registry.providerNames().map(async (provider) => {
    const providerStarted = performance.now()
    const state = configuration(provider)
    try {
        const capabilities = await registry.getCapabilities(provider)
        const pairRoutes = capabilities.routes.filter((route) =>
            route.sourceChainId === request.sourceAsset.chainId &&
            route.destinationChainId === request.destinationAsset.chainId,
        )
        return {
            provider,
            ...state,
            supportsSourceChain: capabilities.routes.some((route) =>
                route.sourceChainId === request.sourceAsset.chainId),
            supportsDestinationChain: capabilities.routes.some((route) =>
                route.destinationChainId === request.destinationAsset.chainId),
            supportsSellToken: pairRoutes.some((route) =>
                !route.sellTokens || route.sellTokens.includes(request.sourceAsset.address)),
            supportsBuyToken: pairRoutes.some((route) =>
                !route.buyTokens || route.buyTokens.includes(request.destinationAsset.address)),
            attempted: routeSupportsRequest(capabilities, request),
            outcome: capabilities.available ? 'available' : 'unavailable',
            safeCode: capabilities.available ? null : 'PROVIDER_UNAVAILABLE',
            upstreamStatus: null,
            durationMs: Math.round(performance.now() - providerStarted),
        }
    } catch {
        return {
            provider,
            ...state,
            supportsSourceChain: false,
            supportsDestinationChain: false,
            supportsSellToken: false,
            supportsBuyToken: false,
            attempted: false,
            outcome: 'unavailable',
            safeCode: 'CAPABILITY_DISCOVERY_FAILED',
            upstreamStatus: null,
            durationMs: Math.round(performance.now() - providerStarted),
        }
    }
}))

try {
    const result = await registry.quote(request)
    routeSummaries = result.quotes.map((route) => ({
        provider: route.provider,
        routeIdSuffix: route.quoteId.slice(-8),
        minimumBuyAmount: route.minimumBuyAmount,
        feeIncluded: route.feeIncluded,
        costBreakdownAvailable: route.costBreakdownAvailable,
        costs: route.costs,
    }))
    for (const report of reports) {
        if (result.quotes.some((quote) => quote.provider === report.provider)) {
            report.outcome = 'success'
            report.safeCode = null
        } else if (result.failures.some((failure) => failure.provider === report.provider)) {
            report.outcome = 'no-route'
            report.safeCode = 'PROVIDER_NO_ROUTE'
        }
    }
} catch (error) {
    if (error instanceof CrossChainQuoteError) {
        quoteFailure = { code: error.code, message: error.message }
        for (const failure of error.failures) {
            const report = reports.find((item) => item.provider === failure.provider)
            if (report) {
                report.outcome = 'no-route'
                report.safeCode = failure.code
            }
        }
    } else {
        quoteFailure = {
            code: 'QUOTE_DIAGNOSTIC_FAILED',
            message: error instanceof Error ? error.message : 'Quote diagnostic failed.',
        }
    }
}

process.stdout.write(`${JSON.stringify({
    request: {
        sourceChainId: request.sourceAsset.chainId,
        destinationChainId: request.destinationAsset.chainId,
        sellTokenSuffix: request.sourceAsset.address.slice(-6),
        buyTokenSuffix: request.destinationAsset.address.slice(-6),
        amountDigits: request.amount.length,
    },
    providers: reports,
    routes: routeSummaries,
    quoteFailure,
    durationMs: Math.round(performance.now() - started),
}, null, 2)}\n`)
