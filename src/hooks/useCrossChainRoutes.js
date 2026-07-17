import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import {
    authenticateCrossChainWallet,
    clearPersistedPublicRouteId,
    claimCrossChainRoute,
    CROSS_CHAIN_SORTS,
    fetchCrossChainRoutes,
    fetchCrossChainRouteStatus,
    getCrossChainExpiryWarning,
    isCrossChainRouteExpired,
    markCrossChainRouteSubmitted,
    persistPublicRouteId,
    prepareCrossChainRoute,
    readPersistedPublicRouteId,
    sortCrossChainRoutes,
} from '../services/crossChainRoutes.js'

const INITIAL_POLL_MS = 3_000
const MAX_POLL_MS = 30_000
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired', 'refunded'])

export function getCrossChainPollDelay(failedAttempts = 0) {
    return Math.min(
        INITIAL_POLL_MS * (2 ** Math.max(0, failedAttempts)),
        MAX_POLL_MS,
    )
}

export function useCrossChainRoutes({
    endpoint,
    account,
    contextKey,
    signMessage,
}) {
    const [routes, setRoutes] = useState([])
    const [sort, setSort] = useState(CROSS_CHAIN_SORTS.RETURN)
    const [selectedRoute, setSelectedRoute] = useState(null)
    const [recommendedRouteId, setRecommendedRouteId] = useState(null)
    const [preparedRoute, setPreparedRoute] = useState(null)
    const [routeStatus, setRouteStatus] = useState(null)
    const [phase, setPhase] = useState('idle')
    const [error, setError] = useState(null)
    const [statusUnavailable, setStatusUnavailable] = useState(false)
    const [hasClaimed, setHasClaimed] = useState(false)
    const [persistedRouteId, setPersistedRouteId] = useState(
        () => readPersistedPublicRouteId(),
    )
    const previousContextKey = useRef(contextKey)
    const sessionRef = useRef(null)

    const sortedRoutes = useMemo(
        () => sortCrossChainRoutes(routes, sort),
        [routes, sort],
    )

    const quote = useCallback(async (request) => {
        const controller = new AbortController()
        setPhase('quoting')
        setError(null)
        setPreparedRoute(null)
        setRouteStatus(null)
        try {
            const response = await fetchCrossChainRoutes({
                endpoint,
                request,
                signal: controller.signal,
            })
            setRoutes(response.routes)
            setRecommendedRouteId(response.selectedRoute?.publicRouteId ?? null)
            setSelectedRoute(null)
            setPhase('quoted')
            clearPersistedPublicRouteId()
            setPersistedRouteId(null)
            return response
        } catch (caught) {
            setRoutes([])
            setRecommendedRouteId(null)
            setPhase('error')
            setError(caught instanceof Error ? caught.message : 'Unable to load routes.')
            return []
        }
    }, [endpoint])

    const selectRoute = useCallback((route) => {
        setSelectedRoute(route)
        setPreparedRoute(null)
        setError(null)
        setPhase('review')
    }, [])

    const prepare = useCallback(async () => {
        if (!selectedRoute) return null
        if (isCrossChainRouteExpired(selectedRoute)) {
            setError('This route expired. Request a new route.')
            return null
        }
        setPhase('preparing')
        setError(null)
        try {
            const session = await authenticateCrossChainWallet({
                endpoint,
                walletAddress: account,
                sourceChainId: selectedRoute.sourceChainId,
                signMessage,
            })
            if (
                session.walletAddress?.toLowerCase() !== account?.toLowerCase() ||
                Number(session.chainId) !== Number(selectedRoute.sourceChainId)
            ) throw new Error('Wallet authentication does not match this route.')
            sessionRef.current = session
            const prepared = await prepareCrossChainRoute({
                endpoint,
                routeId: selectedRoute.publicRouteId,
                sessionToken: session.sessionToken,
            })
            setPreparedRoute(prepared)
            persistPublicRouteId(prepared.publicRouteId)
            setPersistedRouteId(prepared.publicRouteId)
            setPhase('prepared')
            return prepared
        } catch (caught) {
            setPhase('review')
            setError(caught instanceof Error ? caught.message : 'Unable to prepare route.')
            return null
        }
    }, [account, endpoint, selectedRoute, signMessage])

    const claimSource = useCallback(async () => {
        if (!preparedRoute || hasClaimed) return hasClaimed
        setPhase('claiming')
        setError(null)
        try {
            await claimCrossChainRoute({
                endpoint,
                routeId: preparedRoute.publicRouteId,
                sessionToken: sessionRef.current?.sessionToken,
            })
            setHasClaimed(true)
            setPhase('prepared')
            return true
        } catch (caught) {
            setPhase('prepared')
            setError(caught instanceof Error ? caught.message : 'Unable to claim source submission.')
            return false
        }
    }, [endpoint, hasClaimed, preparedRoute])

    const markSubmitted = useCallback(async (transactionHash) => {
        if (!preparedRoute) return false
        try {
            await markCrossChainRouteSubmitted({
                endpoint,
                routeId: preparedRoute.publicRouteId,
                sessionToken: sessionRef.current?.sessionToken,
                transactionHash,
            })
            persistPublicRouteId(preparedRoute.publicRouteId)
            setPersistedRouteId(preparedRoute.publicRouteId)
            return true
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Transaction sent, but status reporting failed.')
            return false
        }
    }, [endpoint, preparedRoute])

    const reset = useCallback(() => {
        setRoutes([])
        setSelectedRoute(null)
        setRecommendedRouteId(null)
        setPreparedRoute(null)
        setRouteStatus(null)
        setError(null)
        setStatusUnavailable(false)
        setHasClaimed(false)
        setPhase('idle')
        clearPersistedPublicRouteId()
        setPersistedRouteId(null)
        sessionRef.current = null
    }, [])

    useEffect(() => {
        if (previousContextKey.current === contextKey) return
        previousContextKey.current = contextKey
        reset()
    }, [contextKey, reset])

    useEffect(() => {
        const routeId = preparedRoute?.publicRouteId || persistedRouteId
        if (!routeId) return undefined

        let timeoutId = null
        let controller = null
        let failedAttempts = 0

        function schedule() {
            if (document.hidden) return
            timeoutId = window.setTimeout(poll, getCrossChainPollDelay(failedAttempts))
        }

        async function poll() {
            if (document.hidden) return
            const requestController = new AbortController()
            controller = requestController
            try {
                const nextStatus = await fetchCrossChainRouteStatus({
                    endpoint,
                    routeId,
                    signal: requestController.signal,
                })
                if (requestController.signal.aborted) return
                setRouteStatus(nextStatus)
                const isUnavailable = String(nextStatus.providerErrorCode ?? '')
                    .endsWith('_STATUS_UNAVAILABLE')
                setStatusUnavailable(isUnavailable)
                const next = String(nextStatus?.status ?? '').toLowerCase()
                if (TERMINAL_STATUSES.has(next)) return
                failedAttempts = isUnavailable ? failedAttempts + 1 : 0
            } catch {
                if (!requestController.signal.aborted) {
                    setStatusUnavailable(true)
                    failedAttempts += 1
                }
            }
            if (!requestController.signal.aborted) schedule()
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                window.clearTimeout(timeoutId)
                controller?.abort()
                return
            }
            poll()
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        if (!document.hidden) poll()
        return () => {
            controller?.abort()
            window.clearTimeout(timeoutId)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [endpoint, persistedRouteId, preparedRoute?.publicRouteId])

    return {
        routes: sortedRoutes,
        sort,
        setSort,
        selectedRoute,
        recommendedRouteId,
        preparedRoute,
        routeStatus,
        statusUnavailable,
        hasClaimed,
        phase,
        error,
        expiryWarning: getCrossChainExpiryWarning(selectedRoute),
        persistedRouteId,
        quote,
        selectRoute,
        prepare,
        claimSource,
        markSubmitted,
        reset,
    }
}
