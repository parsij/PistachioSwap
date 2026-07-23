import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createQuoteRequestBody, fetchSwapQuote, isCurrentQuoteResponse } from '../services/quotes.js'
import { isQuoteExpired } from '../../../services/swapTransaction.js'
import { getTokenIdentity } from '../../tokens/model/tokenNormalization.js'
import { normalizeQuoteAmount, normalizeQuoteSellAmount } from '../model/amountMath.js'
import {
    approvalMetadataDiagnostic,
    executionErrorSnapshot,
    quoteDiagnostic,
    requestDiagnostic,
    requestKeySuffix,
    tokenDiagnostic,
} from '../../../shared/logging/swapDiagnostics.js'

const SAME_CHAIN_QUOTE_CONFIG_VERSION = 'same-chain-quote-v2'

/**
 * Owns the debounced same-chain quote lifecycle, request identity, aborts, stale rejection, and refresh application.
 *
 * @param {object} config Quote inputs and semantic update callbacks.
 * @returns {object} Quote, status, snapshot, refresh/reset operations, and execution-safe quote accessors.
 * @sideEffects Debounces HTTP quote requests, aborts superseded requests, updates input display amounts, and logs existing diagnostics.
 * @throws Request failures are converted to quote/status state and visible messages rather than escaping effects.
 * @security Request/account/chain/token identity is captured in request keys; stale responses are rejected fail-closed.
 */
export function useSwapQuote({
    endpoint,
    debounceMs,
    chainId,
    walletState,
    walletAddress,
    sellToken,
    buyToken,
    sellChainId,
    buyChainId,
    activeAmountSide,
    activeAmountIn,
    activeBuyAmountIn,
    sellInputDenomination,
    buyInputDenomination,
    sellDisplayPrice,
    buyDisplayPrice,
    configuredSlippageBps,
    routingMode,
    crossChainMode,
    gasAssistMode,
    setSellAmount,
    setBuyAmount,
    setVisibleStatus,
    diagnostic,
}) {
    const [quote, setQuote] = useState(null)
    const [quoteStatus, setQuoteStatus] = useState('idle')
    const [refreshIndex, setRefreshIndex] = useState(0)
    const [providerRecommendedSlippageBps, setProviderRecommendedSlippageBps] = useState(null)
    const quoteRef = useRef(null)
    const quoteLogicalKeyRef = useRef(null)
    const currentRequestKeyRef = useRef(null)
    const lastStartedRequestRef = useRef(null)
    const blockerDiagnosticRef = useRef(null)

    const mode = activeAmountSide === 'buy' ? 'EXACT_OUTPUT' : 'EXACT_INPUT'
    const controlledAmount = mode === 'EXACT_INPUT' ? activeAmountIn : activeBuyAmountIn
    const sellIdentity = getTokenIdentity(sellToken, chainId)
    const buyIdentity = getTokenIdentity(buyToken, chainId)
    const sellAddress = sellToken?.address ?? null
    const buyAddress = buyToken?.address ?? null
    const sellDecimals = Number(sellToken?.decimals)
    const buyDecimals = Number(buyToken?.decimals)
    const hasMixedSwapChains = Boolean(sellToken && buyToken && sellChainId !== buyChainId)

    const blocker = (() => {
        if (!endpoint) return 'missing-quote-endpoint'
        if (!walletState.isConnected) return 'wallet-disconnected'
        if (!walletState.isCorrectNetwork) return 'wrong-wallet-network'
        if (!walletAddress) return 'missing-wallet-address'
        if (!sellAddress) return 'missing-sell-token'
        if (!buyAddress) return 'missing-buy-token'
        if (routingMode === crossChainMode) return 'cross-chain-route'
        if (routingMode === gasAssistMode) return 'gas-assist-route'
        if (sellChainId !== buyChainId) return 'mixed-token-chains'
        if (sellChainId !== chainId) return 'source-chain-mismatch'
        if (!controlledAmount || controlledAmount === '0') return 'missing-amount'
        if (sellIdentity === buyIdentity) return 'same-token'
        return null
    })()

    const snapshot = useMemo(() => {
        if (blocker) return null
        let request
        try {
            request = createQuoteRequestBody({
                chainId,
                sellToken: sellAddress,
                buyToken: buyAddress,
                mode,
                sellAmount: mode === 'EXACT_INPUT' ? controlledAmount : '0',
                buyAmount: mode === 'EXACT_OUTPUT' ? controlledAmount : null,
                sellTokenDecimals: sellDecimals,
                buyTokenDecimals: buyDecimals,
                takerAddress: walletAddress,
                slippageBps: configuredSlippageBps,
            })
        } catch (error) {
            diagnostic('quote.request.build.failed', {
                reason: 'invalid-request-body',
                message: error instanceof Error ? error.message : 'Quote request could not be built.',
                sellToken: { chainId: sellChainId, address: sellAddress, decimals: sellDecimals },
                buyToken: { chainId: buyChainId, address: buyAddress, decimals: buyDecimals },
                chainId,
                mode,
                amount: controlledAmount,
            }, 'error')
            return null
        }
        const inputKey = JSON.stringify([
            mode,
            activeAmountSide === 'sell' ? sellInputDenomination : buyInputDenomination,
            activeAmountSide === 'sell' ? sellDisplayPrice : buyDisplayPrice,
            sellIdentity,
            buyIdentity,
            chainId,
            controlledAmount,
            walletAddress.toLowerCase(),
            SAME_CHAIN_QUOTE_CONFIG_VERSION,
        ])
        return {
            inputKey,
            request,
            requestKey: JSON.stringify([inputKey, configuredSlippageBps, refreshIndex]),
            mode,
            refreshIndex,
            slippageBps: configuredSlippageBps,
            sellDecimals,
            buyDecimals,
        }
    }, [
        activeAmountSide,
        blocker,
        buyAddress,
        buyChainId,
        buyDecimals,
        buyDisplayPrice,
        buyIdentity,
        buyInputDenomination,
        chainId,
        configuredSlippageBps,
        controlledAmount,
        diagnostic,
        mode,
        refreshIndex,
        sellAddress,
        sellChainId,
        sellDecimals,
        sellDisplayPrice,
        sellIdentity,
        sellInputDenomination,
        walletAddress,
    ])

    const applyRefreshedQuote = useCallback((refreshedQuote, inputKey) => {
        quoteRef.current = refreshedQuote
        quoteLogicalKeyRef.current = inputKey
        setQuote(refreshedQuote)
    }, [])

    const getCurrentRequestKey = useCallback(() => currentRequestKeyRef.current, [])

    const resetQuote = useCallback(() => {
        quoteRef.current = null
        quoteLogicalKeyRef.current = null
        setQuote(null)
        setQuoteStatus('idle')
        if (activeAmountSide === 'sell') setBuyAmount('0')
        if (activeAmountSide === 'buy') setSellAmount('')
    }, [activeAmountSide, setBuyAmount, setSellAmount])

    const invalidateQuoteAfterSuccess = useCallback(() => {
        quoteRef.current = null
        quoteLogicalKeyRef.current = null
        setQuote(null)
        setQuoteStatus('idle')
    }, [])

    const refreshQuote = useCallback(() => setRefreshIndex((value) => value + 1), [])
    const clearQuoteForRefresh = useCallback(() => {
        quoteRef.current = null
        quoteLogicalKeyRef.current = null
        setQuote(null)
        setQuoteStatus('loading')
        setRefreshIndex((value) => value + 1)
    }, [])

    useEffect(() => {
        if (routingMode === crossChainMode || routingMode === gasAssistMode) return
        if (!quote?.selectedQuote) return
        diagnostic('approval.metadata.active-quote', approvalMetadataDiagnostic(quote))
    }, [crossChainMode, diagnostic, gasAssistMode, quote, routingMode])

    useEffect(() => {
        if (routingMode === crossChainMode || routingMode === gasAssistMode) return
        const signature = JSON.stringify({ blocker, sellToken: sellIdentity, buyToken: buyIdentity, amount: controlledAmount, mode, chainId })
        if (blockerDiagnosticRef.current === signature) return
        blockerDiagnosticRef.current = signature
        if (blocker) {
            diagnostic('quote.not-scheduled', {
                reason: blocker,
                chainId,
                mode,
                activeAmountSide,
                amount: controlledAmount,
                sellToken: tokenDiagnostic(sellToken),
                buyToken: tokenDiagnostic(buyToken),
                walletConnected: walletState.isConnected,
                walletCorrectNetwork: walletState.isCorrectNetwork,
                walletChainId: walletState.chainId ?? null,
            }, 'warn')
            return
        }
        diagnostic('quote.ready-to-schedule', {
            chainId,
            mode,
            activeAmountSide,
            amount: controlledAmount,
            sellToken: tokenDiagnostic(sellToken),
            buyToken: tokenDiagnostic(buyToken),
            requestKeySuffix: requestKeySuffix(snapshot?.requestKey),
        })
    }, [
        activeAmountSide,
        blocker,
        buyIdentity,
        buyToken,
        chainId,
        controlledAmount,
        crossChainMode,
        diagnostic,
        gasAssistMode,
        mode,
        routingMode,
        sellIdentity,
        sellToken,
        snapshot?.requestKey,
        walletState.chainId,
        walletState.isConnected,
        walletState.isCorrectNetwork,
    ])

    useEffect(() => {
        if (!snapshot) {
            diagnostic('quote.state.reset', {
                reason: blocker ?? 'no-snapshot',
                previousRequestKeySuffix: requestKeySuffix(currentRequestKeyRef.current),
            })
            currentRequestKeyRef.current = null
            quoteRef.current = null
            quoteLogicalKeyRef.current = null
            setQuote(null)
            setQuoteStatus('idle')
            if (!hasMixedSwapChains && mode === 'EXACT_INPUT') setBuyAmount('0')
            if (!hasMixedSwapChains && mode === 'EXACT_OUTPUT') setSellAmount('')
            return undefined
        }

        const controller = new AbortController()
        currentRequestKeyRef.current = snapshot.requestKey
        diagnostic('quote.request.scheduled', {
            requestKeySuffix: requestKeySuffix(snapshot.requestKey),
            inputKeySuffix: requestKeySuffix(snapshot.inputKey),
            debounceMs,
            request: requestDiagnostic(snapshot.request),
        })

        let pendingWarningId = null
        const timeoutId = window.setTimeout(async () => {
            const previousRequest = lastStartedRequestRef.current
            const reason = !previousRequest
                ? 'initial'
                : previousRequest.inputKey !== snapshot.inputKey
                    ? 'user-input'
                    : previousRequest.refreshIndex !== snapshot.refreshIndex
                        ? 'manual-refresh'
                        : previousRequest.slippageBps !== snapshot.slippageBps
                            ? 'settings-change'
                            : 'user-input'
            lastStartedRequestRef.current = snapshot
            const retainedPreviousQuote = Boolean(
                quoteRef.current && quoteLogicalKeyRef.current === snapshot.inputKey && !isQuoteExpired(quoteRef.current),
            )
            diagnostic('quote.request.start', {
                requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                inputKeySuffix: requestKeySuffix(snapshot.inputKey),
                reason,
                retainedPreviousQuote,
                request: requestDiagnostic(snapshot.request),
            })
            if (!retainedPreviousQuote) {
                quoteRef.current = null
                quoteLogicalKeyRef.current = null
                setQuote(null)
                setQuoteStatus('loading')
                if (snapshot.mode === 'EXACT_INPUT') setBuyAmount('0')
                if (snapshot.mode === 'EXACT_OUTPUT') setSellAmount('')
            }
            setVisibleStatus(null)
            const startedAtMs = Date.now()
            let applied = false
            pendingWarningId = window.setTimeout(() => {
                diagnostic('quote.request.pending', {
                    requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                    durationMs: Date.now() - startedAtMs,
                    request: requestDiagnostic(snapshot.request),
                }, 'warn')
            }, 10_000)
            try {
                const responseQuote = await fetchSwapQuote({ endpoint, request: snapshot.request, signal: controller.signal })
                diagnostic('quote.response.received', {
                    requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                    quote: quoteDiagnostic(responseQuote),
                })
                if (!isCurrentQuoteResponse(controller.signal) || currentRequestKeyRef.current !== snapshot.requestKey) {
                    diagnostic('quote.response.ignored', {
                        reason: controller.signal.aborted ? 'aborted' : 'stale-request-key',
                        requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                        currentRequestKeySuffix: requestKeySuffix(currentRequestKeyRef.current),
                    }, 'warn')
                    return
                }
                const outputAmount = normalizeQuoteAmount(responseQuote, snapshot.buyDecimals)
                const inputAmount = normalizeQuoteSellAmount(responseQuote, snapshot.sellDecimals)
                if ((snapshot.mode === 'EXACT_INPUT' && outputAmount === null) ||
                    (snapshot.mode === 'EXACT_OUTPUT' && inputAmount === null)) {
                    diagnostic('quote.validation.failed', {
                        requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                        reason: 'invalid-normalized-amount',
                        mode: snapshot.mode,
                        outputAmount,
                        inputAmount,
                        quote: quoteDiagnostic(responseQuote),
                    }, 'error')
                    throw new Error('Quote response did not contain a valid amount')
                }
                diagnostic('quote.validation.passed', {
                    requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                    mode: snapshot.mode,
                    outputAmount,
                    inputAmount,
                    quote: quoteDiagnostic(responseQuote),
                })
                quoteRef.current = responseQuote
                quoteLogicalKeyRef.current = snapshot.inputKey
                setQuote(responseQuote)
                const providerRecommendation = Number(
                    responseQuote?.recommendedSlippageBps ?? responseQuote?.selectedQuote?.recommendedSlippageBps ?? 0,
                )
                if (Number.isInteger(providerRecommendation) && providerRecommendation > 0 && providerRecommendation <= 10_000) {
                    setProviderRecommendedSlippageBps(providerRecommendation)
                }
                if (snapshot.mode === 'EXACT_INPUT' && buyInputDenomination === 'TOKEN') setBuyAmount(outputAmount)
                else if (sellInputDenomination === 'TOKEN') setSellAmount(inputAmount)
                setQuoteStatus('success')
                setVisibleStatus(null)
                applied = true
                diagnostic('quote.applied', {
                    requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                    mode: snapshot.mode,
                    outputAmount,
                    inputAmount,
                    providerRecommendedSlippageBps: providerRecommendation || null,
                })
            } catch (error) {
                const aborted = controller.signal.aborted || error?.name === 'AbortError'
                if (aborted || currentRequestKeyRef.current !== snapshot.requestKey) {
                    diagnostic('quote.error.ignored', {
                        reason: aborted ? 'aborted' : 'stale-request-key',
                        requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                        currentRequestKeySuffix: requestKeySuffix(currentRequestKeyRef.current),
                        error: executionErrorSnapshot(error),
                    }, 'warn')
                    return
                }
                if (retainedPreviousQuote) {
                    setQuoteStatus('success')
                    setVisibleStatus('Price refresh failed. Showing the previous quote.')
                    diagnostic('quote.error.retained-previous', {
                        requestKeySuffix: requestKeySuffix(snapshot.requestKey), error: executionErrorSnapshot(error),
                    }, 'warn')
                } else {
                    quoteRef.current = null
                    quoteLogicalKeyRef.current = null
                    setQuote(null)
                    if (snapshot.mode === 'EXACT_INPUT') setBuyAmount('0')
                    if (snapshot.mode === 'EXACT_OUTPUT') setSellAmount('')
                    setQuoteStatus('error')
                    setVisibleStatus(import.meta.env.DEV && error instanceof Error
                        ? error.message
                        : 'No route is currently available.')
                    diagnostic('quote.error.visible', {
                        requestKeySuffix: requestKeySuffix(snapshot.requestKey), error: executionErrorSnapshot(error),
                    }, 'error')
                }
            } finally {
                if (pendingWarningId !== null) {
                    window.clearTimeout(pendingWarningId)
                    pendingWarningId = null
                }
                const finishedAtMs = Date.now()
                diagnostic('quote.request.finish', {
                    requestKeySuffix: requestKeySuffix(snapshot.requestKey),
                    mode: snapshot.mode,
                    reason,
                    startedAt: new Date(startedAtMs).toISOString(),
                    finishedAt: new Date(finishedAtMs).toISOString(),
                    durationMs: finishedAtMs - startedAtMs,
                    aborted: controller.signal.aborted,
                    applied,
                    retainedPreviousQuote,
                })
            }
        }, debounceMs)

        return () => {
            window.clearTimeout(timeoutId)
            if (pendingWarningId !== null) window.clearTimeout(pendingWarningId)
            controller.abort()
            diagnostic('quote.request.cleanup', {
                requestKeySuffix: requestKeySuffix(snapshot.requestKey), reason: 'effect-cleanup',
            })
        }
    }, [
        blocker,
        buyInputDenomination,
        debounceMs,
        diagnostic,
        endpoint,
        hasMixedSwapChains,
        mode,
        sellInputDenomination,
        setBuyAmount,
        setSellAmount,
        setVisibleStatus,
        snapshot,
    ])

    return {
        quote,
        quoteStatus,
        refreshIndex,
        providerRecommendedSlippageBps,
        snapshot,
        blocker,
        mode,
        controlledAmount,
        quoteInputKey: quoteLogicalKeyRef.current,
        refreshQuote,
        clearQuoteForRefresh,
        resetQuote,
        invalidateQuoteAfterSuccess,
        applyRefreshedQuote,
        getCurrentRequestKey,
    }
}
