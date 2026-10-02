const STORAGE_KEY = 'pistachioswap:portfolio-value-history:v1'
const MAX_POINTS_PER_SERIES = 1800
const MIN_SAMPLE_INTERVAL_MS = 5 * 60 * 1000

export const PORTFOLIO_CHART_PERIODS = Object.freeze([
    { id: '1H', label: '1H', durationMs: 60 * 60 * 1000 },
    { id: '1D', label: '1D', durationMs: 24 * 60 * 60 * 1000 },
    { id: '1W', label: '1W', durationMs: 7 * 24 * 60 * 60 * 1000 },
    { id: '1M', label: '1M', durationMs: 30 * 24 * 60 * 60 * 1000 },
    { id: '1Y', label: '1Y', durationMs: 365 * 24 * 60 * 60 * 1000 },
    { id: 'ALL', label: 'All', durationMs: null },
])

function storage() {
    try {
        return globalThis.localStorage ?? null
    } catch {
        return null
    }
}

function normalizeAddress(value) {
    const address = String(value ?? '').trim().toLowerCase()
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null
}

function normalizeScope(value) {
    const scope = String(value ?? 'all').trim().toLowerCase()
    return scope || 'all'
}

function seriesKey(walletAddress, scope) {
    const address = normalizeAddress(walletAddress)
    return address ? address + ':' + normalizeScope(scope) : null
}

function readStore() {
    const target = storage()
    if (!target) return {}
    try {
        const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? '{}')
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {}
    } catch {
        return {}
    }
}

function writeStore(store) {
    const target = storage()
    if (!target) return false
    try {
        target.setItem(STORAGE_KEY, JSON.stringify(store))
        return true
    } catch {
        return false
    }
}

function normalizePoint(point) {
    const time = Number(point?.time)
    const value = Number(point?.value)
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(value) || value < 0) {
        return null
    }
    return { time, value }
}

export function recordPortfolioSnapshot({
    walletAddress,
    scope = 'all',
    valueUSD,
    now = Date.now(),
} = {}) {
    const key = seriesKey(walletAddress, scope)
    const value = Number(valueUSD)
    const timestamp = Number(now)
    if (!key || !Number.isFinite(value) || value < 0 || !Number.isFinite(timestamp)) {
        return false
    }

    const store = readStore()
    const points = Array.isArray(store[key])
        ? store[key].map(normalizePoint).filter(Boolean)
        : []
    const last = points.at(-1)

    if (last && timestamp - last.time < MIN_SAMPLE_INTERVAL_MS) {
        points[points.length - 1] = { time: timestamp, value }
    } else {
        points.push({ time: timestamp, value })
    }

    store[key] = points
        .sort((left, right) => left.time - right.time)
        .slice(-MAX_POINTS_PER_SERIES)
    return writeStore(store)
}

export function readPortfolioSnapshots({
    walletAddress,
    scope = 'all',
    period = '1M',
    now = Date.now(),
} = {}) {
    const key = seriesKey(walletAddress, scope)
    if (!key) return []

    const points = Array.isArray(readStore()[key])
        ? readStore()[key].map(normalizePoint).filter(Boolean)
        : []
    const configured = PORTFOLIO_CHART_PERIODS.find((item) => item.id === period)
    const durationMs = configured?.durationMs ?? null
    if (durationMs === null) return points

    const cutoff = Number(now) - durationMs
    return points.filter((point) => point.time >= cutoff)
}

export function portfolioSnapshotChange(points) {
    if (!Array.isArray(points) || points.length < 2) return null
    const first = Number(points[0]?.value)
    const last = Number(points.at(-1)?.value)
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null

    const absolute = last - first
    const percent = first > 0 ? (absolute / first) * 100 : null
    return {
        absolute,
        percent: Number.isFinite(percent) ? percent : null,
    }
}

export const portfolioHistoryInternals = {
    MAX_POINTS_PER_SERIES,
    MIN_SAMPLE_INTERVAL_MS,
    STORAGE_KEY,
    normalizeAddress,
    normalizePoint,
    seriesKey,
}
