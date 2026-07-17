import {
    useEffect,
    useRef,
    useState,
} from 'react'

import {
    fetchMarketTokens,
    normalizeMarketChainScope,
} from '../services/marketTokens.js'

export function isLatestMarketTokenRequest({
                                               sequence,
                                               currentSequence,
                                               signal,
                                           }) {
    return !signal.aborted && sequence === currentSequence
}

export function useMarketTokens({
                                    chainId = 56,
                                    search = '',
                                } = {}) {
    const normalizedSearch = search.trim().toLowerCase()
    let chainScope
    try {
        chainScope = normalizeMarketChainScope(chainId)
    } catch {
        chainScope = 'invalid'
    }
    const requestKey = `${chainScope}:${normalizedSearch}`
    const requestSequence = useRef(0)

    const [state, setState] = useState({
        requestKey: null,
        tokens: [],
        loading: true,
        error: null,
        chainErrors: {},
        browserCache: null,
    })

    useEffect(() => {
        const controller =
            new AbortController()
        const sequence = ++requestSequence.current

        const timeoutId = window.setTimeout(
            async () => {
                try {
                    const result =
                        await fetchMarketTokens({
                            chainId: chainScope,
                            query: normalizedSearch,
                            signal: controller.signal,
                        })

                    if (!isLatestMarketTokenRequest({
                        sequence,
                        currentSequence: requestSequence.current,
                        signal: controller.signal,
                    })) {
                        return
                    }

                    setState({
                        requestKey,
                        tokens: result.tokens,
                        loading: false,
                        error: null,
                        chainErrors:
                            result.chainErrors ??
                            result.errors ??
                            {},

                        browserCache:
                        result.browserCache,
                        query: normalizedSearch,
                    })
                } catch (error) {
                    if (
                        controller.signal.aborted ||
                        error?.name === 'AbortError'
                    ) {
                        return
                    }

                    setState({
                        requestKey,
                        tokens: [],
                        loading: false,

                        error:
                            error instanceof Error
                                ? error.message
                                : 'Unable to load tokens',

                        browserCache: null,
                        chainErrors: {},
                        query: normalizedSearch,
                    })
                }
            },
            normalizedSearch ? 250 : 0,
        )

        return () => {
            window.clearTimeout(timeoutId)
            controller.abort()
        }
    }, [chainScope, normalizedSearch, requestKey])

    if (state.requestKey !== requestKey) {
        return {
            tokens: [],
            loading: true,
            error: null,
            chainErrors: {},
            browserCache: null,
            query: normalizedSearch,
        }
    }

    return {
        ...state,
        query: normalizedSearch,
    }
}
