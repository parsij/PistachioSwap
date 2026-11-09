import AppHeader from './app/AppHeader.jsx'
import AppLayout from './app/AppLayout.jsx'
import AppContent from './app/AppContent.jsx'
import { useAppView } from './app/useAppView.js'
import SwapPage from './features/swap/components/SwapPage.jsx'
import PistachioWalletController from './features/passkey/components/PistachioWalletController.jsx'
import { useSwapController } from './features/swap/hooks/useSwapController.js'
/**
 * Composes navigation and feature views without owning transaction business rules.
 * Wallet, quote and transaction side effects remain in the feature controllers.
 */
export default function App() {
    const { layoutStyle, header, page } = useSwapController()
    const view = useAppView()
    return (
        <AppLayout
            style={layoutStyle}
            header={<AppHeader {...header} />}
            overlays={<PistachioWalletController />}
        >
            <AppContent
                view={view} wallet={header.wallet}
                page={page} search={header.search}
            >
                <SwapPage {...page} />
            </AppContent>
        </AppLayout>
    )
}
