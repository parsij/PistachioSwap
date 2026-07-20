import heroImg from './assets/hero.png'

const apiBaseUrl = (
    import.meta.env.VITE_API_BASE_URL ??
    'http://localhost:3001'
).replace(/\/+$/, '')

export const swapUiConfig = {
    brand: {
        name:
            import.meta.env.VITE_APP_NAME ??
            'PistachioSwap',

        logo: heroImg,
    },

    chain: {
        id: Number(
            import.meta.env.VITE_DEFAULT_CHAIN_ID ??
            56,
        ),

        name:
            import.meta.env.VITE_CHAIN_NAME ??
            'BNB Chain',
    },

    quote: {
        endpoint: `${apiBaseUrl}/v1/quote`,

        debounceMs: Number(
            import.meta.env.VITE_QUOTE_DEBOUNCE_MS ??
            350,
        ),

        defaultSlippageBps: Number(
            import.meta.env.VITE_DEFAULT_SLIPPAGE_BPS ?? 50,
        ),

        // Deprecated: provider routing, not local fixed USD thresholds,
        // determines whether same-chain amounts are quoteable.
        deprecatedMinimumSwapUsd: String(
            import.meta.env.VITE_MIN_SWAP_USD ?? '1',
        ),

        maxCostToInputBps: Number(
            import.meta.env.VITE_MAX_COST_TO_INPUT_BPS ?? 5000,
        ),

        // Deprecated: retained only so old deployments can keep the env var
        // without making small provider-routable swaps fail locally.
        deprecatedMinimumOutputUsd: String(
            import.meta.env.VITE_MIN_OUTPUT_USD ?? '0.01',
        ),

        requireSuccessfulSimulationBeforeSend:
            import.meta.env.VITE_REQUIRE_SUCCESSFUL_SIMULATION_BEFORE_SEND !== 'false',
    },

    crossChain: {
        endpoint: `${apiBaseUrl}/v1/cross-chain`,
    },

    wallet: {
        /*
         * Used only while no live quote fee can be converted into native units.
         */
        nativeGasReserve:
            import.meta.env.VITE_NATIVE_GAS_RESERVE ??
            import.meta.env.VITE_NATIVE_GAS_RESERVE_BNB ??
            '0.00005',

        /*
         * Live fee reserve:
         *
         * estimated fee + 25%, with a minimum extra buffer of
         * 0.000005 native tokens.
         */
        nativeGasBufferBps: Number(
            import.meta.env.VITE_NATIVE_GAS_BUFFER_BPS ??
            2500,
        ),

        minimumNativeGasBuffer:
            import.meta.env.VITE_MIN_NATIVE_GAS_BUFFER ??
            '0.000005',

        explorerUrl: (
            import.meta.env.VITE_BSC_EXPLORER_URL ??
            'https://bscscan.com'
        ).replace(/\/+$/, ''),
    },

    navigation: [
        {
            label: 'Trade',
            active: true,
        },
        {
            label: 'Explore',
            active: false,
        },
        {
            label: 'Pool',
            active: false,
        },
        {
            label: 'Portfolio',
            active: false,
        },
    ],

    tabs: [
        'Swap',
        'Limit',
        'Buy',
        'Sell',
    ],

    quickAmounts: [
        {
            label: '25%',
            percent: 25,
        },
        {
            label: '50%',
            percent: 50,
        },
        {
            label: '75%',
            percent: 75,
        },
        {
            label: 'Max',
            percent: 100,
        },
    ],

    tokens: {
        initialSellToken: {
            id: 'initial-native-token',

            chainId: Number(
                import.meta.env.VITE_DEFAULT_CHAIN_ID ??
                56,
            ),

            address:
                import.meta.env.VITE_INITIAL_ASSET_ADDRESS ??
                '0x0000000000000000000000000000000000000000',

            symbol:
                import.meta.env.VITE_INITIAL_ASSET_SYMBOL ??
                'BNB',

            name:
                import.meta.env.VITE_INITIAL_ASSET_NAME ??
                'BNB',

            decimals: Number(
                import.meta.env.VITE_INITIAL_ASSET_DECIMALS ??
                18,
            ),

            balance: '0',
            iconType: 'bnb',
            isNative: true,
            verificationStatus: 'established',

            logoURI:
                import.meta.env.VITE_INITIAL_ASSET_LOGO ??
                '/icons/BSC.svg',

            chainLogoURI:
                import.meta.env.VITE_CHAIN_LOGO ??
                null,
        },

        initialBuyToken: null,
    },

    tokenSelector: {
        recentStorageKey:
            import.meta.env.VITE_RECENT_TOKEN_STORAGE_KEY ??
            'pistachioswap:recent-token-searches:v1',

        maxRecentTokens: Number(
            import.meta.env.VITE_MAX_RECENT_TOKENS ??
            3,
        ),

        featuredTokenCount: Number(
            import.meta.env.VITE_FEATURED_TOKEN_COUNT ??
            4,
        ),

        maxYourTokens: Number(
            import.meta.env.VITE_MAX_YOUR_TOKENS ??
            5,
        ),

        skeletonRows: Number(
            import.meta.env.VITE_TOKEN_SKELETON_ROWS ??
            7,
        ),

        addressPrefixLength: Number(
            import.meta.env.VITE_TOKEN_ADDRESS_PREFIX_LENGTH ??
            6,
        ),

        addressSuffixLength: Number(
            import.meta.env.VITE_TOKEN_ADDRESS_SUFFIX_LENGTH ??
            4,
        ),
    },

    copy: {
        sell: 'Sell',
        buy: 'Buy',
        selectToken: 'Select a token',
        enterAmount: 'Enter an amount',
        findingQuote:
            'Finding the best price',
        quoteUnavailable:
            'No quote available',
        swap: 'Swap',

        searchTokens:
            'Search tokens',

        settingsLabel:
            'Swap settings',

        searchLabel: 'Search',
        networkLabel: 'Network',

        switchLabel:
            'Switch tokens',

        closeLabel: 'Close',

        fiatValue: '$0',

        yourTokens:
            'Your tokens',

        recentSearches:
            'Recent searches',

        clear: 'Clear',

        tokensByVolume:
            'Tokens by 24H volume',

        noMatchingTokens:
            'No matching tokens',

        noTokensAvailable:
            'No tokens available',
    },

    styles: {
        color: {
            background:
                import.meta.env.VITE_BACKGROUND_COLOR ??
                '#191919',

            panel:
                import.meta.env.VITE_PANEL_COLOR ??
                '#252525',

            activeTab:
                import.meta.env.VITE_ACTIVE_TAB_COLOR ??
                '#343434',

            border:
                import.meta.env.VITE_BORDER_COLOR ??
                '#353535',

            tokenButton:
                import.meta.env.VITE_TOKEN_BUTTON_COLOR ??
                '#191919',

            hover:
                import.meta.env.VITE_HOVER_COLOR ??
                '#2c2c2c',

            text:
                import.meta.env.VITE_TEXT_COLOR ??
                '#ffffff',

            muted:
                import.meta.env.VITE_MUTED_COLOR ??
                '#a9a9a9',

            subtleMuted:
                import.meta.env.VITE_SUBTLE_MUTED_COLOR ??
                '#777777',

            amountMuted:
                import.meta.env.VITE_AMOUNT_MUTED_COLOR ??
                '#737373',

            accent:
                import.meta.env.VITE_ACCENT_COLOR ??
                '#8ac27c',

            ethereum:
                import.meta.env.VITE_ETHEREUM_COLOR ??
                '#627eea',

            networkBackground:
                '#20383e',

            networkForeground:
                '#45c9e8',

            chainBadgeBackground:
                '#ffffff',

            chainBadgeForeground:
                '#111111',

            backdrop:
                'rgb(0 0 0 / 48%)',

            skeletonBase:
                '#292929',

            skeletonHighlight:
                '#373737',

            scrollbarTrack:
                '#171717',

            scrollbarThumb:
                '#3a3a3a',

            scrollbarHover:
                '#4a4a4a',
        },

        size: {
            headerHeight: '72px',
            headerLogo: '24px',
            headerIcon: '22px',
            networkIcon: '24px',

            viewportInset: '24px',
            swapWidth: '480px',
            swapTopMargin: '53px',

            toolbarHeight: '36px',
            tabHeight: '36px',

            sellPanelHeight: '136px',
            buyPanelHeight: '132px',
            actionHeight: '55px',

            tokenButtonHeight: '38px',
            selectedTokenMinWidth: '108px',
            selectTokenWidth: '140px',

            tokenIconButton: '28px',
            tokenIconList: '40px',
            tokenIconFeatured: '32px',
            chainBadge: '13px',

            switchButton: '48px',
            switchIcon: '24px',
            quickButtonHeight: '24px',

            navFont: '18px',
            tabFont: '14px',
            labelFont: '16px',
            amountFont: '34px',
            secondaryFont: '14px',
            quickFont: '12px',
            actionFont: '18px',
            tokenFont: '16px',

            tokenDialogWidth:
                import.meta.env.VITE_TOKEN_DIALOG_WIDTH ??
                '400px',

            tokenDialogHeight:
                import.meta.env.VITE_TOKEN_DIALOG_HEIGHT ??
                '700px',

            tokenSearchHeight: '48px',
            tokenRowHeight: '64px',
        },

        spacing: {
            headerHorizontal: '16px',
            headerGroupGap: '32px',
            headerNavigationGap: '30px',

            toolbarHorizontal: '4px',
            toolbarBottom: '6px',
            tabGap: '8px',
            tabHorizontal: '13px',

            panelHorizontal: '16px',
            panelLabelTop: '14px',
            buyLabelTop: '17px',

            sellAmountTop: '42px',
            sellAmountWidth: '260px',
            buyAmountTop: '50px',

            tokenRight: '17px',
            sellTokenTop: '47px',
            buyTokenTop: '49px',

            secondaryBottom: '19px',
            panelGap: '4px',
            actionTop: '4px',

            tokenButtonLeft: '5px',
            tokenButtonRight: '11px',
            tokenButtonGap: '7px',
            selectTokenGap: '5px',

            quickTop: '14px',
            quickRight: '17px',
            quickGap: '4px',
            quickHorizontal: '8px',

            switchTop: '116px',
            switchBorder: '4px',
        },

        radius: {
            pill: '999px',
            panel: '22px',
            action: '20px',
            switch: '16px',
            dialog: '20px',
            tokenRow: '12px',
            search: '16px',
            featuredToken: '16px',
        },

        border: {
            standard: '1px',
        },

        font: {
            family:
                'Basel, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',

            regular: '400',
            medium: '500',
            semibold: '600',
        },

        shadow: {
            switch:
                '0 2px 4px rgb(0 0 0 / 45%)',

            dialog:
                '0 24px 80px rgb(0 0 0 / 55%)',
        },
    },

    motion: {
        sharedLayout: {
            type: 'spring',
            stiffness: 520,
            damping: 40,
            mass: 0.8,
        },

        quickAmounts: {
            offsetX: 22,
            blur: 4,
            duration: 0.22,
            stagger: 0.025,
            ease: [
                0.22,
                1,
                0.36,
                1,
            ],
        },

        switchButton: {
            pressedScale: 0.92,
            duration: 0.3,

            ease: [
                0.22,
                1,
                0.36,
                1,
            ],
        },

        tokenButton: {
            pressedScale: 0.97,
        },

        dialog: {
            scale: 0.96,
            offsetY: 14,
            blur: 5,
            stiffness: 420,
            damping: 32,
        },
    },
}

function toKebabCase(value) {
    return value.replace(
        /[A-Z]/g,
        (letter) =>
            `-${letter.toLowerCase()}`,
    )
}

function flattenVariables(
    source,
    path = [],
    output = {},
) {
    for (
        const [key, value] of
        Object.entries(source)
        ) {
        const nextPath = [
            ...path,
            toKebabCase(key),
        ]

        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            flattenVariables(
                value,
                nextPath,
                output,
            )

            continue
        }

        output[
            `--${nextPath.join('-')}`
            ] = String(value)
    }

    return output
}

export function createCssVariables() {
    return flattenVariables(
        swapUiConfig.styles,
    )
}
