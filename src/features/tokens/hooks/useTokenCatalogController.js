import { useCallback, useEffect, useMemo, useState } from 'react'
import { zeroAddress } from 'viem'
import { useMarketTokens } from './useMarketTokens.js'
import { useTokenCatalog, TOKEN_CATALOG_SEARCH_LIMIT } from './useTokenCatalog.js'
import { useWalletTokens } from './useWalletTokens.js'
import { useNativeBalance } from './useNativeBalance.js'
import { mergeWalletBalances, WALLET_TOKEN_CLASSIFICATION_VERSION } from '../../tokens/services/walletTokens.js'
import { getCanonicalTokenIdentity } from '../services/marketTokens.js'
import { isNativeEvmToken } from '../../../services/balances.js'
import { getCuratedEvmChain, getCuratedEvmChainLogoUri } from '../../../web3/curatedEvmChains.js'
import { getTokenIdentity, normalizeMarketToken } from '../model/tokenNormalization.js'
import { tokenMatchesSearch } from '../model/tokenSelectorState.js'

function mergeSearchCatalogTokens(localTokens, remoteTokens, fallbackChainId) {
    const merged = new Map()
    for (const token of localTokens) {
        merged.set(getTokenIdentity(token, fallbackChainId), token)
    }
    for (const token of remoteTokens) {
        const identity = getTokenIdentity(token, fallbackChainId)
        const local = merged.get(identity)
        if (!local) {
            merged.set(identity, token)
            continue
        }
        const logoCandidates = [
            ...(local.logoCandidates ?? []),
            local.logoURI,
            ...(token.logoCandidates ?? []),
            token.logoURI,
        ].filter((value, index, values) =>
            typeof value === 'string' && value && values.indexOf(value) === index)
        merged.set(identity, {
            ...token,
            ...local,
            priceUSD: local.priceUSD ?? token.priceUSD ?? null,
            marketPriceUSD: local.marketPriceUSD ?? token.marketPriceUSD ?? null,
            logoURI: logoCandidates[0] ?? null,
            logoCandidates,
        })
    }
    return [...merged.values()]
}

function balancedSearchTokens(tokens, limit) {
    const bestByChain = new Map()
    for (const token of tokens) {
        const chainId = Number(token?.chainId)
        if (!Number.isSafeInteger(chainId) || bestByChain.has(chainId)) continue
        bestByChain.set(chainId, token)
    }
    const selected = [...bestByChain.values()]
    const selectedIds = new Set(selected.map((token) => getCanonicalTokenIdentity(token)))
    for (const token of tokens) {
        if (selected.length >= limit) break
        const identity = getCanonicalTokenIdentity(token)
        if (!identity || selectedIds.has(identity)) continue
        selectedIds.add(identity)
        selected.push(token)
    }
    return selected.slice(0, limit)
}

function normalizeValidTokens(tokens, fallbackChainId, fallbackChainLogo) {
    return tokens
        .map((token) => normalizeMarketToken(token, fallbackChainId, fallbackChainLogo))
        .filter((token) => getCanonicalTokenIdentity(token) !== null)
}

/**
 * Owns token catalog/wallet balance loading and token-selector search/chain state.
 *
 * @param {object} config Catalog, wallet, and active-chain inputs.
 * @returns {object} Merged selectable tokens, wallet/native balances, selector state, and semantic selector operations.
 * @sideEffects Performs existing backend market/wallet-token requests and native-balance RPC reads through dedicated hooks.
 * @security Preserves backend classification fields and exact chain/address token identities when merging balances.
 */
export function useTokenCatalogController({ swapChainId, walletState, tokensConfig }) {
    const [tokenSearch, setTokenSearch] = useState('')
    const [selectorChainId, setSelectorChainId] = useState(swapChainId)
    const [tokenSelectorSide, setTokenSelectorSide] = useState(null)
    const [tokenSelectorMode, setTokenSelectorMode] = useState('picker')
    const discoveryChainId = tokenSelectorSide ? selectorChainId : swapChainId
    const walletAddress = walletState.address
    const normalizedTokenSearch = tokenSearch.trim().toLowerCase()
    const useShapeShiftTokenCatalog =
        import.meta.env.VITE_USE_UNISWAP_VOLUME_TOKENS !== 'false'

    const preloadedMarketCatalog = useMarketTokens({ chainId: 'all' })
    const preloadedHasSelectedRankedTokens = discoveryChainId === 'all' ||
        preloadedMarketCatalog.tokens.some((token) => Number(token.chainId) === Number(discoveryChainId))
    const shouldFetchSelectedCatalog = Boolean(normalizedTokenSearch) ||
        (discoveryChainId !== 'all' && !preloadedMarketCatalog.loading && !preloadedHasSelectedRankedTokens)
    const selectedMarketCatalog = useMarketTokens({
        chainId: discoveryChainId,
        search: tokenSearch,
        enabled: shouldFetchSelectedCatalog,
    })
    const tokenCatalog = useTokenCatalog({
        chainId: discoveryChainId,
        search: tokenSearch,
        enabled: useShapeShiftTokenCatalog,
    })
    const filteredPreloadedMarketCatalog = useMemo(() => ({
        ...preloadedMarketCatalog,
        tokens: discoveryChainId === 'all'
            ? preloadedMarketCatalog.tokens
            : preloadedMarketCatalog.tokens.filter((token) => Number(token.chainId) === Number(discoveryChainId)),
        commonTokens: discoveryChainId === 'all'
            ? (preloadedMarketCatalog.commonTokens ?? [])
            : (preloadedMarketCatalog.commonTokens ?? []).filter((token) => Number(token.chainId) === Number(discoveryChainId)),
        fallbackTokens: discoveryChainId === 'all'
            ? (preloadedMarketCatalog.fallbackTokens ?? preloadedMarketCatalog.commonTokens ?? [])
            : (preloadedMarketCatalog.fallbackTokens ?? preloadedMarketCatalog.commonTokens ?? []).filter((token) => Number(token.chainId) === Number(discoveryChainId)),
    }), [discoveryChainId, preloadedMarketCatalog])
    const activeMarketCatalog = useMemo(() => {
        if (!shouldFetchSelectedCatalog) return filteredPreloadedMarketCatalog
        if (!normalizedTokenSearch) return selectedMarketCatalog

        const localTokens = filteredPreloadedMarketCatalog.tokens.filter((token) =>
            tokenMatchesSearch(token, normalizedTokenSearch))
        const localCommonTokens = (filteredPreloadedMarketCatalog.commonTokens ?? []).filter((token) =>
            tokenMatchesSearch(token, normalizedTokenSearch))
        const localFallbackTokens = (filteredPreloadedMarketCatalog.fallbackTokens ?? []).filter((token) =>
            tokenMatchesSearch(token, normalizedTokenSearch))
        return {
            ...selectedMarketCatalog,
            tokens: mergeSearchCatalogTokens(
                localTokens,
                selectedMarketCatalog.tokens ?? [],
                discoveryChainId,
            ),
            commonTokens: mergeSearchCatalogTokens(
                localCommonTokens,
                selectedMarketCatalog.commonTokens ?? [],
                discoveryChainId,
            ),
            fallbackTokens: mergeSearchCatalogTokens(
                localFallbackTokens,
                selectedMarketCatalog.fallbackTokens ?? selectedMarketCatalog.commonTokens ?? [],
                discoveryChainId,
            ),
            notice: selectedMarketCatalog.notice ??
                (localTokens.length > 0 || localCommonTokens.length > 0 || localFallbackTokens.length > 0
                    ? null
                    : filteredPreloadedMarketCatalog.notice),
        }
    }, [discoveryChainId, filteredPreloadedMarketCatalog, normalizedTokenSearch, selectedMarketCatalog, shouldFetchSelectedCatalog])
    const preferredMarketCatalog = useMemo(() => {
        if (!useShapeShiftTokenCatalog) return activeMarketCatalog

        if (tokenCatalog.tokens.length === 0) {
            return normalizedTokenSearch
                ? {
                    ...activeMarketCatalog,
                    tokens: balancedSearchTokens(
                        activeMarketCatalog.tokens ?? [],
                        TOKEN_CATALOG_SEARCH_LIMIT,
                    ),
                }
                : activeMarketCatalog
        }

        if (discoveryChainId === 'all' && !normalizedTokenSearch) {
            return {
                ...activeMarketCatalog,
                tokens: tokenCatalog.tokens,
                commonTokens: [],
                fallbackTokens: [],
                loading: tokenCatalog.loading,
                error: tokenCatalog.error,
                partial: tokenCatalog.partial === true,
                stale: tokenCatalog.stale === true,
                schemaVersion: tokenCatalog.schemaVersion,
                notice: tokenCatalog.error ? activeMarketCatalog.notice : null,
            }
        }

        const mergedTokens = normalizedTokenSearch
            ? mergeSearchCatalogTokens(
                activeMarketCatalog.tokens ?? [],
                tokenCatalog.tokens,
                discoveryChainId,
            )
            : mergeSearchCatalogTokens(
                tokenCatalog.tokens,
                activeMarketCatalog.tokens ?? [],
                discoveryChainId,
            )
        const tokens = normalizedTokenSearch
            ? balancedSearchTokens(mergedTokens, TOKEN_CATALOG_SEARCH_LIMIT)
            : mergedTokens
        return {
            ...activeMarketCatalog,
            tokens,
            loading: tokens.length === 0 &&
                activeMarketCatalog.loading &&
                tokenCatalog.loading,
            error: tokens.length > 0
                ? null
                : activeMarketCatalog.error ?? tokenCatalog.error,
            partial: activeMarketCatalog.partial === true ||
                tokenCatalog.partial === true,
            stale: activeMarketCatalog.stale === true ||
                tokenCatalog.stale === true,
            schemaVersion: tokenCatalog.schemaVersion ??
                activeMarketCatalog.schemaVersion,
            notice: activeMarketCatalog.notice,
        }
    }, [activeMarketCatalog, discoveryChainId, normalizedTokenSearch, tokenCatalog, useShapeShiftTokenCatalog])
    const {
        tokens: marketTokens,
        commonTokens: commonMarketTokens = [],
        fallbackTokens: fallbackMarketTokens = commonMarketTokens,
        loading: marketTokensLoading,
        error: marketTokensError,
        notice: marketTokensNotice,
        partial: marketTokensPartial,
        stale: marketTokensStale,
        schemaVersion: marketTokensSchemaVersion,
    } = preferredMarketCatalog

    const activeChain = getCuratedEvmChain(swapChainId)
    const fallbackChainLogo = Number(tokensConfig.initialSellToken?.chainId) === discoveryChainId
        ? tokensConfig.initialSellToken?.chainLogoURI ?? null
        : null
    const nativeBalance = useNativeBalance({
        address: walletAddress,
        chainId: swapChainId,
        enabled: walletState.isConnected,
    })
    const {
        tokens: walletTokenResponse,
        error: walletTokenError,
        failedChainIds: walletTokenFailedChainIds = [],
        stale: walletTokenStale,
        refetch: refetchWalletTokens,
    } = useWalletTokens({ chainId: 'all', walletAddress, enabled: walletState.isConnected })

    const normalizedWalletTokens = useMemo(() => normalizeValidTokens(
        walletTokenResponse,
        discoveryChainId,
        fallbackChainLogo,
    ), [discoveryChainId, fallbackChainLogo, walletTokenResponse])
    const walletTokens = useMemo(() => {
        if (nativeBalance.value === null) return normalizedWalletTokens
        const nativeBalanceText = nativeBalance.formatted
        let foundNative = false
        const updated = normalizedWalletTokens.map((token) => {
            if (!isNativeEvmToken(token) || Number(token.chainId) !== swapChainId) return token
            foundNative = true
            return {
                ...token,
                isNative: true,
                balance: nativeBalanceText,
                formattedBalance: nativeBalanceText,
                rawBalance: nativeBalance.value.toString(),
            }
        })
        if (!foundNative) {
            updated.unshift(normalizeMarketToken({
                classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                chainId: swapChainId,
                address: zeroAddress,
                symbol: activeChain?.nativeCurrency.symbol ?? 'NATIVE',
                name: activeChain?.nativeCurrency.name ?? 'Native token',
                decimals: activeChain?.nativeCurrency.decimals ?? 18,
                logoURI: Number(tokensConfig.initialSellToken?.chainId) === swapChainId
                    ? tokensConfig.initialSellToken?.logoURI
                    : getCuratedEvmChainLogoUri(swapChainId),
                isNative: true,
                recognitionStatus: 'established',
                recognitionReasons: ['native-token'],
                verificationStatus: 'established',
                spamStatus: 'clean',
                possibleSpam: false,
                verifiedContract: null,
                spamReasons: ['native-token'],
                securityStatus: 'trusted',
                securityReasons: ['native-token'],
                securityProviders: {
                    honeypot: { available: false, checkedAt: null, risk: null, riskLevel: null, isHoneypot: null },
                    goPlus: { available: false, checkedAt: null, isHoneypot: null },
                },
                visibility: 'primary',
                visibilityReasons: ['native-token'],
                trustedPriceUSD: Number(tokensConfig.initialSellToken?.chainId) === swapChainId
                    ? tokensConfig.initialSellToken?.priceUSD ?? null
                    : null,
                marketPriceUSD: null,
                priceConfidence: Number(tokensConfig.initialSellToken?.chainId) === swapChainId && tokensConfig.initialSellToken?.priceUSD
                    ? 'trusted'
                    : 'unknown',
                balance: nativeBalanceText,
                formattedBalance: nativeBalanceText,
                rawBalance: nativeBalance.value.toString(),
            }, swapChainId, getCuratedEvmChainLogoUri(swapChainId)))
        }
        return updated.filter((token) => getCanonicalTokenIdentity(token) !== null)
    }, [activeChain, nativeBalance.formatted, nativeBalance.value, normalizedWalletTokens, swapChainId, tokensConfig.initialSellToken])

    useEffect(() => {
        if (!import.meta.env.DEV) return
        console.debug('[wallet-classification-summary]', {
            total: walletTokenResponse.length,
            primary: walletTokenResponse.filter((token) => token.visibility === 'primary').length,
            unverifiedVisibility: walletTokenResponse.filter((token) => token.visibility === 'unverified').length,
            hidden: walletTokenResponse.filter((token) => token.visibility === 'hidden').length,
            established: walletTokenResponse.filter((token) => token.recognitionStatus === 'established').length,
            recognized: walletTokenResponse.filter((token) => token.recognitionStatus === 'recognized').length,
            unverified: walletTokenResponse.filter((token) => token.recognitionStatus === 'unverified').length,
            high: walletTokenResponse.filter((token) => token.securityStatus === 'high').length,
            blocked: walletTokenResponse.filter((token) => token.securityStatus === 'blocked').length,
        })
    }, [walletTokenResponse])

    const catalogTokens = useMemo(() => normalizeValidTokens(
        marketTokens,
        discoveryChainId,
        fallbackChainLogo,
    ), [discoveryChainId, fallbackChainLogo, marketTokens])
    const catalogCommonTokens = useMemo(() => normalizeValidTokens(
        commonMarketTokens,
        discoveryChainId,
        fallbackChainLogo,
    ), [commonMarketTokens, discoveryChainId, fallbackChainLogo])
    const catalogFallbackTokens = useMemo(() => normalizeValidTokens(
        fallbackMarketTokens,
        discoveryChainId,
        fallbackChainLogo,
    ), [fallbackMarketTokens, discoveryChainId, fallbackChainLogo])
    const availableTokens = useMemo(() => {
        const merged = mergeWalletBalances(catalogTokens, walletTokens)
        if (!normalizedTokenSearch) return merged
        return merged.filter((token) => tokenMatchesSearch(token, normalizedTokenSearch))
    }, [catalogTokens, normalizedTokenSearch, walletTokens])
    const availableById = useMemo(() => new Map(availableTokens.map((token) => [
        getTokenIdentity(token, discoveryChainId), token,
    ])), [availableTokens, discoveryChainId])
    const selectorMarketTokens = useMemo(() => {
        const selected = catalogTokens.map((token) =>
            availableById.get(getTokenIdentity(token, discoveryChainId)) ?? token)
        const initialNativeToken = tokensConfig.initialSellToken?.isNative === true
            ? normalizeMarketToken({
                ...tokensConfig.initialSellToken,
                source: tokensConfig.initialSellToken.source ?? 'catalog-supplement',
            }, swapChainId, getCuratedEvmChainLogoUri(swapChainId))
            : null
        if (
            initialNativeToken &&
            (discoveryChainId === 'all' || Number(discoveryChainId) === Number(initialNativeToken.chainId)) &&
            !selected.some((token) => getTokenIdentity(token, discoveryChainId) === getTokenIdentity(initialNativeToken, discoveryChainId))
        ) {
            selected.unshift(initialNativeToken)
        }
        return selected
    }, [availableById, catalogTokens, discoveryChainId, swapChainId, tokensConfig.initialSellToken])
    const selectorWalletTokens = useMemo(() => {
        const selected = walletTokens.map((token) =>
            availableById.get(getTokenIdentity(token, discoveryChainId)) ?? token)
        if (
            (discoveryChainId === 'all' ||
                Number(discoveryChainId) === Number(swapChainId)) &&
            nativeBalance.value !== null &&
            !selected.some((token) =>
                token?.isNative === true && Number(token?.chainId) === Number(swapChainId))
        ) {
            const nativeBalanceText = nativeBalance.formatted
            const nativeCatalogToken = availableById.get(getTokenIdentity({
                chainId: swapChainId,
                address: zeroAddress,
            }, discoveryChainId))
            selected.unshift({
                ...(nativeCatalogToken ?? {}),
                classificationVersion: WALLET_TOKEN_CLASSIFICATION_VERSION,
                chainId: swapChainId,
                address: zeroAddress,
                symbol: activeChain?.nativeCurrency.symbol ?? nativeCatalogToken?.symbol ?? 'NATIVE',
                name: activeChain?.nativeCurrency.name ?? nativeCatalogToken?.name ?? 'Native token',
                decimals: activeChain?.nativeCurrency.decimals ?? nativeCatalogToken?.decimals ?? 18,
                isNative: true,
                recognitionStatus: 'established',
                recognitionReasons: ['native-token'],
                verificationStatus: 'established',
                spamStatus: 'clean',
                possibleSpam: false,
                verifiedContract: null,
                spamReasons: ['native-token'],
                securityStatus: 'trusted',
                securityReasons: ['native-token'],
                visibility: 'primary',
                visibilityReasons: ['native-token'],
                classificationTier: 'core',
                classificationReasons: ['native-token'],
                includeInPortfolioValue: true,
                balance: nativeBalanceText,
                formattedBalance: nativeBalanceText,
                rawBalance: nativeBalance.value.toString(),
            })
        }
        return selected
    }, [activeChain, availableById, discoveryChainId, nativeBalance.formatted, nativeBalance.value, swapChainId, walletTokens])

    const refreshWalletBalances = useCallback(async () => {
        await Promise.all([refetchWalletTokens(), nativeBalance.refetch()])
    }, [nativeBalance, refetchWalletTokens])

    function openTokenSelector(side, currentToken, mode = 'picker') {
        // Opening the picker is an explicit request for current holdings.
        // Refresh every wallet chain and the separately queried source native balance.
        if (walletState.isConnected) void refreshWalletBalances().catch(() => undefined)
        setTokenSearch('')
        setTokenSelectorMode(mode)
        setSelectorChainId(
            mode === 'global-search'
                ? 'all'
                : Number(currentToken?.chainId ?? swapChainId),
        )
        setTokenSelectorSide(side)
    }

    function closeTokenSelector() {
        setTokenSearch('')
        setTokenSelectorSide(null)
        setTokenSelectorMode('picker')
    }

    return {
        activeChain,
        fallbackChainLogo,
        nativeBalance,
        walletTokens,
        // Excludes the locally synthesized native fallback, so a failed backend
        // response is never mistaken for usable wallet data.
        backendWalletTokens: normalizedWalletTokens,
        availableTokens,
        walletTokenError,
        walletTokenFailedChainIds,
        walletTokenStale,
        refetchWalletTokens,
        refreshWalletBalances,
        selector: {
            side: tokenSelectorSide,
            mode: tokenSelectorMode,
            chainId: selectorChainId,
            discoveryChainId,
            search: tokenSearch,
            marketTokens: selectorMarketTokens,
            commonTokens: catalogCommonTokens,
            fallbackTokens: catalogFallbackTokens,
            walletTokens: selectorWalletTokens,
            loading: marketTokensLoading,
            error: marketTokensError,
            notice: marketTokensNotice,
            diagnostics: {
                scope: discoveryChainId,
                apiRankedCount: marketTokens.length,
                tokenCatalogCount: tokenCatalog.tokens.length,
                tokenCatalogLoadedCount: tokenCatalog.loadedCount,
                tokenCatalogTotalCount: tokenCatalog.totalCount,
                tokenCatalogHasMore: tokenCatalog.hasMore,
                apiCommonCount: commonMarketTokens.length,
                apiFallbackCount: fallbackMarketTokens.length,
                partial: marketTokensPartial === true,
                stale: marketTokensStale === true,
                schemaVersion: marketTokensSchemaVersion,
            },
            setSearch: setTokenSearch,
            setChainId: setSelectorChainId,
            open: openTokenSelector,
            close: closeTokenSelector,
        },
    }
}
