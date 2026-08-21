import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import AppErrorBoundary from './app/AppErrorBoundary.jsx'
import AppFatalError from './app/AppFatalError.jsx'
import { registerWalletRuntimeLoader } from './web3/walletRuntime.js'
import './index.css'

const root = createRoot(document.getElementById('root'))
const kitHost = document.getElementById('wallet-kit-root')
let kitRoot = null

/*
 * AppKit and Wagmi stay out of the first visit. The swap UI mounts on its own;
 * Connect wallet dynamically imports the provider into a sibling React root so
 * the swap tree is not remounted.
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
