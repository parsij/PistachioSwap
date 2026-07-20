import {
    isAddress,
} from 'viem'

import {
    getCanonicalTokenAddress,
    isCuratedEvmChainId,
} from '../../../web3/curatedEvmChains.js'

export const CROSS_CHAIN_SORTS = Object.freeze({
    RETURN: 'return',
    FASTEST: 'fastest',
    FEES: 'fees',
})

export const PUBLIC_ROUTE_QUERY_KEY = 'route'
export const PUBLIC_ROUTE_STORAGE_KEY = 'pistachioswap:cross-chain-route:v1'

function readFirst(source, paths, fallback = null) {
    for (const path of paths) {
        const value = path.split('.').reduce(
            (current, key) => current?.[key],
            source,
        )
        if (value !== undefined && value !== null) return value
    }
    return fallback
}

function toInteger(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0
        ? Math.round(number)
        : fallback
}

function toAmount(value) {
    const normalized = String(value ?? '0')
    return /^\d+$/.test(normalized) ? normalized : '0'
}

export function compareIntegerStrings(left, right) {
    const a = toAmount(left).replace(/^0+(?=\d)/, '')
    const b = toAmount(right).replace(/^0+(?=\d)/, '')
    return a.length - b.length || a.localeCompare(b)
}

export function normalizeDecimal(value) {
    if (value === null || value === undefined) return null
    const match = String(value).trim().match(/^(\d+)(?:\.(\d+))?$/)
    if (!match) return null
    const whole = match[1].replace(/^0+(?=\d)/, '')
    const fraction = (match[2] ?? '').replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}

export function addDecimalStrings(values) {
    const normalized = values.map(normalizeDecimal).filter((value) => value !== null)
    if (!normalized.length) return null
    const scale = Math.max(...normalized.map((value) => value.split('.')[1]?.length ?? 0))
    const total = normalized.reduce((sum, value) => {
        const [whole, fraction = ''] = value.split('.')
        return sum + BigInt(`${whole}${fraction.padEnd(scale, '0')}`)
    }, 0n)
    return formatScaledDecimal(total, scale)
}

export function subtractDecimalStrings(totalValue, reductionValue) {
    const total = normalizeDecimal(totalValue)
    if (total === null) return null
    const reduction = normalizeDecimal(reductionValue)
    if (reduction === null) return total
    const scale = Math.max(
        total.split('.')[1]?.length ?? 0,
        reduction.split('.')[1]?.length ?? 0,
    )
    const toScaled = (value) => {
        const [whole, fraction = ''] = value.split('.')
        return BigInt(`${whole}${fraction.padEnd(scale, '0')}`)
    }
    const result = toScaled(total) - toScaled(reduction)
    return formatScaledDecimal(result > 0n ? result : 0n, scale)
}

function formatScaledDecimal(value, scale) {
    if (scale === 0) return value.toString()
    const padded = value.toString().padStart(scale + 1, '0')
    const whole = padded.slice(0, -scale)
    const fraction = padded.slice(-scale).replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole
}

export function normalizeCrossChainCosts(value, confidence = 'quote') {
    const source = value && typeof value === 'object' ? value : {}
    return Object.freeze({
        sourceGasUsd: normalizeDecimal(source.sourceGasUsd),
        sourceGasNative: normalizeDecimal(source.sourceGasNative),
        destinationGasUsd: normalizeDecimal(source.destinationGasUsd),
        providerFeeUsd: normalizeDecimal(source.providerFeeUsd),
        appFeeUsd: normalizeDecimal(source.appFeeUsd),
        swapImpactUsd: normalizeDecimal(source.swapImpactUsd),
        sponsoredUsd: normalizeDecimal(source.sponsoredUsd),
        routeCostUsd: normalizeDecimal(source.routeCostUsd),
        totalEstimatedUsd: normalizeDecimal(source.totalEstimatedUsd),
        currency: 'USD',
        confidence: ['prepared', 'confirmed'].includes(source.confidence)
            ? source.confidence
            : confidence,
    })
}

export function withPreparedSourceGasCosts(costs, {
    sourceGasNative,
    sourceGasUsd,
}) {
    const normalized = normalizeCrossChainCosts(costs)
    const routeCostUsd = normalized.routeCostUsd ?? subtractDecimalStrings(
        addDecimalStrings([
            normalized.destinationGasUsd,
            normalized.providerFeeUsd,
            normalized.appFeeUsd,
            normalized.swapImpactUsd,
        ]),
        normalized.sponsoredUsd,
    )
    return Object.freeze({
        ...normalized,
        sourceGasNative: normalizeDecimal(sourceGasNative),
        sourceGasUsd: normalizeDecimal(sourceGasUsd),
        routeCostUsd,
        totalEstimatedUsd: sourceGasUsd === null || sourceGasUsd === undefined
            ? null
            : addDecimalStrings([sourceGasUsd, routeCostUsd]),
        confidence: 'prepared',
    })
}

export function compareDecimalStrings(left, right) {
    const a = normalizeDecimal(left)
    const b = normalizeDecimal(right)
    if (a === null || b === null) {
        if (a === b) return 0
        return a === null ? 1 : -1
    }
    const [aWhole, aFraction = ''] = a.split('.')
    const [bWhole, bFraction = ''] = b.split('.')
    const wholeComparison = compareIntegerStrings(aWhole, bWhole)
    if (wholeComparison) return wholeComparison
    const width = Math.max(aFraction.length, bFraction.length)
    return aFraction.padEnd(width, '0').localeCompare(bFraction.padEnd(width, '0'))
}

export function formatRouteFee(value) {
    const fee = normalizeDecimal(value)
    return fee === null ? null : `$${fee}`
}

export function formatTokenAmount(rawAmount, decimals, maximumDecimals = 6) {
    const raw = toAmount(rawAmount)
    const precision = Number(decimals)
    if (!Number.isInteger(precision) || precision < 0 || precision > 255) return null
    if (raw === '0') return '0'

    const padded = raw.padStart(precision + 1, '0')
    const whole = precision === 0 ? padded : padded.slice(0, -precision)
    const fraction = precision === 0 ? '' : padded.slice(-precision)
    const visible = fraction.slice(0, maximumDecimals).replace(/0+$/, '')
    if (whole === '0' && !visible && /[1-9]/.test(fraction)) {
        return `<${`0.${'0'.repeat(Math.max(0, maximumDecimals - 1))}1`}`
    }
    return visible ? `${whole}.${visible}` : whole
}

export function getProviderDisplayName(provider) {
    const names = {
        relay: 'Relay',
        across: 'Across',
        'debridge-dln': 'deBridge DLN',
        chainflip: 'Chainflip',
        'zero-x': '0x',
    }
    const value = String(provider ?? '').trim()
    return names[value.toLowerCase()] ?? (value || 'Provider')
}

function normalizeProvider(value) {
    if (typeof value === 'string') return value
    return String(value?.name ?? value?.id ?? 'Unknown')
}

function normalizeStep(step, index) {
    const chainId = Number(readFirst(step, ['chainId', 'chain.id', 'fromChainId']))
    return {
        id: String(step?.id ?? `step-${index + 1}`),
        index: Number.isInteger(Number(step?.index)) ? Number(step.index) : index,
        type: String(step?.type ?? step?.kind ?? 'transaction').toLowerCase(),
        label: String(step?.label ?? step?.title ?? `Step ${index + 1}`),
        chainId: Number.isInteger(chainId) ? chainId : null,
        status: String(step?.status ?? 'pending').toLowerCase(),
        transaction: step?.transaction ?? step?.tx ?? null,
    }
}

export function normalizeCrossChainRoute(route) {
    const id = String(readFirst(route, ['publicRouteId', 'routeId', 'id'], '')).trim()
    if (!id) throw new Error('Route response is missing a public route ID.')

    const sourceChainId = Number(readFirst(route, [
        'sourceChainId',
        'fromChainId',
        'source.chainId',
        'from.chainId',
    ]))
    const destinationChainId = Number(readFirst(route, [
        'destinationChainId',
        'toChainId',
        'destination.chainId',
        'to.chainId',
    ]))
    if (
        !isCuratedEvmChainId(sourceChainId) ||
        !isCuratedEvmChainId(destinationChainId)
    ) throw new Error('Route contains an unsupported chain.')

    return Object.freeze({
        id,
        publicRouteId: id,
        provider: normalizeProvider(readFirst(route, ['provider', 'providerName'], 'Unknown')),
        state: String(readFirst(route, ['state', 'status'], '')).toLowerCase(),
        executionModel: String(route?.executionModel ?? 'unknown'),
        sourceChainId,
        destinationChainId,
        sourceAsset: route?.sourceAsset ?? null,
        destinationAsset: route?.destinationAsset ?? null,
        recipient: route?.recipient ?? null,
        inputAmount: toAmount(readFirst(route, [
            'inputAmount',
            'amountIn',
            'from.amount',
        ])),
        outputAmount: toAmount(readFirst(route, [
            'outputAmount',
            'amountOut',
            'to.amount',
            'estimate.amountOut',
        ])),
        minimumOutputAmount: toAmount(readFirst(route, [
            'minimumOutputAmount',
            'minimumBuyAmount',
        ])),
        feeAmountUsd: normalizeDecimal(readFirst(route, [
            'feeAmountUsd',
            'fees.totalUsd',
            'estimate.feeUsd',
        ], null)),
        feeIncluded: readFirst(route, ['feeIncluded', 'fees.includedInOutput'], null) === true,
        costs: normalizeCrossChainCosts(route?.costs),
        costBreakdownAvailable: route?.costBreakdownAvailable === true ||
            hasAvailableCrossChainCosts(route?.costs),
        durationSeconds: toInteger(readFirst(route, [
            'durationSeconds',
            'estimatedDurationSeconds',
            'estimate.durationSeconds',
        ])),
        expiresAt: readFirst(route, ['expiresAt', 'expiry'], null),
        warnings: Object.freeze(
            (Array.isArray(route?.warnings) ? route.warnings : [])
                .map(String),
        ),
        steps: Object.freeze(
            (Array.isArray(route?.steps) ? route.steps : [])
                .map(normalizeStep)
                .sort((left, right) => left.index - right.index),
        ),
    })
}

export function normalizeCrossChainRoutes(payload) {
    const candidates = Array.isArray(payload)
        ? payload
        : readFirst(payload, ['routes', 'data.routes', 'quotes'], [])
    if (!Array.isArray(candidates)) throw new Error('Invalid cross-chain route response.')
    return candidates.map(normalizeCrossChainRoute)
}

export function normalizeCrossChainRouteResponse(payload) {
    const routes = normalizeCrossChainRoutes(payload)
    const selectedValue = payload?.selectedRoute
    const selectedRoute = selectedValue
        ? normalizeCrossChainRoute(selectedValue)
        : null
    return {
        selectedRoute,
        routes,
        failures: Array.isArray(payload?.failures) ? payload.failures : [],
    }
}

export function sortCrossChainRoutes(routes, sort = CROSS_CHAIN_SORTS.RETURN) {
    return [...routes].sort((left, right) => {
        if (sort === CROSS_CHAIN_SORTS.FASTEST) {
            return left.durationSeconds - right.durationSeconds ||
                compareIntegerStrings(right.outputAmount, left.outputAmount)
        }
        if (sort === CROSS_CHAIN_SORTS.FEES) {
            return compareDecimalStrings(
                left.costs?.totalEstimatedUsd ?? left.costs?.routeCostUsd ?? left.feeAmountUsd,
                right.costs?.totalEstimatedUsd ?? right.costs?.routeCostUsd ?? right.feeAmountUsd,
            ) ||
                compareIntegerStrings(right.outputAmount, left.outputAmount)
        }
        return compareIntegerStrings(right.outputAmount, left.outputAmount) ||
            compareDecimalStrings(
                left.costs?.totalEstimatedUsd ?? left.costs?.routeCostUsd ?? left.feeAmountUsd,
                right.costs?.totalEstimatedUsd ?? right.costs?.routeCostUsd ?? right.feeAmountUsd,
            ) ||
            left.durationSeconds - right.durationSeconds ||
            String(left.provider).localeCompare(String(right.provider))
    })
}

export function isCrossChainRouteExpired(route, now = Date.now()) {
    if (!route?.expiresAt) return false
    const expiry = Date.parse(route.expiresAt)
    return Number.isFinite(expiry) && expiry <= now
}

export function isExecutableCrossChainRouteForRequest(route, request, now = Date.now()) {
    if (!route || !request || isCrossChainRouteExpired(route, now)) return false
    const source = route.sourceAsset
    const destination = route.destinationAsset
    if (!source || !destination) return false
    return route.state === 'quote-ready' &&
        ['evm-transaction', 'deposit-channel', 'vault-swap'].includes(route.executionModel) &&
        Number(source.chainId) === Number(request.sourceAsset.chainId) &&
        Number(destination.chainId) === Number(request.destinationAsset.chainId) &&
        getCanonicalTokenAddress(source.chainId, source.address) ===
            getCanonicalTokenAddress(request.sourceAsset.chainId, request.sourceAsset.address) &&
        getCanonicalTokenAddress(destination.chainId, destination.address) ===
            getCanonicalTokenAddress(
                request.destinationAsset.chainId,
                request.destinationAsset.address,
            ) &&
        route.inputAmount === String(request.amount) &&
        String(route.recipient).toLowerCase() === String(request.recipient).toLowerCase() &&
        /^\d+$/.test(route.minimumOutputAmount) &&
        BigInt(route.minimumOutputAmount) > 0n
}

export function getCrossChainExpiryWarning(route, now = Date.now()) {
    if (!route?.expiresAt) return null
    const remaining = Date.parse(route.expiresAt) - now
    if (!Number.isFinite(remaining)) return null
    if (remaining <= 0) return 'This route expired. Request a new route.'
    if (remaining <= 30_000) return 'This route expires in less than 30 seconds.'
    return null
}

/**
 * Creates the normalized exact-input cross-chain backend request.
 * @param {object} input Source/destination chains/assets, amount, account/recipient, slippage, decimals, and symbols.
 * @returns {object} Validated public request body.
 * @throws For unsupported chains, invalid addresses, amount, or slippage.
 * @security Preserves exact account, chain, and token identities.
 */
export function createCrossChainRouteRequest({
    sourceChainId,
    destinationChainId,
    sourceToken,
    destinationToken,
    amount,
    account,
    recipient = account,
    slippageBps = 50,
    sourceSymbol = null,
    destinationSymbol = null,
    sourceDecimals = null,
    destinationDecimals = null,
}) {
    if (
        !isCuratedEvmChainId(sourceChainId) ||
        !isCuratedEvmChainId(destinationChainId) ||
        Number(sourceChainId) === Number(destinationChainId)
    ) throw new Error('Choose two different supported chains.')
    if (!isAddress(account ?? '') || !isAddress(recipient ?? '')) {
        throw new Error('A valid wallet and recipient are required.')
    }
    const canonicalSourceToken = getCanonicalTokenAddress(sourceChainId, sourceToken)
    const canonicalDestinationToken = getCanonicalTokenAddress(
        destinationChainId,
        destinationToken,
    )
    if (!isAddress(canonicalSourceToken ?? '') || !isAddress(canonicalDestinationToken ?? '')) {
        throw new Error('Valid source and destination token addresses are required.')
    }
    if (!/^\d+$/.test(String(amount)) || BigInt(amount) <= 0n) {
        throw new Error('Enter a valid amount.')
    }
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
        throw new Error('Slippage must be between 0 and 10000 basis points.')
    }
    return {
        mode: 'exactIn',
        sourceAsset: {
            chainId: Number(sourceChainId),
            address: canonicalSourceToken,
            symbol: sourceSymbol,
            decimals: sourceDecimals,
        },
        destinationAsset: {
            chainId: Number(destinationChainId),
            address: canonicalDestinationToken,
            symbol: destinationSymbol,
            decimals: destinationDecimals,
        },
        amount: String(amount),
        ownerAddress: account,
        recipient,
        slippageBps,
        walletCapabilities: {
            evmTransaction: true,
            depositChannel: true,
            vaultSwap: false,
        },
    }
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options)
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const code = payload?.error?.code ?? null
        const messages = {
            CROSS_CHAIN_NOT_CONFIGURED: 'Cross-chain routing is not configured.',
            CROSS_CHAIN_UNSUPPORTED_CHAIN_PAIR: 'This network pair is not currently supported.',
            CROSS_CHAIN_UNSUPPORTED_TOKEN_PAIR: 'This token pair is not currently supported across these networks.',
            CROSS_CHAIN_AMOUNT_TOO_LOW: 'Enter a larger amount.',
            CROSS_CHAIN_NO_LIQUIDITY: 'No cross-chain liquidity is currently available for this token pair.',
            CROSS_CHAIN_PROVIDER_UNAVAILABLE: 'Cross-chain routes are temporarily unavailable.',
            RELAY_AUTHORITY_UNAVAILABLE: 'Relay authority metadata is temporarily unavailable.',
            RELAY_APPROVAL_TARGET_INVALID: 'Relay returned an unauthorized approval target.',
            RELAY_APPROVAL_AMOUNT_INVALID: 'Relay returned an invalid approval amount.',
            RELAY_ROUTE_MALFORMED: 'Relay returned a malformed route.',
            CROSS_CHAIN_NO_EXECUTABLE_ROUTE: 'No executable route is currently available.',
        }
        const error = new Error(messages[code] ?? payload?.error?.message ??
            payload?.message ?? 'Cross-chain service is unavailable.')
        error.code = code
        error.status = response.status
        throw error
    }
    return payload
}

/**
 * Fetches and normalizes cross-chain routes from the configured backend.
 * @param {{endpoint: string, request: object, signal?: AbortSignal}} input Request configuration.
 * @returns {Promise<object>} Normalized route response.
 * @throws Backend/network/JSON/normalization errors with current safe code/status fields.
 * @sideEffects Performs one abortable browser HTTP request; no wallet/provider fan-out.
 */
export async function fetchCrossChainRoutes({ endpoint, request, signal }) {
    const payload = await requestJson(`${endpoint.replace(/\/+$/, '')}/routes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
    })
    const response = normalizeCrossChainRouteResponse(payload)
    const expectedDestination = getCanonicalTokenAddress(
        request.destinationAsset.chainId,
        request.destinationAsset.address,
    )
    for (const route of response.routes) {
        const destination = route.destinationAsset
        if (!destination ||
            Number(destination.chainId) !== Number(request.destinationAsset.chainId) ||
            getCanonicalTokenAddress(destination.chainId, destination.address) !== expectedDestination ||
            String(route.recipient).toLowerCase() !== String(request.recipient).toLowerCase() ||
            BigInt(route.minimumOutputAmount) <= 0n) {
            throw new Error('A route did not deliver the exact selected destination asset.')
        }
        if (!isExecutableCrossChainRouteForRequest(route, request)) {
            throw new Error('A route is not executable for the current swap request.')
        }
    }
    if (
        response.selectedRoute &&
        !isExecutableCrossChainRouteForRequest(response.selectedRoute, request)
    ) throw new Error('The selected route is not executable for the current swap request.')
    return response
}

export function normalizePreparedCrossChainRoute(payload) {
    const prepared = payload?.preparedRoute ?? payload?.route ?? payload
    const provider = normalizeProvider(prepared?.provider ?? payload?.provider)
    const deposit = provider.toLowerCase().includes('chainflip')
        ? (() => {
              const value = prepared?.deposit
              if (!value) return null
              return {
                  address: value.address,
                  asset: value.asset,
                  minimumAmount: toAmount(value.minimumAmount),
                  expiresAt: value.expiresAt,
              }
          })()
        : null
    return {
        publicRouteId: String(readFirst(prepared, ['publicRouteId', 'routeId', 'id'], '')),
        provider,
        executionModel: String(prepared?.executionModel ?? 'unknown'),
        sourceAsset: prepared?.sourceAsset ?? null,
        destinationAsset: prepared?.destinationAsset ?? null,
        inputAmount: toAmount(prepared?.inputAmount),
        outputAmount: toAmount(prepared?.outputAmount),
        minimumOutputAmount: toAmount(prepared?.minimumOutputAmount),
        feeAmountUsd: normalizeDecimal(prepared?.feeAmountUsd),
        feeIncluded: prepared?.feeIncluded === true,
        costs: normalizeCrossChainCosts(prepared?.costs),
        costBreakdownAvailable: prepared?.costBreakdownAvailable === true ||
            hasAvailableCrossChainCosts(prepared?.costs),
        expiresAt: readFirst(prepared, ['expiresAt', 'expiry'], null),
        steps: (Array.isArray(prepared?.steps) ? prepared.steps : [])
            .map(normalizeStep)
            .sort((left, right) => left.index - right.index),
        deposit,
        raw: payload,
    }
}

function hasAvailableCrossChainCosts(value) {
    if (!value || typeof value !== 'object') return false
    return [
        value.sourceGasUsd,
        value.destinationGasUsd,
        value.providerFeeUsd,
        value.appFeeUsd,
        value.swapImpactUsd,
        value.sponsoredUsd,
        value.routeCostUsd,
        value.totalEstimatedUsd,
    ].some((item) => normalizeDecimal(item) !== null)
}

function crossChainAuthorization(sessionToken) {
    if (!sessionToken) throw new Error('Cross-chain wallet authentication is required.')
    return {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
    }
}

export async function authenticateCrossChainWallet({
    endpoint,
    walletAddress,
    sourceChainId,
    signMessage,
    signal,
}) {
    if (typeof signMessage !== 'function') {
        throw new Error('This wallet cannot sign the cross-chain authentication message.')
    }
    const base = endpoint.replace(/\/+$/, '')
    const challenge = await requestJson(`${base}/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            walletAddress,
            chainId: Number(sourceChainId),
        }),
        signal,
    })
    const signature = await signMessage(challenge.message)
    return requestJson(`${base}/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            challengeId: challenge.challengeId,
            signature,
        }),
        signal,
    })
}

export async function claimCrossChainRoute({
    endpoint,
    routeId,
    sessionToken,
    signal,
}) {
    return requestJson(
        `${endpoint.replace(/\/+$/, '')}/routes/${encodeURIComponent(routeId)}/claim`,
        {
            method: 'POST',
            headers: crossChainAuthorization(sessionToken),
            body: JSON.stringify({}),
            signal,
        },
    )
}

export async function markCrossChainRouteSubmitted({
    endpoint,
    routeId,
    sessionToken,
    transactionHash,
    signal,
}) {
    return requestJson(
        `${endpoint.replace(/\/+$/, '')}/routes/${encodeURIComponent(routeId)}/submitted`,
        {
            method: 'POST',
            headers: crossChainAuthorization(sessionToken),
            body: JSON.stringify({
                sourceTransactionHash: transactionHash,
            }),
            signal,
        },
    )
}

export async function prepareCrossChainRoute({
    endpoint,
    routeId,
    sessionToken,
    signal,
}) {
    const payload = await requestJson(
        `${endpoint.replace(/\/+$/, '')}/routes/${encodeURIComponent(routeId)}/prepare`,
        {
            method: 'POST',
            headers: crossChainAuthorization(sessionToken),
            body: JSON.stringify({}),
            signal,
        },
    )
    return normalizePreparedCrossChainRoute(payload)
}

export async function fetchCrossChainRouteStatus({ endpoint, routeId, signal }) {
    const payload = await requestJson(
        `${endpoint.replace(/\/+$/, '')}/routes/${encodeURIComponent(routeId)}`,
        { signal },
    )
    return normalizeCrossChainRouteStatus(payload)
}

export function normalizeCrossChainRouteStatus(payload) {
    const status = payload?.routeStatus ?? payload?.data ?? payload
    return {
        publicRouteId: String(readFirst(status, ['publicRouteId', 'routeId', 'id'], '')),
        status: String(readFirst(status, ['status', 'state'], 'unknown')).toLowerCase(),
        updatedAt: readFirst(status, ['updatedAt', 'lastUpdatedAt'], null),
        providerErrorCode: status?.providerErrorCode ?? null,
        steps: (Array.isArray(status?.steps) ? status.steps : []).map(normalizeStep),
    }
}

export function getOrderedEvmSteps(preparedRoute) {
    return (preparedRoute?.steps ?? [])
        .filter((step) => step.transaction && isCuratedEvmChainId(step.chainId))
        .sort((left, right) => left.index - right.index)
}

export function readPersistedPublicRouteId({
    location = window.location,
    storage = window.localStorage,
} = {}) {
    const fromUrl = new URLSearchParams(location.search).get(PUBLIC_ROUTE_QUERY_KEY)
    return fromUrl || storage.getItem(PUBLIC_ROUTE_STORAGE_KEY) || null
}

export function persistPublicRouteId(routeId, {
    history = window.history,
    location = window.location,
    storage = window.localStorage,
} = {}) {
    const normalized = String(routeId ?? '').trim()
    if (!normalized) return
    storage.setItem(PUBLIC_ROUTE_STORAGE_KEY, normalized)
    const url = new URL(location.href)
    url.searchParams.set(PUBLIC_ROUTE_QUERY_KEY, normalized)
    history.replaceState(history.state, '', url)
}

export function clearPersistedPublicRouteId({
    history = window.history,
    location = window.location,
    storage = window.localStorage,
} = {}) {
    storage.removeItem(PUBLIC_ROUTE_STORAGE_KEY)
    const url = new URL(location.href)
    url.searchParams.delete(PUBLIC_ROUTE_QUERY_KEY)
    history.replaceState(history.state, '', url)
}
