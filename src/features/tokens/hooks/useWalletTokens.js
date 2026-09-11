import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react'
import { formatUnits } from 'viem'

import { fetchWalletTokens } from '../services/walletTokens.js'
import {
    fetchKnownWalletTokenBalances,
    mergeKnownWalletTokenBalances,
    readWalletTokenCache,
    walletTokenCacheKey,
    writeWalletTokenCache,
} from '../services/walletTokenCache.js'
import {
    applyOptimisticRawBalance,
    getOptimisticWalletBalanceRevision,
    getOptimisticWalletDeltas,
    subscribeOptimisticWalletBalances,
} from '../../wallet/services/optimisticBalances.js'

const SECURITY_REFRESH_DELAY_MS = 5_000
const WALLET_REFRESH_DELAY_MS = 30_000
export const ALL_CHAIN_WALLET_REFRESH_DELAY_MS = 180_000

function sameWalletTokens(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function hasPositiveBalance(token) {
    const raw = String(token?.rawBalance ?? '').trim()
    if (/^\d+$/.test(raw)) return BigInt(raw) > 0n
    const balance = String(token?.formattedBalance ?? token?.balance ?? '').trim()
    return /[1-9]/.test(balance)
}

function isUsableOptimisticToken(change) {
    const token = change?.token
    if (!token || typeof token !== 'object' || Array.isArray(token)) return false
    const chainId = Number(token.chainId)
    const decimals = Number(token.decimals)
    const address = String(token.address ?? '').toLowerCase()
    if (
        !Number.isSafeInteger(chainId) ||
        chainId !== Number(change.chainId) ||
        !/^0x[a-f0-9]{40}$/.test(address) ||
        address !== String(change.tokenAddress ?? '').toLowerCase() ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255
    ) return false
    if (token.possibleSpam === true) return false
    if (['high', 'blocked'].includes(token.securityStatus)) return false
    if (token.classificationTier === 'blocked') return false
    return true
}

function applyPendingBalanceChanges(tokens, walletAddress) {
    if (!walletAddress) return tokens
    const deltas = getOptimisticWalletDeltas(walletAddress)
    if (deltas.length === 0) return tokens

    const byIdentity = new Map(deltas.map((change) => [
        `${Number(change.chainId)}:${change.tokenAddress}`,
        change,
    ]))
    const consumed = new Set()
    const updated = tokens.map((token) => {
        const identity = `${Number(token.chainId)}:${String(token.address ?? '').toLowerCase()}`
        const change = byIdentity.get(identity)
        if (!change) return token
        consumed.add(identity)
        const rawBalance = applyOptimisticRawBalance(token.rawBalance ?? '0', change.deltaRaw)
        const formattedBalance = formatUnits(rawBalance, Number(token.decimals ?? 18))
        return {
            ...token,
            rawBalance: rawBalance.toString(),
            balance: formattedBalance,
            formattedBalance,
            valueUSD: null,
            optimisticPending: true,
        }
    })

    for (const [identity, change] of byIdentity) {
        if (
            consumed.has(identity) ||
            BigInt(change.deltaRaw) <= 0n ||
            !isUsableOptimisticToken(change)
        ) continue
        const rawBalance = applyOptimisticRawBalance('0', change.deltaRaw)
        const formattedBalance = formatUnits(rawBalance, Number(change.token.decimals ?? 18))
        updated.push({
            ...change.token,
            rawBalance: rawBalance.toString(),
            balance: formattedBalance,
            formattedBalance,
            valueUSD: null,
            optimisticPending: true,
        })
    }

    return updated
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
    provider: null,
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
            provider: 'legacy',
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
        provider: result.provider ?? result.source ?? null,
    }
}

function shouldKeepLastKnownGood(current, responseState) {
    if (!current.tokens.some(hasPositiveBalance)) return false
    if (responseState.tokens.some(hasPositiveBalance)) return false
    return responseState.partial === true ||
        responseState.stale === true ||
        responseState.failedChainIds.length > 0 ||
        responseState.providerRejectedChainIds.length > 0
}

/**
 * Paints cached wallet assets immediately, verifies those known balances through
 * the fast RPC endpoint, and replaces them with full backend discovery results.
 * Pending locally submitted transactions are overlaid until they settle so the
 * wallet reacts immediately instead of waiting for indexers or RPC confirmation.
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
    const optimisticRevision = useSyncExternalStore(
        subscribeOptimisticWalletBalances,
        getOptimisticWalletBalanceRevision,
        getOptimisticWalletBalanceRevision,
    )
    const previousOptimisticRevisionRef = useRef(optimisticRevision)

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
        if (previousOptimisticRevisionRef.current === optimisticRevision) return
        previousOptimisticRevisionRef.current = optimisticRevision
        refetch()
    }, [optimisticRevision, refetch])

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
            let retainedLastKnownGood = false
            setState((current) => {
                if (current.requestKey !== requestKey) return current
                if (shouldKeepLastKnownGood(current, responseState)) {
                    retainedLastKnownGood = true
                    return {
                        ...current,
                        ...responseState,
                        tokens: current.tokens,
                        loading: false,
                        error: 'Some wallet balances could not be refreshed. Showing the last verified balances.',
                        stale: true,
                        hydrationSource: 'last-known-good',
                    }
                }
                return !current.loading &&
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
                      }
            })
            if (!retainedLastKnownGood) {
                writeWalletTokenCache({
                    chainId,
                    address: normalizedAddress,
                    tokens: responseState.tokens,
                    metadata: responseState,
                })
            }
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
            requestInFlight.current = false
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
                      error: 'Wallet balances could not be refreshed.',
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
    const visibleTokens = requestKey
        ? applyPendingBalanceChanges(visibleState.tokens, normalizedAddress)
        : visibleState.tokens

    return {
        ...visibleState,
        tokens: visibleTokens,
        refetch,
    }
}
