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

/**
 * Owns debounced cross-chain quote, prepare, authenticate, claim, submission, and status polling requests.
 * @param {object} config Endpoint/account/request/context identity, signer, debounce, enable flag, and diagnostics.
 * @returns {object} Route list/selection state and quote/prepare/claim/submission operations.
 * @sideEffects Performs abortable backend HTTP, timers, public-route storage, and supplied authentication signing.
 * @security Context keys and normalized request identity reject stale route responses.
 */
export function useCrossChainRoutes({
    endpoint,
    account,
    contextKey,
    signMessage,
    request = null,
    enabled = false,
    debounceMs = 350,
    onExecutionPhase = null,
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
    const accountRef = useRef(account)
    const sessionRef = useRef(null)
    const preparedRouteRef = useRef(null)
    const selectedRouteRef = useRef(null)
    const quoteControllerRef = useRef(null)
    const quoteSequenceRef = useRef(0)
    const prepareSequenceRef = useRef(0)
    const lastQuotedKeyRef = useRef(null)
    const executionPhaseRef = useRef(onExecutionPhase)

    useEffect(() => {
        executionPhaseRef.current = onExecutionPhase
    }, [onExecutionPhase])

    useEffect(() => {
        accountRef.current = account
    }, [account])

    const sortedRoutes = useMemo(
        () => sortCrossChainRoutes(routes, sort),
        [routes, sort],
    )

    const quote = useCallback(async (request) => {
        quoteControllerRef.current?.abort()
        const controller = new AbortController()
        quoteControllerRef.current = controller
        const sequence = quoteSequenceRef.current + 1
        quoteSequenceRef.current = sequence
        prepareSequenceRef.current += 1
        setPhase('quoting')
        setError(null)
        preparedRouteRef.current = null
        setPreparedRoute(null)
        setRouteStatus(null)
        try {
            const response = await fetchCrossChainRoutes({
                endpoint,
                request,
                signal: controller.signal,
            })
            if (controller.signal.aborted || sequence !== quoteSequenceRef.current) {
                return null
            }
            setRoutes(response.routes)
            setRecommendedRouteId(response.selectedRoute?.publicRouteId ?? null)
            const initialRoute = sortCrossChainRoutes(
                response.routes,
                CROSS_CHAIN_SORTS.RETURN,
            )[0] ?? null
            selectedRouteRef.current = initialRoute
            setSelectedRoute(initialRoute)
            setPhase(initialRoute ? 'review' : 'quoted')
            clearPersistedPublicRouteId()
            setPersistedRouteId(null)
            return response
        } catch (caught) {
            if (controller.signal.aborted || sequence !== quoteSequenceRef.current) {
                return null
            }
            const retainedRoute = selectedRouteRef.current
            const canRetain = retainedRoute && !isCrossChainRouteExpired(retainedRoute)
            if (!canRetain) {
                setRoutes([])
                setRecommendedRouteId(null)
                selectedRouteRef.current = null
                setSelectedRoute(null)
            }
            setPhase(canRetain ? 'review' : 'error')
            setError(caught instanceof Error ? caught.message : 'Unable to load routes.')
            return []
        } finally {
            if (quoteControllerRef.current === controller) {
                quoteControllerRef.current = null
            }
        }
    }, [endpoint])

    useEffect(() => {
        if (!enabled || !request || !contextKey) {
            lastQuotedKeyRef.current = null
            return undefined
        }
        if (lastQuotedKeyRef.current === contextKey) return undefined

        const timeoutId = window.setTimeout(() => {
            lastQuotedKeyRef.current = contextKey
            quote(request)
        }, debounceMs)
        return () => window.clearTimeout(timeoutId)
    }, [contextKey, debounceMs, enabled, quote, request])

    const selectRoute = useCallback((route) => {
        prepareSequenceRef.current += 1
        selectedRouteRef.current = route
        setSelectedRoute(route)
        preparedRouteRef.current = null
        setPreparedRoute(null)
        setError(null)
        setPhase('review')
    }, [])

    const prepare = useCallback(async () => {
        if (!selectedRoute) return null
        const routeToPrepare = selectedRoute
        const accountAtStart = account
        const sequence = prepareSequenceRef.current + 1
        prepareSequenceRef.current = sequence
        const preparationIsCurrent = () => (
            sequence === prepareSequenceRef.current &&
            selectedRouteRef.current?.publicRouteId === routeToPrepare.publicRouteId &&
            accountRef.current?.toLowerCase() === accountAtStart?.toLowerCase()
        )
        if (
            preparedRouteRef.current?.publicRouteId === selectedRoute.publicRouteId &&
            !isCrossChainRouteExpired(selectedRoute)
        ) return preparedRouteRef.current
        if (isCrossChainRouteExpired(selectedRoute)) {
            setError('This route expired. Request a new route.')
            return null
        }
        setPhase('preparing')
        setError(null)
        let executionPhase = 'authenticate'
        try {
            executionPhaseRef.current?.('authenticate', {
                sourceChainId: selectedRoute.sourceChainId,
                destinationChainId: selectedRoute.destinationChainId,
                routeId: selectedRoute.publicRouteId,
            })
            const session = await authenticateCrossChainWallet({
                endpoint,
                walletAddress: account,
                sourceChainId: selectedRoute.sourceChainId,
                signMessage,
            })
            if (!preparationIsCurrent()) return null
            if (
                session.walletAddress?.toLowerCase() !== account?.toLowerCase() ||
                Number(session.chainId) !== Number(selectedRoute.sourceChainId)
            ) throw new Error('Wallet authentication does not match this route.')
            sessionRef.current = session
            executionPhase = 'prepare-route'
            executionPhaseRef.current?.('prepare-route', {
                sourceChainId: selectedRoute.sourceChainId,
                destinationChainId: selectedRoute.destinationChainId,
                routeId: selectedRoute.publicRouteId,
            })
            const prepared = await prepareCrossChainRoute({
                endpoint,
                routeId: selectedRoute.publicRouteId,
                sessionToken: session.sessionToken,
            })
            if (!preparationIsCurrent()) return null
            preparedRouteRef.current = prepared
            setPreparedRoute(prepared)
            persistPublicRouteId(prepared.publicRouteId)
            setPersistedRouteId(prepared.publicRouteId)
            setPhase('prepared')
            return prepared
        } catch (caught) {
            if (!preparationIsCurrent()) return null
            executionPhaseRef.current?.(executionPhase, {
                sourceChainId: selectedRoute.sourceChainId,
                destinationChainId: selectedRoute.destinationChainId,
                routeId: selectedRoute.publicRouteId,
            }, caught)
            setPhase('review')
            setError(caught instanceof Error ? caught.message : 'Unable to prepare route.')
            throw caught
        }
    }, [account, endpoint, selectedRoute, signMessage])

    const claimSource = useCallback(async () => {
        const currentPreparedRoute = preparedRouteRef.current
        if (!currentPreparedRoute || hasClaimed) return hasClaimed
        setPhase('claiming')
        setError(null)
        try {
            await claimCrossChainRoute({
                endpoint,
                routeId: currentPreparedRoute.publicRouteId,
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
    }, [endpoint, hasClaimed])

    const markSubmitted = useCallback(async (transactionHash) => {
        const currentPreparedRoute = preparedRouteRef.current
        if (!currentPreparedRoute) return false
        try {
            executionPhaseRef.current?.('report-submitted', {
                sourceChainId: currentPreparedRoute.sourceChainId,
                destinationChainId: currentPreparedRoute.destinationChainId,
                routeId: currentPreparedRoute.publicRouteId,
            })
            await markCrossChainRouteSubmitted({
                endpoint,
                routeId: currentPreparedRoute.publicRouteId,
                sessionToken: sessionRef.current?.sessionToken,
                transactionHash,
            })
            persistPublicRouteId(currentPreparedRoute.publicRouteId)
            setPersistedRouteId(currentPreparedRoute.publicRouteId)
            return true
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Transaction sent, but status reporting failed.')
            return false
        }
    }, [endpoint])

    const reset = useCallback(() => {
        prepareSequenceRef.current += 1
        setRoutes([])
        selectedRouteRef.current = null
        setSelectedRoute(null)
        setRecommendedRouteId(null)
        setPreparedRoute(null)
        preparedRouteRef.current = null
        setRouteStatus(null)
        setError(null)
        setStatusUnavailable(false)
        setHasClaimed(false)
        setPhase('idle')
        clearPersistedPublicRouteId()
        setPersistedRouteId(null)
        sessionRef.current = null
        lastQuotedKeyRef.current = null
    }, [])

    useEffect(() => {
        if (previousContextKey.current === contextKey) return
        quoteControllerRef.current?.abort()
        quoteSequenceRef.current += 1
        previousContextKey.current = contextKey
        reset()
    }, [contextKey, reset])

    useEffect(() => () => quoteControllerRef.current?.abort(), [])

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
                executionPhaseRef.current?.('start-status-polling', {
                    sourceChainId: preparedRoute?.sourceChainId ?? null,
                    destinationChainId: preparedRoute?.destinationChainId ?? null,
                    routeId,
                })
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
    }, [endpoint, persistedRouteId, preparedRoute])

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
