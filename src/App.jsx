import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react'

import {
    useAppKit,
    useAppKitNetwork,
} from '@reown/appkit/react'
import {
    useSendTransaction,
    useWalletClient,
    useWaitForTransactionReceipt,
} from 'wagmi'
import { formatUnits, parseEther, zeroAddress } from 'viem'

import {
    AnimatePresence,
    LayoutGroup,
    motion,
    useReducedMotion,
} from 'motion/react'

import TokenIcon from './components/TokenIcon.jsx'
import TokenSelector from './components/TokenSelector.jsx'
import SwapSettingsPopover from './components/settings/SwapSettingsPopover.jsx'
import GasAssistApprovalDialog from './components/gas-assist/GasAssistApprovalDialog.jsx'
import GasAssistBanner from './components/gas-assist/GasAssistBanner.jsx'
import GasAssistPrepaymentDialog from './components/gas-assist/GasAssistPrepaymentDialog.jsx'
import CrossChainRoutePanel from './components/cross-chain/CrossChainRoutePanel.jsx'
import PasskeyVaultTestPanel from './components/pistachio/PasskeyVaultTestPanel.jsx'
import PistachioWalletController, {
    PistachioWalletButton,
} from './components/pistachio/PistachioWalletController.jsx'
import WalletConnectionButton from './components/WalletConnectionButton.jsx'

import {
    createCssVariables,
    swapUiConfig,
} from './swapConfig.js'

import {
    useMarketTokens,
} from './hooks/useMarketTokens.js'

import {
    useWalletTokens,
} from './hooks/useWalletTokens.js'
import { useNativeBalance } from './hooks/useNativeBnbBalance.js'
import { useGasAssistConfig } from './hooks/useGasAssistConfig.js'
import { useSwapSettings } from './hooks/useSwapSettings.js'
import { useGasAssistApproval } from './hooks/useGasAssistApproval.js'
import { useZeroXGaslessSwap } from './hooks/useZeroXGaslessSwap.js'
import { usePrepaidSponsorship } from './hooks/usePrepaidSponsorship.js'
import {
    deriveSwapExecution,
    getSwapExecutionMessage,
    NORMAL_SWAP_MODE,
    ZERO_X_GASLESS_MODE,
} from './services/swapExecutionMode.js'

import {
    mergeWalletBalances,
    resolveSelectedToken,
    WALLET_TOKEN_CLASSIFICATION_VERSION,
} from './services/walletTokens.js'
import { formatUsdAmount } from './services/fiatValue.js'
import {
    DEFAULT_NATIVE_GAS_RESERVE_WEI,
    getSpendableTokenAmount,
    isNativeEvmToken,
    multiplyAmountByPercent,
} from './services/balances.js'
import {
    getEffectiveSlippageBps,
} from './services/swapSettings.js'
import {
    getSwapActionState,
} from './services/swapAction.js'
import {
    createQuoteRequestBody,
    fetchSwapQuote,
    isCurrentQuoteResponse,
} from './services/quotes.js'
import {
    getExecutableTransaction,
    isQuoteExpired,
    isUserRejectedError,
} from './services/swapTransaction.js'
import { useWalletState } from './web3/useWalletState.js'
import {
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from './web3/curatedEvmChains.js'

function ChevronDownIcon({ className = '' }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            aria-hidden="true"
        >
            <path
                d="m5 9 7 7 7-7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
            />
        </svg>
    )
}

function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
                cx="10.5"
                cy="10.5"
                r="6.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            />

            <path
                d="m16 16 4.3 4.3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
            />
        </svg>
    )
}

function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58-1.92-3.32-2.39.96a7.2 7.2 0 0 0-1.62-.94L14.88 3h-3.84l-.36 3.18a7.2 7.2 0 0 0-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58a7.7 7.7 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58 1.92 3.32 2.39-.96c.5.39 1.04.7 1.62.94l.36 3.18h3.84l.36-3.18a7.2 7.2 0 0 0 1.62-.94l2.39.96 1.92-3.32-2.03-1.58ZM12.96 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
            />
        </svg>
    )
}

function ArrowDownIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 4v14m0 0-6-6m6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
            />
        </svg>
    )
}

function getTokenIdentity(token, fallbackChainId = 0) {
    if (!token) {
        return 'empty'
    }

    const chainId = Number(
        token.chainId ?? fallbackChainId,
    )

    const address = String(
        token.address ?? '',
    )
        .trim()
        .toLowerCase()

    return (
        `${chainId}:` +
        `${address || token.id || token.symbol}`
    )
}

function normalizeMarketToken(
    token,
    fallbackChainId,
    fallbackChainLogo,
) {
    const chainId = Number(
        token.chainId ?? fallbackChainId,
    )

    const address = String(
        token.address ?? '',
    ).trim()
    const logoCandidates = [
        ...(Array.isArray(token.logoCandidates)
            ? token.logoCandidates
            : []),
        token.logoURI,
        token.iconUrl,
    ].filter(
        (value, index, values) =>
            typeof value === 'string' &&
            value.length > 0 &&
            values.indexOf(value) === index,
    )

    return {
        ...token,

        id: getTokenIdentity(
            {
                ...token,
                chainId,
                address,
            },
            fallbackChainId,
        ),

        chainId,
        address,

        name:
            token.name ??
            token.symbol ??
            'Unknown token',

        symbol:
            token.symbol ??
            'UNKNOWN',

        decimals: Number(
            token.decimals ?? 18,
        ),

        iconUrl:
            logoCandidates[0] ?? null,

        logoURI:
            logoCandidates[0] ?? null,

        logoCandidates,

        logoSource:
            token.logoSource ??
            (logoCandidates.length > 0
                ? 'local'
                : 'fallback'),

        chainLogoURI:
            token.chainLogoURI ??
            token.networkLogoURI ??
            fallbackChainLogo ??
            null,

        balance:
            token.balance == null
                ? null
                : String(token.balance),

        priceUSD:
            token.priceUSD ?? null,
    }
}

function getTrustedTokenPrice(token) {
    if (!token) return null
    if (['market', 'untrusted'].includes(token.priceConfidence)) return null
    return token.trustedPriceUSD ?? token.priceUSD ?? null
}

function TokenButton({
                         token,
                         onClick,
                     }) {
    const reducedMotion =
        useReducedMotion()

    const {
        copy,
        motion: motionConfig,
    } = swapUiConfig

    if (!token) {
        return (
            <motion.button
                type="button"
                onClick={onClick}
                className="token-button select-token-button"
                whileTap={
                    reducedMotion
                        ? undefined
                        : {
                            scale:
                            motionConfig.tokenButton
                                .pressedScale,
                        }
                }
            >
                <span>{copy.selectToken}</span>

                <ChevronDownIcon className="token-chevron" />
            </motion.button>
        )
    }

    return (
        <motion.button
            type="button"
            onClick={onClick}
            className="token-button selected-token-button"
            whileTap={
                reducedMotion
                    ? undefined
                    : {
                        scale:
                        motionConfig.tokenButton
                            .pressedScale,
                    }
            }
        >
            <TokenIcon
                token={token}
                size="button"
            />

            <span>{token.symbol}</span>

            <ChevronDownIcon className="token-chevron" />
        </motion.button>
    )
}

function AnimatedTokenButton({
                                 token,
                                 chainId,
                                 onClick,
                             }) {
    const {
        motion: motionConfig,
    } = swapUiConfig

    const identity =
        getTokenIdentity(token, chainId)

    return (
        <motion.div
            layoutId={`token-${identity}`}
            transition={{
                layout:
                motionConfig.sharedLayout,
            }}
        >
            <TokenButton
                token={token}
                onClick={onClick}
            />
        </motion.div>
    )
}

function decimalToUnits(
    value,
    decimals,
) {
    const normalized =
        String(value).trim()

    if (
        !/^\d+(?:\.\d+)?$/.test(
            normalized,
        )
    ) {
        return null
    }

    const [
        wholePart,
        fractionPart = '',
    ] = normalized.split('.')

    if (
        fractionPart.length > decimals
    ) {
        return null
    }

    const fraction =
        fractionPart.padEnd(
            decimals,
            '0',
        )

    return `${wholePart}${fraction}`
        .replace(/^0+(?=\d)/, '')
        .replace(/^$/, '0')
}

function unitsToDecimal(value, decimals) {
    const normalized = String(value ?? '')

    if (!/^\d+$/.test(normalized)) {
        return null
    }

    const padded = normalized.padStart(decimals + 1, '0')
    const whole = decimals > 0
        ? padded.slice(0, -decimals)
        : padded
    const fraction = decimals > 0
        ? padded.slice(-decimals).replace(/0+$/, '')
        : ''

    return fraction ? `${whole}.${fraction}` : whole
}

function normalizeQuoteAmount(
    response,
    decimals,
) {
    const possibleAmounts = [
        response?.selectedQuote?.buyAmount,
        response?.buyAmount,
        response?.toAmount,
        response?.amountOut,
        response?.quote?.buyAmount,
        response?.quote?.toAmount,
        response?.data?.buyAmount,
        response?.data?.toAmount,
    ]

    const amount =
        possibleAmounts.find(
            (value) =>
                value !== undefined &&
                value !== null,
        )

    return amount === undefined
        ? null
        : unitsToDecimal(amount, decimals)
}

function QuickAmountControls({
                                 visible,
                                 token,
                                 spendableAmount,
                                 onSelect,
                             }) {
    const reducedMotion =
        useReducedMotion()

    const {
        motion: motionConfig,
        quickAmounts,
    } = swapUiConfig

    const animation =
        motionConfig.quickAmounts

    const containerVariants = {
        hidden: {
            opacity: 0,

            x: reducedMotion
                ? 0
                : animation.offsetX,

            filter: reducedMotion
                ? 'blur(0px)'
                : `blur(${animation.blur}px)`,
        },

        visible: {
            opacity: 1,
            x: 0,
            filter: 'blur(0px)',

            transition: reducedMotion
                ? {
                    duration: 0,
                }
                : {
                    duration:
                    animation.duration,

                    ease:
                    animation.ease,

                    staggerChildren:
                    animation.stagger,
                },
        },

        exit: {
            opacity: 0,

            x: reducedMotion
                ? 0
                : animation.offsetX,

            filter: reducedMotion
                ? 'blur(0px)'
                : `blur(${animation.blur}px)`,

            transition: reducedMotion
                ? {
                    duration: 0,
                }
                : {
                    duration:
                        animation.duration *
                        0.75,

                    ease:
                    animation.ease,
                },
        },
    }

    const itemVariants = {
        hidden: {
            opacity: 0,

            x: reducedMotion
                ? 0
                : 6,
        },

        visible: {
            opacity: 1,
            x: 0,
        },

        exit: {
            opacity: 0,

            x: reducedMotion
                ? 0
                : 4,
        },
    }

    return (
        <AnimatePresence initial={false}>
            {visible && token && (
                <motion.div
                    key="quick-amount-controls"
                    className="quick-amount-controls"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                >
                    {quickAmounts.map(
                        (item) => (
                            <motion.button
                                key={item.label}
                                type="button"
                                className="quick-amount-button"
                                variants={itemVariants}
                                onClick={() => {
                                    onSelect(
                                        multiplyAmountByPercent(
                                            spendableAmount,
                                            Number(token.decimals ?? 18),
                                            item.percent,
                                        ),
                                    )
                                }}
                            >
                                {item.label}
                            </motion.button>
                        ),
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export default function App() {
    const {
        brand,
        chain,
        copy,
        crossChain,
        navigation,
        quote: quoteConfig,
        wallet: walletConfig,
        tabs,
        tokens,
        motion: motionConfig,
    } = swapUiConfig

    const cssVariables =
        useMemo(
            () => createCssVariables(),
            [],
        )

    const reducedMotion =
        useReducedMotion()

    const [swapChainId, setSwapChainId] = useState(
        Number(tokens.initialSellToken?.chainId ?? chain.id),
    )
    const { open: openAppKit } = useAppKit()
    const { switchNetwork } = useAppKitNetwork()
    const walletState = useWalletState(swapChainId)
    const [swapSettings, setSwapSettings] = useSwapSettings()
    const nativeBalance = useNativeBalance({
        address: walletState.address,
        chainId: swapChainId,
        enabled: walletState.isConnected,
    })
    const refetchNativeBalance = nativeBalance.refetch
    const {
        mutateAsync: sendTransaction,
    } = useSendTransaction()
    const { data: walletClient } = useWalletClient()

    const [tokenSearch, setTokenSearch] =
        useState('')
    const [selectorChainId, setSelectorChainId] =
        useState(swapChainId)
    const [tokenSelectorSide, setTokenSelectorSide] =
        useState(null)
    const discoveryChainId = tokenSelectorSide
        ? selectorChainId
        : swapChainId

    const walletAddress = walletState.address

    const {
        tokens: marketTokens,
        loading:
            marketTokensLoading,
        error:
            marketTokensError,
    } = useMarketTokens({
        chainId: discoveryChainId,
        search: tokenSearch,
    })

    const activeChain = getCuratedEvmChain(swapChainId)
    const activeChainName = swapChainId === Number(chain.id)
        ? chain.name
        : activeChain?.name
    const fallbackChainLogo = Number(tokens.initialSellToken?.chainId) === discoveryChainId
        ? tokens.initialSellToken?.chainLogoURI ?? null
        : null

    const {
        tokens: walletTokenResponse,
        error: walletTokenError,
        refetch: refetchWalletTokens,
    } = useWalletTokens({
        chainId: 'all',
        walletAddress,
        enabled: walletState.isConnected,
    })

    const normalizedWalletTokens =
        useMemo(() => {
            return walletTokenResponse.map(
                (token) =>
                    normalizeMarketToken(
                        token,
                        discoveryChainId,
                        fallbackChainLogo,
                    ),
            )
        }, [
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
                symbol: getCuratedEvmChain(swapChainId)?.nativeCurrency.symbol ?? 'NATIVE',
                name: getCuratedEvmChain(swapChainId)?.nativeCurrency.name ?? 'Native token',
                decimals: getCuratedEvmChain(swapChainId)?.nativeCurrency.decimals ?? 18,
                logoURI: Number(tokens.initialSellToken?.chainId) === swapChainId
                    ? tokens.initialSellToken?.logoURI
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
                    honeypot: {
                        available: false,
                        checkedAt: null,
                        risk: null,
                        riskLevel: null,
                        isHoneypot: null,
                    },
                    goPlus: {
                        available: false,
                        checkedAt: null,
                        isHoneypot: null,
                    },
                },
                visibility: 'primary',
                visibilityReasons: ['native-token'],
                trustedPriceUSD: Number(tokens.initialSellToken?.chainId) === swapChainId
                    ? tokens.initialSellToken?.priceUSD ?? null
                    : null,
                marketPriceUSD: null,
                priceConfidence:
                    Number(tokens.initialSellToken?.chainId) === swapChainId &&
                    tokens.initialSellToken?.priceUSD
                        ? 'trusted'
                        : 'unknown',
                balance: nativeBalanceText,
                formattedBalance: nativeBalanceText,
                rawBalance: nativeBalance.value.toString(),
            }, swapChainId, getCuratedEvmChainLogoUri(swapChainId)))
        }
        return updated
    }, [
        nativeBalance.formatted,
        nativeBalance.value,
        normalizedWalletTokens,
        swapChainId,
        tokens.initialSellToken,
    ])

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
    }, [
        walletTokenResponse,
    ])

    const catalogTokens =
        useMemo(() => {
            return marketTokens.map(
                (token) =>
                    normalizeMarketToken(
                        token,
                        discoveryChainId,
                        fallbackChainLogo,
                    ),
            )
        }, [discoveryChainId, fallbackChainLogo, marketTokens])

    const availableTokens =
        useMemo(() => {
            const merged = mergeWalletBalances(
                catalogTokens,
                walletTokens,
            )
            if (!tokenSearch.trim()) return merged
            const searchIds = new Set(
                catalogTokens.map((token) => getTokenIdentity(token, discoveryChainId)),
            )
            return merged.filter((token) =>
                searchIds.has(getTokenIdentity(token, discoveryChainId)),
            )
        }, [
            catalogTokens,
            discoveryChainId,
            tokenSearch,
            walletTokens,
        ])

    const selectorMarketTokens = useMemo(() => {
        const availableById = new Map(
            availableTokens.map((token) => [
                getTokenIdentity(token, discoveryChainId),
                token,
            ]),
        )
        return catalogTokens.map((token) =>
            availableById.get(getTokenIdentity(token, discoveryChainId)) ?? token,
        )
    }, [availableTokens, catalogTokens, discoveryChainId])

    const selectorWalletTokens = useMemo(() => {
        const availableById = new Map(
            availableTokens.map((token) => [
                getTokenIdentity(token, discoveryChainId),
                token,
            ]),
        )
        return walletTokens.map((token) =>
            availableById.get(getTokenIdentity(token, discoveryChainId)) ?? token,
        )
    }, [availableTokens, discoveryChainId, walletTokens])

    const initialSellToken =
        useMemo(() => {
            if (
                !tokens.initialSellToken
            ) {
                return null
            }

            return normalizeMarketToken(
                tokens.initialSellToken,
                swapChainId,
                fallbackChainLogo,
            )
        }, [
            fallbackChainLogo,
            swapChainId,
            tokens.initialSellToken,
        ])

    const initialBuyToken =
        useMemo(() => {
            if (
                !tokens.initialBuyToken
            ) {
                return null
            }

            return normalizeMarketToken(
                tokens.initialBuyToken,
                swapChainId,
                fallbackChainLogo,
            )
        }, [
            fallbackChainLogo,
            swapChainId,
            tokens.initialBuyToken,
        ])

    const [
        activeTab,
        setActiveTab,
    ] = useState(tabs[0])

    const [
        selectedSellToken,
        setSellToken,
    ] = useState(initialSellToken)

    const [
        selectedBuyToken,
        setBuyToken,
    ] = useState(initialBuyToken)

    const sellToken = useMemo(
        () => resolveSelectedToken(selectedSellToken, availableTokens),
        [availableTokens, selectedSellToken],
    )

    const buyToken = useMemo(
        () => resolveSelectedToken(selectedBuyToken, availableTokens),
        [availableTokens, selectedBuyToken],
    )

    const [
        sellAmount,
        setSellAmount,
    ] = useState('')

    const [
        buyAmount,
        setBuyAmount,
    ] = useState('0')

    const [
        showQuickAmounts,
        setShowQuickAmounts,
    ] = useState(false)

    const [
        switchRotation,
        setSwitchRotation,
    ] = useState(0)

    const [
        quote,
        setQuote,
    ] = useState(null)

    const [
        providerRecommendedSlippageBps,
        setProviderRecommendedSlippageBps,
    ] = useState(null)

    const [
        quoteStatus,
        setQuoteStatus,
    ] = useState('idle')

    const [
        quoteRefreshIndex,
        setQuoteRefreshIndex,
    ] = useState(0)

    const [
        transactionHash,
        setTransactionHash,
    ] = useState(null)

    const [
        transactionStatus,
        setTransactionStatus,
    ] = useState('idle')

    const [
        statusMessage,
        setStatusMessage,
    ] = useState(null)

    const transactionReceipt =
        useWaitForTransactionReceipt({
            hash: transactionHash ?? undefined,
            chainId: swapChainId,
            query: {
                enabled: Boolean(transactionHash),
            },
        })

    const recommendedSlippageBps = providerRecommendedSlippageBps
    const effectiveSlippageBps = getEffectiveSlippageBps(
        swapSettings,
        {
            recommendedSlippageBps,
            defaultSlippageBps: quoteConfig.defaultSlippageBps,
        },
    )

    const activeAmountIn = sellToken
        ? decimalToUnits(
            sellAmount,
            Number(sellToken.decimals ?? 18),
        )
        : null
    const sellChainId = Number(sellToken?.chainId ?? swapChainId)
    const buyChainId = Number(buyToken?.chainId ?? swapChainId)
    const hasMixedSwapChains = Boolean(
        sellToken &&
        buyToken &&
        sellChainId !== buyChainId,
    )
    const isBscSwap = swapChainId === 56

    const gasAssistConfig = useGasAssistConfig({
        quoteEndpoint: quoteConfig.endpoint,
        enabled: Boolean(
            isBscSwap &&
            walletState.isConnected &&
            walletAddress &&
            walletState.chainId === 56
        ),
    })

    const bscExecution = deriveSwapExecution({
        isConnected: walletState.isConnected,
        walletAddress,
        chainId: walletState.chainId,
        nativeBalanceStatus: nativeBalance.status,
        nativeBalance: nativeBalance.value,
        sellToken,
        buyToken,
        sellAmount: activeAmountIn,
        gasAssistConfig: gasAssistConfig.config,
        gasAssistConfigStatus: gasAssistConfig.status,
    })
    const nonBscExecution = nativeBalance.status === 'success'
        ? {
            mode: NORMAL_SWAP_MODE,
            reason: null,
        }
        : {
            mode: null,
            reason: nativeBalance.status === 'error'
                ? 'native-balance-error'
                : 'native-balance-loading',
        }
    const execution = isBscSwap
        ? bscExecution
        : nonBscExecution
    const executionMode = execution.mode

    const handleApprovalConfirmed = useCallback(async () => {
        await Promise.all([
            refetchWalletTokens(),
            refetchNativeBalance(),
        ])
        setStatusMessage('Approval confirmed. Review and submit the swap.')
    }, [refetchNativeBalance, refetchWalletTokens])

    const normalApproval = useGasAssistApproval({
        quoteEndpoint: quoteConfig.endpoint,
        quote: isBscSwap ? quote : null,
        walletAddress,
        sellToken,
        amountIn: activeAmountIn,
        enabled: false,
        onApprovalConfirmed: handleApprovalConfirmed,
    })

    const gasAssist = useZeroXGaslessSwap({
        quoteEndpoint: quoteConfig.endpoint,
        walletAddress,
        sellToken,
        buyToken,
        sellAmount: activeAmountIn,
        slippageBps: Math.max(30, effectiveSlippageBps),
        config: gasAssistConfig.config,
        quoteEnabled: executionMode === ZERO_X_GASLESS_MODE,
        refreshIndex: quoteRefreshIndex,
        onConfirmed: handleApprovalConfirmed,
    })

    const prepaidRequired =
        executionMode === ZERO_X_GASLESS_MODE &&
        gasAssist.quoteStatus === 'error' &&
        gasAssist.quoteError?.code === 'ONCHAIN_APPROVAL_REQUIRED'

    const prepaidSponsorship = usePrepaidSponsorship({
        quoteEndpoint: quoteConfig.endpoint,
        walletAddress,
        sellToken,
        buyToken,
        grossInputAmount: activeAmountIn,
        slippageBps: Math.max(30, effectiveSlippageBps),
        required: prepaidRequired,
        onConfirmed: handleApprovalConfirmed,
    })

    const activeQuote = executionMode === ZERO_X_GASLESS_MODE
        ? prepaidRequired && prepaidSponsorship.config?.enabled
            ? { prepaidSponsorshipRequired: true }
            : gasAssist.quote
        : quote
    const activeQuoteStatus = executionMode === ZERO_X_GASLESS_MODE
        ? prepaidRequired && prepaidSponsorship.config?.enabled
            ? 'success'
            : gasAssist.quoteStatus
        : quoteStatus

    useEffect(() => {
        setTransactionHash(null)
        setTransactionStatus('idle')
    }, [executionMode])

    useEffect(() => {
        if (executionMode !== ZERO_X_GASLESS_MODE || !gasAssist.quote?.buyAmount || !buyToken) return
        setBuyAmount(formatUnits(BigInt(gasAssist.quote.buyAmount), Number(buyToken.decimals ?? 18)))
    }, [buyToken, executionMode, gasAssist.quote])

    useEffect(() => {
        if (
            executionMode === ZERO_X_GASLESS_MODE &&
            gasAssist.quoteStatus === 'error' &&
            !(prepaidRequired && prepaidSponsorship.config?.enabled)
        ) {
            const code = gasAssist.quoteError?.code
            const message = gasAssist.quoteError?.message ?? 'Gas Assist could not provide a quote.'
            setStatusMessage(code ? `${code}: ${message}` : message)
        }
    }, [executionMode, gasAssist.quoteError, gasAssist.quoteStatus, prepaidRequired, prepaidSponsorship.config?.enabled])

    useEffect(() => {
        const amountInBaseUnits =
            sellToken
                ? decimalToUnits(
                    sellAmount,
                    Number(
                        sellToken.decimals ??
                        18,
                    ),
                )
                : null

        const sellIdentity =
            getTokenIdentity(
                sellToken,
                swapChainId,
            )

        const buyIdentity =
            getTokenIdentity(
                buyToken,
                swapChainId,
            )

        if (
            !quoteConfig.endpoint ||
            !walletState.isConnected ||
            !walletState.isCorrectNetwork ||
            !walletAddress ||
            !sellToken ||
            !buyToken ||
            hasMixedSwapChains ||
            !amountInBaseUnits ||
            amountInBaseUnits === '0' ||
            sellIdentity === buyIdentity ||
            executionMode !== NORMAL_SWAP_MODE
        ) {
            setQuote(null)
            setQuoteStatus('idle')
            setBuyAmount('0')

            return undefined
        }

        const controller =
            new AbortController()

        const timeoutId =
            window.setTimeout(
                async () => {
                    setQuote(null)
                    setQuoteStatus('loading')
                    setStatusMessage(null)

                    try {
                        const responseQuote =
                            await fetchSwapQuote({
                                endpoint:
                                quoteConfig.endpoint,

                                request:
                                    createQuoteRequestBody({
                                        chainId:
                                        swapChainId,

                                        sellToken:
                                        sellToken.address,

                                        buyToken:
                                        buyToken.address,

                                        sellAmount:
                                        amountInBaseUnits,

                                        sellTokenDecimals:
                                        Number(sellToken.decimals),

                                        buyTokenDecimals:
                                        Number(buyToken.decimals),

                                        takerAddress:
                                        walletAddress,

                                        slippageBps: effectiveSlippageBps,
                                    }),

                                signal:
                                controller.signal,
                            })

                        if (!isCurrentQuoteResponse(controller.signal)) {
                            return
                        }

                        const outputAmount =
                            normalizeQuoteAmount(
                                responseQuote,
                                Number(
                                    buyToken.decimals ??
                                    18,
                                ),
                            )

                        if (
                            outputAmount === null ||
                            Number(outputAmount) <=
                            0
                        ) {
                            throw new Error(
                                'Quote response did not contain a valid output amount',
                            )
                        }

                        setQuote(responseQuote)
                        const providerRecommendation = Number(
                            responseQuote?.recommendedSlippageBps ??
                            responseQuote?.selectedQuote?.recommendedSlippageBps ??
                            0,
                        )
                        if (providerRecommendation > 0) {
                            setProviderRecommendedSlippageBps(providerRecommendation)
                        }
                        setBuyAmount(
                            outputAmount,
                        )

                        setQuoteStatus(
                            'success',
                        )
                        setStatusMessage(null)
                    } catch (error) {
                        if (
                            error instanceof
                            DOMException &&
                            error.name ===
                            'AbortError'
                        ) {
                            return
                        }

                        setQuote(null)
                        setBuyAmount('0')
                        setQuoteStatus('error')
                        setStatusMessage(
                            import.meta.env.DEV && error instanceof Error
                                ? error.message
                                : 'No route is currently available.',
                        )
                    }
                },
                quoteConfig.debounceMs,
            )

        return () => {
            window.clearTimeout(
                timeoutId,
            )

            controller.abort()
        }
    }, [
        buyToken,
        effectiveSlippageBps,
        executionMode,
        hasMixedSwapChains,
        quoteConfig.debounceMs,
        quoteConfig.endpoint,
        quoteRefreshIndex,
        sellAmount,
        sellToken,
        swapChainId,
        walletAddress,
        walletState.isConnected,
        walletState.isCorrectNetwork,
    ])

    useEffect(() => {
        setTransactionHash(null)
        setTransactionStatus('idle')
        setStatusMessage(null)
    }, [walletAddress, walletState.chainId])

    useEffect(() => {
        if (!transactionHash) {
            return
        }

        if (
            transactionReceipt.isSuccess &&
            transactionStatus === 'submitted'
        ) {
            setTransactionStatus('confirmed')
            setStatusMessage('Swap confirmed.')
            setSellAmount('')
            setQuote(null)
            setQuoteStatus('idle')
            setBuyAmount('0')
            refetchWalletTokens()
        }

        if (
            transactionReceipt.isError &&
            transactionStatus === 'submitted'
        ) {
            setTransactionStatus('failed')
            setStatusMessage(
                'The transaction failed before confirmation.',
            )
        }
    }, [
        refetchWalletTokens,
        transactionHash,
        transactionReceipt.isError,
        transactionReceipt.isSuccess,
        transactionStatus,
    ])

    function resetQuote() {
        setQuote(null)
        setQuoteStatus('idle')
        setBuyAmount('0')
    }

    function handleSettingsChange(nextSettings) {
        resetQuote()
        setSwapSettings(nextSettings)
    }

    function openTokenSelector(side) {
        setTokenSearch('')
        setSelectorChainId(Number(
            (side === 'sell' ? sellToken : buyToken)?.chainId ??
            swapChainId,
        ))
        setTokenSelectorSide(side)
    }

    function closeTokenSelector() {
        setTokenSearch('')
        setTokenSelectorSide(null)
    }

    function handleSellAmountChange(
        event,
    ) {
        const nextValue =
            event.target.value

        if (
            /^\d*(?:\.\d*)?$/.test(
                nextValue,
            )
        ) {
            setSellAmount(nextValue)
        }
    }

    function handleSwitchTokens() {
        setSwitchRotation(
            (rotation) =>
                rotation + 180,
        )

        const previousSellToken =
            sellToken

        const previousBuyToken =
            buyToken

        const previousSellAmount =
            sellAmount

        const previousBuyAmount =
            buyAmount

        setSellToken(
            previousBuyToken,
        )

        setBuyToken(
            previousSellToken,
        )
        if (previousBuyToken?.chainId) {
            setSwapChainId(Number(previousBuyToken.chainId))
        }

        setSellAmount(
            previousBuyAmount === '0'
                ? ''
                : previousBuyAmount,
        )

        setBuyAmount(
            previousSellAmount || '0',
        )

        resetQuote()
    }

    function handleTokenSelect(
        token,
    ) {
        const normalizedToken =
            normalizeMarketToken(
                token,
                selectorChainId,
                fallbackChainLogo,
            )

        const selectedIdentity =
            getTokenIdentity(
                normalizedToken,
                selectorChainId,
            )

        const sellIdentity =
            getTokenIdentity(
                sellToken,
                swapChainId,
            )

        const buyIdentity =
            getTokenIdentity(
                buyToken,
                swapChainId,
            )

        if (
            tokenSelectorSide ===
            'sell'
        ) {
            if (
                selectedIdentity ===
                buyIdentity
            ) {
                setBuyToken(sellToken)
            }

            setSellToken(
                normalizedToken,
            )
            setSwapChainId(Number(normalizedToken.chainId))
        }

        if (
            tokenSelectorSide ===
            'buy'
        ) {
            if (
                selectedIdentity ===
                sellIdentity
            ) {
                setSellToken(buyToken)
            }

            setBuyToken(
                normalizedToken,
            )
            if (!sellToken) {
                setSwapChainId(Number(normalizedToken.chainId))
            }
        }

        closeTokenSelector()
        resetQuote()
    }

    const baseSwapAction = getSwapActionState({
        isConnected: walletState.isConnected,
        isCorrectNetwork: walletState.isCorrectNetwork,
        hasSellToken: Boolean(sellToken),
        hasBuyToken: Boolean(buyToken),
        hasAmount:
            Boolean(sellAmount) &&
            Number(sellAmount) > 0,
        quoteStatus: activeQuoteStatus,
        quoteReady: activeQuoteStatus === 'success' && activeQuote !== null,
        transactionStatus,
    })
    if (baseSwapAction.type === 'switch-network') {
        baseSwapAction.label = `Switch to ${activeChainName ?? 'token network'}`
    }
    const swapAction = hasMixedSwapChains
        ? {
            type: 'bridge',
            label: 'Use Bridge for cross-chain swaps',
            enabled: true,
        }
        : prepaidRequired &&
        prepaidSponsorship.config?.enabled &&
        baseSwapAction.type === 'swap'
            ? { ...baseSwapAction, label: 'Review Gas Assist prepayment' }
            : baseSwapAction

    async function handlePrimaryAction() {
        setStatusMessage(null)

        if (swapAction.type === 'connect') {
            try {
                await openAppKit({ view: 'Connect' })
            } catch {
                setStatusMessage(
                    'Wallet connection is unavailable. Check the Reown origin settings.',
                )
            }
            return
        }

        if (swapAction.type === 'bridge') {
            setActiveTab('Bridge')
            return
        }

        if (swapAction.type === 'switch-network') {
            try {
                if (!activeChain) {
                    throw new Error('This token network is not enabled.')
                }
                await switchNetwork(activeChain)
            } catch (error) {
                setStatusMessage(
                    isUserRejectedError(error)
                        ? 'Network switch cancelled.'
                        : `Unable to switch to ${activeChainName ?? 'the token network'}.`,
                )
            }
            return
        }

        if (
            swapAction.type !== 'swap' ||
            transactionStatus === 'pending' ||
            transactionStatus === 'submitted'
        ) {
            return
        }
        if (
            hasMixedSwapChains ||
            sellChainId !== swapChainId ||
            buyChainId !== swapChainId
        ) {
            setStatusMessage('Same-chain Swap requires both tokens on one network. Use Bridge instead.')
            return
        }

        if (executionMode === ZERO_X_GASLESS_MODE) {
            if (prepaidRequired && prepaidSponsorship.config?.enabled) {
                prepaidSponsorship.start()
                return
            }
            if (!gasAssist.quote || Date.parse(gasAssist.quote.expiresAt) <= Date.now()) {
                setStatusMessage('The Gas Assist quote expired. Refreshing the price.')
                setQuoteRefreshIndex((value) => value + 1)
                return
            }
            gasAssist.open()
            return
        }

        if (isQuoteExpired(quote)) {
            setQuote(null)
            setQuoteStatus('loading')
            setStatusMessage(
                'The quote expired. Refreshing the price.',
            )
            setQuoteRefreshIndex((value) => value + 1)
            return
        }

        try {
            const approvalReady = await normalApproval.prepareApproval()
            if (!approvalReady) return

            const transaction =
                getExecutableTransaction(quote)

            setTransactionHash(null)
            setTransactionStatus('pending')
            setStatusMessage(
                'Confirm the transaction in your wallet.',
            )

            const hash = await sendTransaction({
                ...transaction,
                chainId: swapChainId,
            })

            setTransactionHash(hash)
            setTransactionStatus('submitted')
            setStatusMessage(
                'Transaction submitted. Waiting for confirmation.',
            )
        } catch (error) {
            if (isUserRejectedError(error)) {
                setTransactionStatus('rejected')
                setStatusMessage('Transaction rejected.')
                return
            }

            setTransactionStatus('failed')
            setStatusMessage(
                error instanceof Error
                    ? error.message
                    : 'The wallet could not submit the transaction.',
            )
        }
    }

    async function handleCrossChainStep(step) {
        const stepChain = getCuratedEvmChain(step.chainId)
        if (!stepChain) throw new Error('This route step uses an unsupported network.')
        if (Number(walletState.chainId) !== step.chainId) {
            await switchNetwork(stepChain)
        }
        const transaction = step.transaction
        if (!transaction?.to) throw new Error('Route step is missing a transaction target.')
        return sendTransaction({
            chainId: step.chainId,
            to: transaction.to,
            data: transaction.data ?? undefined,
            value: transaction.value == null
                ? undefined
                : BigInt(transaction.value),
        })
    }

    async function handleCrossChainAuthentication(message) {
        if (!walletClient || !walletAddress) {
            throw new Error('Connect a wallet that supports message signing.')
        }
        return walletClient.signMessage({
            account: walletAddress,
            message,
        })
    }

    const sellTokenIdentity =
        getTokenIdentity(
            sellToken,
            swapChainId,
        )

    const buyTokenIdentity =
        getTokenIdentity(
            buyToken,
            swapChainId,
        )

    const sellFiatValue = formatUsdAmount(
        sellAmount || '0',
        getTrustedTokenPrice(sellToken),
    )
    const buyFiatValue = formatUsdAmount(
        buyAmount,
        getTrustedTokenPrice(buyToken),
    )
    const nativeToken = walletTokens.find((token) =>
        isNativeEvmToken(token) &&
        Number(token.chainId) === swapChainId,
    ) ?? null
    const nativeSymbol = activeChain?.nativeCurrency.symbol ?? 'native token'
    const explorerUrl = activeChain?.blockExplorers?.default?.url ??
        walletConfig.explorerUrl
    const executionMessage = getSwapExecutionMessage(execution.reason)
    const estimatedSwapFeeWei = (() => {
        try {
            const transaction = quote?.selectedQuote?.transaction
            if (transaction?.gas == null || transaction?.gasPrice == null) return null
            return BigInt(transaction.gas) * BigInt(transaction.gasPrice)
        } catch {
            return null
        }
    })()
    const fallbackNativeReserveWei = (() => {
        try {
            return parseEther(walletConfig.nativeGasReserve)
        } catch {
            return DEFAULT_NATIVE_GAS_RESERVE_WEI
        }
    })()
    const spendableSellAmount = sellToken
        ? getSpendableTokenAmount({
            token: sellToken,
            nativeBalanceWei: nativeBalance.value ?? 0n,
            estimatedFeeWei: estimatedSwapFeeWei,
            fallbackReserveWei: fallbackNativeReserveWei,
        })
        : '0'

    return (
        <main
            className="app-shell"
            style={cssVariables}
        >
            <header className="app-header">
                <div className="header-left">
                    <button
                        type="button"
                        className="brand-button"
                        aria-label={brand.name}
                    >
                        <img
                            src={brand.logo}
                            alt=""
                            className="brand-logo"
                            draggable="false"
                        />

                        <ChevronDownIcon className="brand-chevron" />
                    </button>

                    <nav className="header-navigation">
                        {navigation.map(
                            (item) => (
                                <button
                                    key={item.label}
                                    type="button"
                                    className={
                                        item.active
                                            ? 'header-navigation-item active'
                                            : 'header-navigation-item'
                                    }
                                >
                                    {item.label}
                                </button>
                            ),
                        )}
                    </nav>
                </div>

                <div className="header-right">
                    <button
                        type="button"
                        className="header-icon-button"
                        aria-label={
                            copy.searchLabel
                        }
                    >
                        <SearchIcon />
                    </button>

                    <PistachioWalletButton />
                    <WalletConnectionButton
                        walletState={walletState}
                        nativeBalance={nativeBalance}
                        nativeToken={nativeToken}
                        walletTokens={walletTokens}
                        settings={swapSettings}
                        selectedTokens={[sellToken, buyToken]}
                        explorerUrl={explorerUrl}
                        onRefetch={async () => {
                            await Promise.all([
                                nativeBalance.refetch(),
                                refetchWalletTokens(),
                            ])
                        }}
                    />
                </div>
            </header>

            <PasskeyVaultTestPanel />

            <section className="swap-root">
                <div className="swap-toolbar">
                    <nav className="swap-tabs">
                        {[...tabs, 'Bridge'].map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() =>
                                    setActiveTab(tab)
                                }
                                className={
                                    activeTab === tab
                                        ? 'swap-tab active'
                                        : 'swap-tab'
                                }
                            >
                                {tab}
                            </button>
                        ))}
                    </nav>

                    {activeTab !== 'Bridge' && <SwapSettingsPopover
                        settings={swapSettings}
                        onSettingsChange={handleSettingsChange}
                        defaultSlippageBps={quoteConfig.defaultSlippageBps}
                        recommendedSlippageBps={recommendedSlippageBps}
                    >
                        <button
                            type="button"
                            className="settings-button"
                            aria-label={copy.settingsLabel}
                        >
                            <SettingsIcon />
                        </button>
                    </SwapSettingsPopover>}
                </div>

                {activeTab === 'Bridge' ? (
                    <CrossChainRoutePanel
                        endpoint={crossChain.endpoint}
                        account={walletAddress}
                        walletChainId={walletState.chainId}
                        onExecuteStep={handleCrossChainStep}
                        onSignMessage={handleCrossChainAuthentication}
                    />
                ) : (
                <>
                <LayoutGroup id="swap-layout">
                    <div className="swap-panels">
                        <motion.section
                            layout
                            className={[
                                'swap-panel',
                                'sell-panel',

                                sellToken
                                    ? 'panel-outlined'
                                    : 'panel-highlighted',
                            ].join(' ')}
                            transition={{
                                layout:
                                motionConfig.sharedLayout,
                            }}
                            onPointerEnter={() =>
                                setShowQuickAmounts(
                                    true,
                                )
                            }
                            onPointerLeave={() =>
                                setShowQuickAmounts(
                                    false,
                                )
                            }
                            onFocusCapture={() =>
                                setShowQuickAmounts(
                                    true,
                                )
                            }
                            onBlurCapture={(
                                event,
                            ) => {
                                if (
                                    !event.currentTarget.contains(
                                        event.relatedTarget,
                                    )
                                ) {
                                    setShowQuickAmounts(
                                        false,
                                    )
                                }
                            }}
                        >
              <span className="panel-label sell-label">
                {copy.sell}
              </span>

                            <QuickAmountControls
                                visible={
                                    showQuickAmounts
                                }
                                token={sellToken}
                                spendableAmount={spendableSellAmount}
                                onSelect={
                                    setSellAmount
                                }
                            />

                            <motion.div
                                layoutId={`amount-${sellTokenIdentity}`}
                                className="sell-amount-position"
                                transition={{
                                    layout:
                                    motionConfig.sharedLayout,
                                }}
                            >
                                <input
                                    value={sellAmount}
                                    onChange={
                                        handleSellAmountChange
                                    }
                                    inputMode="decimal"
                                    placeholder="0"
                                    aria-label={`${copy.sell} amount`}
                                    className="sell-amount-input"
                                />
                            </motion.div>

                            <div className="sell-token-position">
                                <AnimatedTokenButton
                                    token={sellToken}
                                    chainId={sellChainId}
                                    onClick={() =>
                                        openTokenSelector(
                                            'sell',
                                        )
                                    }
                                />
                            </div>

                            <span className="sell-fiat-value">
                {sellFiatValue}
              </span>

                            {sellToken && (
                                <button
                                    type="button"
                                    className="sell-balance"
                                    onClick={() => setSellAmount(spendableSellAmount)}
                                    aria-label={`Use maximum ${sellToken.symbol} balance`}
                                >
                  {sellToken.balance}{' '}
                                    {sellToken.symbol}
                                </button>
                            )}
                        </motion.section>

                        <motion.button
                            type="button"
                            className="switch-button"
                            aria-label={
                                copy.switchLabel
                            }
                            onClick={
                                handleSwitchTokens
                            }
                            style={{
                                x: '-50%',
                            }}
                            animate={{
                                rotate:
                                switchRotation,
                            }}
                            whileTap={
                                reducedMotion
                                    ? undefined
                                    : {
                                        scale:
                                        motionConfig
                                            .switchButton
                                            .pressedScale,
                                    }
                            }
                            transition={
                                reducedMotion
                                    ? {
                                        duration: 0,
                                    }
                                    : {
                                        duration:
                                        motionConfig
                                            .switchButton
                                            .duration,

                                        ease:
                                        motionConfig
                                            .switchButton
                                            .ease,
                                    }
                            }
                        >
                            <ArrowDownIcon />
                        </motion.button>

                        <motion.section
                            layout
                            className={[
                                'swap-panel',
                                'buy-panel',

                                buyToken
                                    ? 'panel-outlined'
                                    : 'panel-highlighted',
                            ].join(' ')}
                            transition={{
                                layout:
                                motionConfig.sharedLayout,
                            }}
                        >
              <span className="panel-label buy-label">
                {copy.buy}
              </span>

                            <motion.div
                                layoutId={`amount-${buyTokenIdentity}`}
                                className="buy-amount-position"
                                transition={{
                                    layout:
                                    motionConfig.sharedLayout,
                                }}
                            >
                <span className="buy-amount">
                  {buyAmount}
                </span>
                            </motion.div>

                            <div className="buy-token-position">
                                <AnimatedTokenButton
                                    token={buyToken}
                                    chainId={buyChainId}
                                    onClick={() =>
                                        openTokenSelector(
                                            'buy',
                                        )
                                    }
                                />
                            </div>

                            <span className="buy-fiat-value">
                                {buyFiatValue}
                            </span>
                        </motion.section>
                    </div>
                </LayoutGroup>

                <motion.button
                    type="button"
                    disabled={!swapAction.enabled}
                    className={[
                        'primary-action',

                        swapAction.enabled
                            ? 'primary-action-ready'
                            : '',
                    ].join(' ')}
                    whileTap={
                        swapAction.enabled &&
                        !reducedMotion
                            ? {
                                scale: 0.985,
                            }
                            : undefined
                    }
                    onClick={handlePrimaryAction}
                >
                    {swapAction.label}
                </motion.button>

                {executionMode === ZERO_X_GASLESS_MODE && (
                    <GasAssistBanner quote={gasAssist.quote} sellToken={sellToken} buyToken={buyToken} />
                )}

                {nativeBalance.status === 'error' && walletState.isConnected && walletState.isCorrectNetwork && (
                    <p className="swap-status" role="status">Unable to verify the {nativeSymbol} balance. Quoting is disabled.</p>
                )}

                {executionMessage && nativeBalance.value === 0n && (
                    <p className="swap-status" role="status">{executionMessage}</p>
                )}

                {(statusMessage || walletTokenError) && (
                    <p
                        className="swap-status"
                        role="status"
                        aria-live="polite"
                    >
                        {statusMessage ??
                            'Wallet balances are temporarily unavailable.'}
                    </p>
                )}
                </>
                )}
            </section>

            <AnimatePresence>
                {tokenSelectorSide && (
                    <TokenSelector
                        side={
                            tokenSelectorSide
                        }
                        chainId={selectorChainId}
                        tokens={selectorMarketTokens}
                        walletTokens={
                            selectorWalletTokens
                        }
                        search={tokenSearch}
                        loading={
                            marketTokensLoading
                        }
                        error={
                            marketTokensError
                        }
                        currentToken={
                            tokenSelectorSide ===
                            'sell'
                                ? sellToken
                                : buyToken
                        }
                        oppositeToken={
                            tokenSelectorSide ===
                            'sell'
                                ? buyToken
                                : sellToken
                        }
                        onSearchChange={
                            setTokenSearch
                        }
                        onChainChange={
                            setSelectorChainId
                        }
                        onSelect={
                            handleTokenSelect
                        }
                        onClose={
                            closeTokenSelector
                        }
                        hideUnknownTokens={swapSettings.hideUnknownTokens}
                        hideSmallBalances={swapSettings.hideSmallBalances}
                    />
                )}
            </AnimatePresence>

            <GasAssistApprovalDialog
                dialog={gasAssist.dialog}
                buyToken={buyToken}
                token={sellToken}
                amount={sellAmount}
                onClose={gasAssist.close}
                onConfirm={gasAssist.confirm}
            />
            <GasAssistPrepaymentDialog
                key={prepaidSponsorship.order?.id ?? 'prepaid-sponsorship'}
                sponsorship={prepaidSponsorship}
                sellToken={sellToken}
                buyToken={buyToken}
            />
            <PistachioWalletController />
        </main>
    )
}
