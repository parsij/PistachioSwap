import {
    useCallback,
    useEffect,
    useState,
} from 'react'

import {
    fetchWalletTokens,
    WALLET_TOKEN_CACHE_NAMESPACE,
} from '../services/walletTokens.js'

const SECURITY_REFRESH_DELAY_MS = 5_000
const WALLET_REFRESH_DELAY_MS = 30_000

function sameWalletTokens(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

const DISCONNECTED_STATE = {
    requestKey: null,
    tokens: [],
    loading: false,
    error: null,
}

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
            ? `${WALLET_TOKEN_CACHE_NAMESPACE}${chainId}:${normalizedAddress}`
            : null

    const [refreshIndex, setRefreshIndex] =
        useState(0)

    const [state, setState] = useState({
        requestKey: null,
        tokens: [],
        loading: false,
        error: null,
    })

    const refetch = useCallback(() => {
        if (requestKey) {
            setRefreshIndex((value) => value + 1)
        }
    }, [requestKey])

    useEffect(() => {
        if (!requestKey) {
            return undefined
        }

        const controller = new AbortController()
        let securityRefreshTimer = null
        setState((current) => current.requestKey === requestKey
            ? { ...current, error: null }
            : {
                  requestKey,
                  tokens: [],
                  loading: true,
                  error: null,
              })

        fetchWalletTokens({
            chainId,
            address: normalizedAddress,
            signal: controller.signal,
        })
            .then((tokens) => {
                if (!controller.signal.aborted) {
                    setState((current) =>
                        current.requestKey === requestKey &&
                        !current.loading &&
                        current.error === null &&
                        sameWalletTokens(current.tokens, tokens)
                            ? current
                            : {
                                  requestKey,
                                  tokens,
                                  loading: false,
                                  error: null,
                              },
                    )
                    const securityPending = tokens.some((token) =>
                        !token.isNative &&
                        token.securityProviders?.honeypot?.checkedAt == null &&
                        token.securityProviders?.goPlus?.checkedAt == null,
                    )
                    securityRefreshTimer = window.setTimeout(
                        () => setRefreshIndex((value) => value + 1),
                        securityPending
                            ? SECURITY_REFRESH_DELAY_MS
                            : WALLET_REFRESH_DELAY_MS,
                    )
                }
            })
            .catch((error) => {
                if (!controller.signal.aborted) {
                    setState((current) => ({
                        requestKey,
                        tokens: current.requestKey === requestKey
                            ? current.tokens
                            : [],
                        loading: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : 'Unable to load wallet tokens',
                    }))
                }
            })

        return () => {
            controller.abort()
            if (securityRefreshTimer !== null) {
                window.clearTimeout(securityRefreshTimer)
            }
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
