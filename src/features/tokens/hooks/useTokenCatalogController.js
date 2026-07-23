import { useCallback, useEffect, useMemo, useState } from 'react'
import { zeroAddress } from 'viem'
import { useMarketTokens } from './useMarketTokens.js'
import { useWalletTokens } from './useWalletTokens.js'
import { useNativeBalance } from './useNativeBalance.js'
import { mergeWalletBalances, WALLET_TOKEN_CLASSIFICATION_VERSION } from '../../tokens/services/walletTokens.js'
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
    const discoveryChainId = tokenSelectorSide ? selectorChainId : swapChainId
    const walletAddress = walletState.address
    const normalizedTokenSearch = tokenSearch.trim().toLowerCase()

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
    } = activeMarketCatalog

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

    const normalizedWalletTokens = useMemo(() => walletTokenResponse.map((token) =>
        normalizeMarketToken(token, discoveryChainId, fallbackChainLogo)), [
        discoveryChainId,
        fallbackChainLogo,
        walletTokenResponse,
    ])
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
        return updated
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

    const catalogTokens = useMemo(() => marketTokens.map((token) =>
        normalizeMarketToken(token, discoveryChainId, fallbackChainLogo)), [discoveryChainId, fallbackChainLogo, marketTokens])
    const catalogCommonTokens = useMemo(() => commonMarketTokens.map((token) =>
        normalizeMarketToken(token, discoveryChainId, fallbackChainLogo)), [commonMarketTokens, discoveryChainId, fallbackChainLogo])
    const catalogFallbackTokens = useMemo(() => fallbackMarketTokens.map((token) =>
        normalizeMarketToken(token, discoveryChainId, fallbackChainLogo)), [fallbackMarketTokens, discoveryChainId, fallbackChainLogo])
    const availableTokens = useMemo(() => {
        const merged = mergeWalletBalances(catalogTokens, walletTokens)
        if (!normalizedTokenSearch) return merged
        return merged.filter((token) => tokenMatchesSearch(token, normalizedTokenSearch))
    }, [catalogTokens, normalizedTokenSearch, walletTokens])
    const availableById = useMemo(() => new Map(availableTokens.map((token) => [
        getTokenIdentity(token, discoveryChainId), token,
    ])), [availableTokens, discoveryChainId])
    const selectorMarketTokens = useMemo(() => catalogTokens.map((token) =>
        availableById.get(getTokenIdentity(token, discoveryChainId)) ?? token), [availableById, catalogTokens, discoveryChainId])
    const selectorWalletTokens = useMemo(() => walletTokens.map((token) =>
        availableById.get(getTokenIdentity(token, discoveryChainId)) ?? token), [availableById, discoveryChainId, walletTokens])

    const refreshWalletBalances = useCallback(async () => {
        await Promise.all([refetchWalletTokens(), nativeBalance.refetch()])
    }, [nativeBalance, refetchWalletTokens])

    function openTokenSelector(side, currentToken) {
        setTokenSearch('')
        setSelectorChainId(Number(currentToken?.chainId ?? swapChainId))
        setTokenSelectorSide(side)
    }

    function closeTokenSelector() {
        setTokenSearch('')
        setTokenSelectorSide(null)
    }

    return {
        activeChain,
        fallbackChainLogo,
        nativeBalance,
        walletTokens,
        availableTokens,
        walletTokenError,
        walletTokenFailedChainIds,
        walletTokenStale,
        refetchWalletTokens,
        refreshWalletBalances,
        selector: {
            side: tokenSelectorSide,
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
