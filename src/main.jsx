import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import AppErrorBoundary from './app/AppErrorBoundary.jsx'
import AppFatalError from './app/AppFatalError.jsx'
import {
    ensureWalletRuntime,
    registerWalletRuntimeLoader,
    scheduleWalletRuntimeWarmup,
} from './web3/walletRuntime.js'
import { hasPersistedWalletSession } from './web3/walletSession.js'
import './index.css'
import './mobileHardening.css'

const root = createRoot(document.getElementById('root'))
const kitHost = document.getElementById('wallet-kit-root')
let kitRoot = null

/*
 * AppKit and Wagmi stay out of the first visit so the swap UI can paint.
 * A saved WalletConnect/AppKit session is restored immediately; otherwise the
 * hashed wallet chunks are warmed into the browser HTTP cache after idle.
 */
registerWalletRuntimeLoader(async () => {
    const [{ default: AppKitProvider }, { default: LiveWalletBindings }] =
        await Promise.all([
            import('./web3/AppKitProvider.jsx'),
            import('./web3/LiveWalletBindings.jsx'),
        ])
    if (!kitHost) {
        throw new Error('Wallet host element #wallet-kit-root is missing.')
    }
    if (!kitRoot) kitRoot = createRoot(kitHost)
    kitRoot.render(
        <StrictMode>
            <AppKitProvider>
                <LiveWalletBindings />
            </AppKitProvider>
        </StrictMode>,
    )
})

if (hasPersistedWalletSession()) {
    void ensureWalletRuntime({ visible: true })
} else {
    scheduleWalletRuntimeWarmup()
}

import('./App.jsx').then(({ default: App }) => {
    root.render(
        <StrictMode>
            <AppErrorBoundary>
                <App />
            </AppErrorBoundary>
        </StrictMode>,
    )
}).catch((error) => {
    if (import.meta.env.DEV) {
        console.error('[app-bootstrap]', error)
    }
    root.render(
        <StrictMode>
            <AppFatalError title="PistachioSwap could not start" />
        </StrictMode>,
    )
})
