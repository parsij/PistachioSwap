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

function sameWalletTokens(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

const DISCONNECTED_STATE = {
    requestKey: null,
    tokens: [],
    loading: false,
    error: null,
    chainErrors: {},
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

    const [refreshIndex, setRefreshIndex] =
        useState(0)

    const [state, setState] = useState({
        requestKey: null,
        tokens: [],
        loading: false,
        error: null,
        chainErrors: {},
    })

    const refetch = useCallback(() => {
        if (requestKey) {
            setRefreshIndex((value) => value + 1)
        }
    }, [requestKey])

    useEffect(() => {
        const sequence = ++requestSequence.current
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
                  chainErrors: {},
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
                              },
                    )
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
                    securityRefreshTimer = window.setTimeout(
                        () => setRefreshIndex((value) => value + 1),
                        securityPending
                            ? SECURITY_REFRESH_DELAY_MS
                            : WALLET_REFRESH_DELAY_MS,
                    )
                }
            })
            .catch((error) => {
                if (
                    !controller.signal.aborted &&
                    sequence === requestSequence.current
                ) {
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
                        chainErrors: {},
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
