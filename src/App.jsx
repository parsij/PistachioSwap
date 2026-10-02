import { useEffect, useState } from 'react'

import AppHeader from './app/AppHeader.jsx'
import AppLayout from './app/AppLayout.jsx'
import SwapPage from './features/swap/components/SwapPage.jsx'
import TokenSelectorOverlay from './features/tokens/components/TokenSelectorOverlay.jsx'
import PortfolioPage from './features/portfolio/components/PortfolioPage.jsx'
import { useSwapController } from './features/swap/hooks/useSwapController.js'

/**
 * Composes the PistachioSwap application shell from the swap controller view model.
 *
 * @returns {import('react').ReactElement} Application layout, header, and swap page.
 * @sideEffects Delegated feature hooks may load configured data; wallet and transaction side effects require explicit user actions.
 * @security Business rules remain in feature controllers/services rather than this composition boundary.
 */
function currentAppView() {
    if (typeof window === 'undefined') return 'trade'
    return new URLSearchParams(window.location.search).get('view') === 'portfolio'
        ? 'portfolio'
        : 'trade'
}

export default function App() {
    const { layoutStyle, header, page } = useSwapController()
    const [appView, setAppView] = useState(currentAppView)

    useEffect(() => {
        const syncFromLocation = () => setAppView(currentAppView())
        const handleAppNavigation = (event) => {
            setAppView(event.detail?.view === 'portfolio' ? 'portfolio' : 'trade')
        }

        window.addEventListener('popstate', syncFromLocation)
        window.addEventListener('pistachio:navigate-app', handleAppNavigation)
        return () => {
            window.removeEventListener('popstate', syncFromLocation)
            window.removeEventListener('pistachio:navigate-app', handleAppNavigation)
        }
    }, [])

    const portfolioView = appView === 'portfolio'

    return (
        <AppLayout
            style={layoutStyle}
            header={<AppHeader {...header} />}
        >
            {portfolioView ? (
                <>
                    <PortfolioPage wallet={header.wallet} />
                    <TokenSelectorOverlay {...page.tokenSelector} />
                </>
            ) : (
                <SwapPage {...page} />
            )}
        </AppLayout>
    )
}
