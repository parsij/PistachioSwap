import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'

import {
    fetchWalletTokens,
    WALLET_TOKEN_CACHE_NAMESPACE,
} from '../services/walletTokens.js'

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
}

/**
 * Loads wallet tokens for one/all supported chains with partial/stale refresh semantics.
 * @param {{chainId: number|string, walletAddress: string|null, enabled?: boolean}} config Wallet query.
 * @returns {object} Token records, chain-level failures, loading/error/stale flags, and refetch.
 * @sideEffects Performs backend HTTP and scheduled refreshes; does not prompt the wallet.
 */
export function useWalletTokens({
    chainId = 56,
    walletAddress = null,
    enabled = true,
} = {}) {
    const normalizedAddress =
        /^0x[a-fA-F0-9]{40}$/.test(
            String(walletAddress ?? ''),
        )
            ? walletAddress.toLowerCase()
            : null

    const requestKey =
        enabled && normalizedAddress
            ? (() => {
                  const scope = String(chainId).trim().toLowerCase() === 'all'
                      ? 'all'
                      : Number(chainId)
                  return scope === 'all' ||
                      (Number.isSafeInteger(scope) && scope > 0)
                      ? `${WALLET_TOKEN_CACHE_NAMESPACE}${scope}:${normalizedAddress}`
                      : null
              })()
            : null
    const requestSequence = useRef(0)
    const requestInFlight = useRef(false)
    const refreshQueued = useRef(false)

    const [refreshIndex, setRefreshIndex] =
        useState(0)

    const [state, setState] = useState({
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
    })

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
            return undefined
        }

        const controller = new AbortController()
        refreshQueued.current = false
        let securityRefreshTimer = null
        let automaticRefreshDelay = null
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
        requestInFlight.current = true
        setState((current) => current.requestKey === requestKey
            ? { ...current, loading: true }
            : {
                  requestKey,
                  tokens: [],
                  loading: true,
                  error: null,
                  chainErrors: {},
                  queriedChainIds: [],
                  successfulChainIds: [],
                  failedChainIds: [],
                  providerRejectedChainIds: [],
                  unsupportedChainIds: [],
                  partial: false,
                  stale: false,
              })

        fetchWalletTokens({
            chainId,
            address: normalizedAddress,
            signal: controller.signal,
        })
            .then((result) => {
                if (
                    !controller.signal.aborted &&
                    sequence === requestSequence.current
                ) {
                    const tokens = Array.isArray(result)
                        ? result
                        : result.tokens
                    const chainErrors = Array.isArray(result)
                        ? {}
                        : result.chainErrors ?? {}
                    const responseState = Array.isArray(result)
                        ? {
                              queriedChainIds: [Number(chainId)],
                              successfulChainIds: [Number(chainId)],
                              failedChainIds: [],
                              providerRejectedChainIds: [],
                              unsupportedChainIds: [],
                              partial: false,
                              stale: false,
                          }
                        : {
                              queriedChainIds: result.queriedChainIds ?? [],
                              successfulChainIds: result.successfulChainIds ?? [],
                              failedChainIds: result.failedChainIds ?? [],
                              providerRejectedChainIds:
                                  result.providerRejectedChainIds ?? [],
                              unsupportedChainIds: result.unsupportedChainIds ?? [],
                              partial: result.partial === true,
                              stale: result.stale === true,
                          }
                    setState((current) =>
                        current.requestKey === requestKey &&
                        !current.loading &&
                        current.error === null &&
                        Object.keys(chainErrors).length === 0 &&
                        sameWalletTokens(current.tokens, tokens)
                            ? current
                            : {
                                  requestKey,
                                  tokens,
                                  loading: false,
                                  error: null,
                                  chainErrors,
                                  ...responseState,
                              },
                    )
                    requestInFlight.current = false
                    if (refreshQueued.current) {
                        refreshQueued.current = false
                        setRefreshIndex((value) => value + 1)
                        return
                    }
                    const securityPending = tokens.some((token) =>
                        !token.isNative &&
                        [
                            token.securityProviders?.honeypot,
                            token.securityProviders?.goPlus,
                        ].some(
                            (provider) =>
                                provider?.available === true &&
                                provider.checkedAt == null,
                        ),
                    )
                    const isAllChains = String(chainId).trim().toLowerCase() === 'all'
                    automaticRefreshDelay = isAllChains
                        ? ALL_CHAIN_WALLET_REFRESH_DELAY_MS
                        : securityPending
                          ? SECURITY_REFRESH_DELAY_MS
                          : WALLET_REFRESH_DELAY_MS
                    scheduleRefresh()
                }
            })
            .catch(() => {
                if (
                    !controller.signal.aborted &&
                    sequence === requestSequence.current
                ) {
                    requestInFlight.current = false
                    setState((current) => current.requestKey === requestKey
                        ? {
                              ...current,
                              loading: false,
                              error: 'Wallet balances could not be loaded.',
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

    const visibleState =
        requestKey && state.requestKey === requestKey
            ? state
            : DISCONNECTED_STATE

    return {
        ...visibleState,
        refetch,
    }
}
