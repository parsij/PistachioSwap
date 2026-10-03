import { useEffect, useState } from 'react'

import AppHeader from './app/AppHeader.jsx'
import AppLayout from './app/AppLayout.jsx'
import SwapPage from './features/swap/components/SwapPage.jsx'
import TokenSelectorOverlay from './features/tokens/components/TokenSelectorOverlay.jsx'
import TokenDetailsPage from './features/tokens/components/TokenDetailsPage.jsx'
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
    const view = new URLSearchParams(window.location.search).get('view')
    return ['portfolio', 'token'].includes(view) ? view : 'trade'
}

export default function App() {
    const { layoutStyle, header, page } = useSwapController()
    const [appView, setAppView] = useState(currentAppView)

    useEffect(() => {
        const syncFromLocation = () => setAppView(currentAppView())
        const handleAppNavigation = (event) => {
            setAppView(
                ['portfolio', 'token'].includes(event.detail?.view)
                    ? event.detail.view
                    : 'trade',
            )
        }

        window.addEventListener('popstate', syncFromLocation)
        window.addEventListener('pistachio:navigate-app', handleAppNavigation)
        return () => {
            window.removeEventListener('popstate', syncFromLocation)
            window.removeEventListener('pistachio:navigate-app', handleAppNavigation)
        }
    }, [])

    const portfolioView = appView === 'portfolio'
    const tokenView = appView === 'token'

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
            ) : tokenView ? (
                <TokenDetailsPage
                    onBrowseTokens={header.search?.onOpen}
                    token={page.card.buyPanel.token}
                    page={page}
                />
            ) : (
                <SwapPage {...page} />
            )}
        </AppLayout>
    )
}
