import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'

import { createAppMetadata } from './appKitMetadata.js'
import {
    CURATED_EVM_CHAINS,
    getCuratedEvmChain,
} from './curatedEvmChains.js'
import { getPistachioWalletFlags } from '../features/passkey/services/featureFlags.js'
import { pistachioWalletConnector } from '../features/passkey/services/pistachioConnector.js'

const APPKIT_CONTEXT_KEY = Symbol.for(
    'pistachioswap.appkit.context',
)

export const appKitNetworks = CURATED_EVM_CHAINS

export function validateProjectId(value) {
    const projectId = String(value ?? '').trim()

    if (!projectId) {
        throw new Error(
            'Missing VITE_REOWN_PROJECT_ID. Add it to the root .env.local file.',
        )
    }

    if (!/^[a-fA-F0-9]{32}$/.test(projectId)) {
        throw new Error(
            'VITE_REOWN_PROJECT_ID must be a valid 32-character Reown project ID.',
        )
    }

    return projectId
}

function initializeAppKit() {
    const projectId = validateProjectId(
        import.meta.env.VITE_REOWN_PROJECT_ID,
    )

    const origin = window.location.origin
    const metadata = createAppMetadata({ origin })
    const pistachioWalletFlags = getPistachioWalletFlags()
    let appKit

    const wagmiAdapter = new WagmiAdapter({
        networks: appKitNetworks,
        projectId,
        ssr: false,
        connectors: pistachioWalletFlags.passkeyWalletEnabled
            ? [pistachioWalletConnector({
                closeAppKit: () => appKit.close(),
                clearAppKitLoading: () => appKit.setLoading(false),
            })]
            : [],
    })

    appKit = createAppKit({
        adapters: [wagmiAdapter],
        networks: appKitNetworks,
        defaultNetwork: getCuratedEvmChain(56),
        projectId,
        metadata,
        defaultAccountTypes: { eip155: 'eoa' },
        enableWallets: true,
        enableBaseAccount: false,
        coinbasePreference: 'eoaOnly',
        enableReconnect: true,
        enableNetworkSwitch: true,
        allowUnsupportedChain: false,
        enableMobileFullScreen: true,
        allWallets: 'SHOW',
        features: {
            swaps: false,
            onramp: false,
            analytics: false,
            email: false,
            socials: [],
        },
        themeMode: 'dark',
        themeVariables: {
            '--apkt-accent': '#8ac27c',
            '--apkt-color-mix': '#191919',
            '--apkt-color-mix-strength': 0,
            '--apkt-font-family': 'Basel, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            '--apkt-border-radius-master': '16px',
        },
    })

    return { appKit, wagmiAdapter }
}

const appKitContext =
    globalThis[APPKIT_CONTEXT_KEY] ??
    initializeAppKit()

globalThis[APPKIT_CONTEXT_KEY] = appKitContext

export const appKit = appKitContext.appKit
export const wagmiConfig =
    appKitContext.wagmiAdapter.wagmiConfig
