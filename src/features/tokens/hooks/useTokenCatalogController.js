import { useCallback, useEffect, useMemo, useState } from 'react'
import { zeroAddress } from 'viem'
import { useMarketTokens } from './useMarketTokens.js'
import { useWalletTokens } from './useWalletTokens.js'
import { useNativeBalance } from './useNativeBalance.js'
import { mergeWalletBalances, WALLET_TOKEN_CLASSIFICATION_VERSION } from '../../tokens/services/walletTokens.js'
import { isNativeEvmToken } from '../../../services/balances.js'
import { getCuratedEvmChain, getCuratedEvmChainLogoUri } from '../../../web3/curatedEvmChains.js'
import { getTokenIdentity, normalizeMarketToken } from '../model/tokenNormalization.js'

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

    const preloadedMarketCatalog = useMarketTokens({ chainId: 'all' })
    const preloadedHasSelectedRankedTokens = discoveryChainId === 'all' ||
        preloadedMarketCatalog.tokens.some((token) => Number(token.chainId) === Number(discoveryChainId))
    const shouldFetchSelectedCatalog = Boolean(tokenSearch.trim()) ||
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
    }), [discoveryChainId, preloadedMarketCatalog])
    const activeMarketCatalog = shouldFetchSelectedCatalog ? selectedMarketCatalog : filteredPreloadedMarketCatalog
    const {
        tokens: marketTokens,
        commonTokens: commonMarketTokens = [],
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
    const availableTokens = useMemo(() => {
        const merged = mergeWalletBalances(catalogTokens, walletTokens)
        if (!tokenSearch.trim()) return merged
        const searchIds = new Set(catalogTokens.map((token) => getTokenIdentity(token, discoveryChainId)))
        return merged.filter((token) => searchIds.has(getTokenIdentity(token, discoveryChainId)))
    }, [catalogTokens, discoveryChainId, tokenSearch, walletTokens])
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
            walletTokens: selectorWalletTokens,
            loading: marketTokensLoading,
            error: marketTokensError,
            notice: marketTokensNotice,
            diagnostics: {
                scope: discoveryChainId,
                apiRankedCount: marketTokens.length,
                apiCommonCount: commonMarketTokens.length,
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
