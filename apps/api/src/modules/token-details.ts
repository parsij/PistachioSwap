import type { FastifyPluginAsync } from 'fastify'

import { normalizeAddress } from '../lib/address.js'
import { getSafeError } from '../lib/errors.js'
import { isRecord } from '../lib/http.js'
import { coinGeckoRequest } from '../providers/coingecko/coingecko-client.js'
import { getCoinGeckoToken } from '../providers/coingecko/token-data.js'
import { getTokenDiscoveryChain } from '../token-discovery/registry.js'

type TokenDetailsQuery = {
    chainId?: string
    address?: string
}

type TokenMarketQuery = TokenDetailsQuery & {
    period?: string
    includeYearStats?: string
}

type MarketPeriod = '1H' | '1D' | '1W' | '1M' | '1Y' | 'ALL'

const MARKET_PERIOD_DAYS: Readonly<Record<MarketPeriod, string>> = Object.freeze({
    '1H': '1',
    '1D': '1',
    '1W': '7',
    '1M': '30',
    '1Y': '365',
    ALL: 'max',
})

function createCoinGeckoUrl(coinGeckoId: string) {
    return (
        'https://www.coingecko.com/en/coins/' +
        encodeURIComponent(coinGeckoId)
    )
}

function finiteNumber(value: unknown) {
    const result = Number(value)
    return Number.isFinite(result) ? result : null
}

function recordValue(value: unknown, key: string) {
    return isRecord(value) ? value[key] : undefined
}

function usdValue(value: unknown) {
    return finiteNumber(recordValue(value, 'usd'))
}

function parsePriceSeries(value: unknown, period: MarketPeriod) {
    if (!isRecord(value) || !Array.isArray(value.prices)) return []
    const volumes = Array.isArray(value.total_volumes)
        ? value.total_volumes
        : []
    const points = value.prices.flatMap((entry, index) => {
        if (!Array.isArray(entry) || entry.length < 2) return []
        const timestamp = finiteNumber(entry[0])
        const priceUsd = finiteNumber(entry[1])
        if (timestamp === null || priceUsd === null || timestamp <= 0 || priceUsd < 0) {
            return []
        }
        const volumeEntry = volumes[index]
        const volumeUsd = Array.isArray(volumeEntry) && volumeEntry.length >= 2
            ? finiteNumber(volumeEntry[1])
            : null
        return [{
            timestamp: Math.trunc(timestamp),
            priceUsd,
            volumeUsd: volumeUsd !== null && volumeUsd >= 0 ? volumeUsd : null,
        }]
    })

    if (period !== '1H' || points.length === 0) return points
    const latest = points[points.length - 1].timestamp
    const cutoff = latest - 60 * 60 * 1000
    return points.filter((point) => point.timestamp >= cutoff)
}

function priceChange(points: Array<{ priceUsd: number }>) {
    if (points.length < 2) {
        return { absoluteUsd: null, percent: null }
    }
    const first = points[0].priceUsd
    const last = points[points.length - 1].priceUsd
    const absoluteUsd = last - first
    return {
        absoluteUsd,
        percent: first !== 0 ? (absoluteUsd / first) * 100 : null,
    }
}

function priceRange(points: Array<{ priceUsd: number }>) {
    if (points.length === 0) {
        return { high: null, low: null }
    }
    let high = points[0].priceUsd
    let low = points[0].priceUsd
    for (const point of points.slice(1)) {
        high = Math.max(high, point.priceUsd)
        low = Math.min(low, point.priceUsd)
    }
    return { high, low }
}

function parseBooleanQuery(value: string | undefined) {
    if (value === undefined) return false
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    return null
}

function normalizedPeriod(value: string | undefined): MarketPeriod | null {
    const period = String(value ?? '1D').trim().toUpperCase()
    return period in MARKET_PERIOD_DAYS ? period as MarketPeriod : null
}

function resolveTokenIdentity(chainIdValue: string | undefined, addressValue: string | undefined) {
    const chainId = Number(chainIdValue)
    const address = normalizeAddress(addressValue)
    if (!Number.isInteger(chainId) || chainId <= 0) {
        return { error: 'INVALID_CHAIN_ID' as const, chainId: null, address: null, chain: null }
    }
    if (!address) {
        return { error: 'INVALID_TOKEN_ADDRESS' as const, chainId, address: null, chain: null }
    }
    const chain = getTokenDiscoveryChain(chainId)
    if (!chain?.active) {
        return { error: 'UNSUPPORTED_COINGECKO_NETWORK' as const, chainId, address, chain }
    }
    return { error: null, chainId, address, chain }
}

export function createTokenDetailsRoutes(
    lookupToken = getCoinGeckoToken,
    requestCoinGecko = coinGeckoRequest,
): FastifyPluginAsync {
    return async (app) => {
        app.get<{ Querystring: TokenDetailsQuery }>(
            '/v1/token-details/coingecko',
            async (request, reply) => {
                if (
                    Object.keys(request.query).some(
                        (key) => !['chainId', 'address'].includes(key),
                    )
                ) {
                    return reply.code(400).send({
                        error: {
                            code: 'UNSUPPORTED_QUERY_PARAMETER',
                            message: 'Unsupported query parameter.',
                        },
                    })
                }

                const identity = resolveTokenIdentity(
                    request.query.chainId,
                    request.query.address,
                )
                if (identity.error === 'INVALID_CHAIN_ID') {
                    return reply.code(400).send({
                        error: {
                            code: identity.error,
                            message: 'A valid chain ID is required.',
                        },
                    })
                }
                if (identity.error === 'INVALID_TOKEN_ADDRESS') {
                    return reply.code(400).send({
                        error: {
                            code: identity.error,
                            message: 'A valid token contract address is required.',
                        },
                    })
                }
                if (identity.error || !identity.chain || !identity.address || !identity.chainId) {
                    return reply.code(400).send({
                        error: {
                            code: 'UNSUPPORTED_COINGECKO_NETWORK',
                            message:
                                `CoinGecko network configuration is missing for chain ${identity.chainId}.`,
                        },
                    })
                }

                try {
                    const token = await lookupToken(
                        identity.address,
                        undefined,
                        identity.chainId,
                    )

                    if (!token?.coinGeckoId) {
                        return reply.code(404).send({
                            error: {
                                code: 'COINGECKO_TOKEN_NOT_FOUND',
                                message:
                                    'This token does not have a CoinGecko listing.',
                            },
                        })
                    }

                    reply.header('cache-control', 'public, max-age=86400')
                    return {
                        chainId: identity.chainId,
                        address: identity.address,
                        coinGeckoId: token.coinGeckoId,
                        url: createCoinGeckoUrl(token.coinGeckoId),
                        cached: false,
                    }
                } catch (error) {
                    const safe = getSafeError(error)
                    return reply.code(safe.statusCode).send(safe.body)
                }
            },
        )

        app.get<{ Querystring: TokenMarketQuery }>(
            '/v1/token-details/market',
            async (request, reply) => {
                if (
                    Object.keys(request.query).some(
                        (key) => ![
                            'chainId',
                            'address',
                            'period',
                            'includeYearStats',
                        ].includes(key),
                    )
                ) {
                    return reply.code(400).send({
                        error: {
                            code: 'UNSUPPORTED_QUERY_PARAMETER',
                            message: 'Unsupported query parameter.',
                        },
                    })
                }

                const identity = resolveTokenIdentity(
                    request.query.chainId,
                    request.query.address,
                )
                if (identity.error === 'INVALID_CHAIN_ID') {
                    return reply.code(400).send({
                        error: {
                            code: identity.error,
                            message: 'A valid chain ID is required.',
                        },
                    })
                }
                if (identity.error === 'INVALID_TOKEN_ADDRESS') {
                    return reply.code(400).send({
                        error: {
                            code: identity.error,
                            message: 'A valid token contract address is required.',
                        },
                    })
                }
                if (identity.error || !identity.chain || !identity.address || !identity.chainId) {
                    return reply.code(400).send({
                        error: {
                            code: 'UNSUPPORTED_COINGECKO_NETWORK',
                            message:
                                `CoinGecko network configuration is missing for chain ${identity.chainId}.`,
                        },
                    })
                }

                const period = normalizedPeriod(request.query.period)
                if (!period) {
                    return reply.code(400).send({
                        error: {
                            code: 'INVALID_MARKET_PERIOD',
                            message: 'Unsupported token market period.',
                        },
                    })
                }

                const includeYearStats = parseBooleanQuery(request.query.includeYearStats)
                if (includeYearStats === null) {
                    return reply.code(400).send({
                        error: {
                            code: 'INVALID_YEAR_STATS_FLAG',
                            message: 'includeYearStats must be true or false.',
                        },
                    })
                }

                const controller = new AbortController()
                const abort = () => controller.abort()
                request.raw.once('aborted', abort)

                try {
                    const isNative = identity.address === identity.chain.native.address
                    const token = isNative
                        ? null
                        : await lookupToken(
                            identity.address,
                            controller.signal,
                            identity.chainId,
                        )
                    const coinGeckoId = isNative
                        ? identity.chain.native.coinGeckoId
                        : token?.coinGeckoId

                    if (!coinGeckoId) {
                        return reply.code(404).send({
                            error: {
                                code: 'COINGECKO_TOKEN_NOT_FOUND',
                                message: 'Market data is unavailable for this token.',
                            },
                        })
                    }

                    const encodedId = encodeURIComponent(coinGeckoId)
                    const detailsPath =
                        `/coins/${encodedId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
                    const chartPath =
                        `/coins/${encodedId}/market_chart?vs_currency=usd&days=${MARKET_PERIOD_DAYS[period]}`
                    const yearNeeded = includeYearStats && !['1Y', 'ALL'].includes(period)
                    const requests = await Promise.allSettled([
                        requestCoinGecko(detailsPath, { signal: controller.signal }),
                        requestCoinGecko(chartPath, { signal: controller.signal }),
                        yearNeeded
                            ? requestCoinGecko(
                                `/coins/${encodedId}/market_chart?vs_currency=usd&days=365`,
                                { signal: controller.signal },
                            )
                            : Promise.resolve(null),
                    ])

                    const details = requests[0].status === 'fulfilled'
                        ? requests[0].value
                        : null
                    const chartPayload = requests[1].status === 'fulfilled'
                        ? requests[1].value
                        : null
                    if (details === null && chartPayload === null) {
                        throw requests[0].status === 'rejected'
                            ? requests[0].reason
                            : requests[1].status === 'rejected'
                                ? requests[1].reason
                                : new Error('Token market data is unavailable.')
                    }

                    const points = parsePriceSeries(chartPayload, period)
                    const yearPoints = yearNeeded
                        ? requests[2].status === 'fulfilled'
                            ? parsePriceSeries(requests[2].value, '1Y')
                            : []
                        : ['1Y', 'ALL'].includes(period)
                            ? points
                            : []
                    const range = priceRange(yearPoints)
                    const change = priceChange(points)

                    const detailsRecord = isRecord(details) ? details : {}
                    const marketData = isRecord(detailsRecord.market_data)
                        ? detailsRecord.market_data
                        : {}
                    const currentPriceUsd =
                        points.at(-1)?.priceUsd ??
                        usdValue(marketData.current_price)
                    const image = isRecord(detailsRecord.image)
                        ? detailsRecord.image
                        : {}

                    reply.header('cache-control', 'public, max-age=60')
                    return {
                        schemaVersion: 1,
                        chainId: identity.chainId,
                        address: identity.address,
                        coinGeckoId,
                        name: typeof detailsRecord.name === 'string'
                            ? detailsRecord.name
                            : token?.name ?? identity.chain.native.name,
                        symbol: typeof detailsRecord.symbol === 'string'
                            ? detailsRecord.symbol.toUpperCase()
                            : token?.symbol ?? identity.chain.native.symbol,
                        imageUrl:
                            typeof image.large === 'string'
                                ? image.large
                                : typeof image.small === 'string'
                                    ? image.small
                                    : token?.imageUrl ?? null,
                        currentPriceUsd,
                        change24hPercent: period === '1D'
                            ? change.percent
                            : finiteNumber(marketData.price_change_percentage_24h),
                        change24hUsd: period === '1D'
                            ? change.absoluteUsd
                            : null,
                        chart: {
                            period,
                            points,
                        },
                        stats: {
                            tvlUsd: usdValue(marketData.total_value_locked),
                            marketCapUsd: usdValue(marketData.market_cap),
                            fdvUsd: usdValue(marketData.fully_diluted_valuation),
                            volume24hUsd: usdValue(marketData.total_volume),
                            high52wUsd: range.high,
                            low52wUsd: range.low,
                        },
                        partial: requests.some((result) => result.status === 'rejected'),
                    }
                } catch (error) {
                    const safe = getSafeError(error)
                    return reply.code(safe.statusCode).send(safe.body)
                } finally {
                    request.raw.off('aborted', abort)
                }
            },
        )
    }
}

export const tokenDetailsRoutes = createTokenDetailsRoutes()
