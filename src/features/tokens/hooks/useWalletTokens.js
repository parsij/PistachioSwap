import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'

import { fetchWalletTokens } from '../services/walletTokens.js'
import {
    fetchKnownWalletTokenBalances,
    mergeKnownWalletTokenBalances,
    readWalletTokenCache,
    walletTokenCacheKey,
    writeWalletTokenCache,
} from '../services/walletTokenCache.js'

const SECURITY_REFRESH_DELAY_MS = 5_000
const WALLET_REFRESH_DELAY_MS = 30_000
export const ALL_CHAIN_WALLET_REFRESH_DELAY_MS = 180_000

function sameWalletTokens(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

const DISCONNECTED_STATE = {
    requestKey: null,
    tokens: [],
    loading: false,
    error: null,
    chainErrors: {},
    queriedChainIds: [],
    successfulChainIds: [],
    failedChainIds: [],
    providerRejectedChainIds: [],
    unsupportedChainIds: [],
    partial: false,
    stale: false,
    hydrationSource: null,
}

function normalizeWalletResult(result, chainId) {
    if (Array.isArray(result)) {
        return {
            tokens: result,
            chainErrors: {},
            queriedChainIds: [Number(chainId)],
            successfulChainIds: [Number(chainId)],
            failedChainIds: [],
            providerRejectedChainIds: [],
            unsupportedChainIds: [],
            partial: false,
            stale: false,
        }
    }
    return {
        tokens: result.tokens,
        chainErrors: result.chainErrors ?? {},
        queriedChainIds: result.queriedChainIds ?? [],
        successfulChainIds: result.successfulChainIds ?? [],
        failedChainIds: result.failedChainIds ?? [],
        providerRejectedChainIds: result.providerRejectedChainIds ?? [],
        unsupportedChainIds: result.unsupportedChainIds ?? [],
        partial: result.partial === true,
        stale: result.stale === true,
    }
}

/**
 * Paints cached wallet assets immediately, verifies those known balances through
 * the fast RPC endpoint, and replaces them with full backend discovery results.
 */
export function useWalletTokens({
    chainId = 56,
    walletAddress = null,
    enabled = true,
} = {}) {
    const normalizedAddress = /^0x[a-fA-F0-9]{40}$/.test(
        String(walletAddress ?? ''),
    )
        ? walletAddress.toLowerCase()
        : null
    const requestKey = enabled && normalizedAddress
        ? walletTokenCacheKey({ chainId, address: normalizedAddress })
        : null
    const requestSequence = useRef(0)
    const requestInFlight = useRef(false)
    const refreshQueued = useRef(false)
    const [refreshIndex, setRefreshIndex] = useState(0)
    const [state, setState] = useState(DISCONNECTED_STATE)

    const refetch = useCallback(() => {
        if (!requestKey) return false
        if (requestInFlight.current) {
            refreshQueued.current = true
            return false
        }
        setRefreshIndex((value) => value + 1)
        return true
    }, [requestKey])

    useEffect(() => {
        const sequence = ++requestSequence.current
        if (!requestKey) {
            requestInFlight.current = false
            return undefined
        }

        const controller = new AbortController()
        const cached = readWalletTokenCache({
            chainId,
            address: normalizedAddress,
        })
        refreshQueued.current = false
        requestInFlight.current = true
        let automaticRefreshDelay = null
        let securityRefreshTimer = null
        let fullRequestFinished = false

        const scheduleRefresh = () => {
            if (
                automaticRefreshDelay === null ||
                document.hidden ||
                securityRefreshTimer !== null
            ) return
            securityRefreshTimer = window.setTimeout(() => {
                securityRefreshTimer = null
                if (!document.hidden && !requestInFlight.current) {
                    setRefreshIndex((value) => value + 1)
                }
            }, automaticRefreshDelay)
        }
        const visibilityHandler = () => {
            if (document.hidden) {
                if (securityRefreshTimer !== null) {
                    window.clearTimeout(securityRefreshTimer)
                    securityRefreshTimer = null
                }
                return
            }
            scheduleRefresh()
        }
        document.addEventListener('visibilitychange', visibilityHandler)

        setState((current) => current.requestKey === requestKey
            ? { ...current, loading: true, error: null }
            : cached
                ? {
                      requestKey,
                      ...cached,
                      loading: true,
                      error: null,
                      stale: true,
                      hydrationSource: 'cache',
                  }
                : {
                      ...DISCONNECTED_STATE,
                      requestKey,
                      loading: true,
                  })

        if (cached?.tokens.length > 0) {
            void fetchKnownWalletTokenBalances({
                address: normalizedAddress,
                tokens: cached.tokens,
                signal: controller.signal,
            }).then((payload) => {
                if (
                    !payload ||
                    fullRequestFinished ||
                    controller.signal.aborted ||
                    sequence !== requestSequence.current
                ) return
                const tokens = mergeKnownWalletTokenBalances(
                    cached.tokens,
                    payload,
                )
                writeWalletTokenCache({
                    chainId,
                    address: normalizedAddress,
                    tokens,
                    metadata: cached,
                })
                setState((current) => current.requestKey === requestKey
                    ? {
                          ...current,
                          tokens,
                          loading: true,
                          error: null,
                          chainErrors: {
                              ...current.chainErrors,
                              ...(payload.chainErrors ?? {}),
                          },
                          stale: true,
                          hydrationSource: 'verified-cache',
                      }
                    : current)
            }).catch(() => undefined)
        }

        fetchWalletTokens({
            chainId,
            address: normalizedAddress,
            signal: controller.signal,
        }).then((result) => {
            fullRequestFinished = true
            if (
                controller.signal.aborted ||
                sequence !== requestSequence.current
            ) return

            const responseState = normalizeWalletResult(result, chainId)
            writeWalletTokenCache({
                chainId,
                address: normalizedAddress,
                tokens: responseState.tokens,
                metadata: responseState,
            })
            setState((current) =>
                current.requestKey === requestKey &&
                !current.loading &&
                current.error === null &&
                Object.keys(responseState.chainErrors).length === 0 &&
                sameWalletTokens(current.tokens, responseState.tokens)
                    ? current
                    : {
                          requestKey,
                          ...responseState,
                          loading: false,
                          error: null,
                          hydrationSource: 'discovery',
                      })
            requestInFlight.current = false
            if (refreshQueued.current) {
                refreshQueued.current = false
                setRefreshIndex((value) => value + 1)
                return
            }

            const securityPending = responseState.tokens.some((token) =>
                !token.isNative && [
                    token.securityProviders?.honeypot,
                    token.securityProviders?.goPlus,
                ].some((provider) =>
                    provider?.available === true && provider.checkedAt == null))
            const isAllChains = String(chainId).trim().toLowerCase() === 'all'
            automaticRefreshDelay = isAllChains
                ? ALL_CHAIN_WALLET_REFRESH_DELAY_MS
                : securityPending
                    ? SECURITY_REFRESH_DELAY_MS
                    : WALLET_REFRESH_DELAY_MS
            scheduleRefresh()
        }).catch(() => {
            fullRequestFinished = true
            if (
                controller.signal.aborted ||
                sequence !== requestSequence.current
            ) return
            requestInFlight.current = false
            setState((current) => current.requestKey === requestKey
                ? {
                      ...current,
                      loading: false,
                      error: 'Wallet balances could not be loaded.',
                      stale: current.tokens.length > 0,
                  }
                : {
                      ...DISCONNECTED_STATE,
                      requestKey,
                      error: 'Wallet balances could not be loaded.',
                  })
            if (refreshQueued.current) {
                refreshQueued.current = false
                setRefreshIndex((value) => value + 1)
            }
        })

        return () => {
            controller.abort()
            if (securityRefreshTimer !== null) {
                window.clearTimeout(securityRefreshTimer)
            }
            document.removeEventListener('visibilitychange', visibilityHandler)
        }
    }, [
        chainId,
        normalizedAddress,
        refreshIndex,
        requestKey,
    ])

    const visibleState = requestKey && state.requestKey === requestKey
        ? state
        : DISCONNECTED_STATE

    return {
        ...visibleState,
        refetch,
    }
}
