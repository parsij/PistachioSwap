import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import AppErrorBoundary from './app/AppErrorBoundary.jsx'
import './index.css'
import AppKitProvider from './web3/AppKitProvider.jsx'

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <AppErrorBoundary>
            <AppKitProvider>
                <App />
            </AppKitProvider>
        </AppErrorBoundary>
    </StrictMode>,
)
