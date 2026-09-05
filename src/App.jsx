import AppHeader from './app/AppHeader.jsx'
import AppLayout from './app/AppLayout.jsx'
import SwapPage from './features/swap/components/SwapPage.jsx'
import { useSwapController } from './features/swap/hooks/useSwapController.js'

/**
 * Composes the PistachioSwap application shell from the swap controller view model.
 *
 * @returns {import('react').ReactElement} Application layout, header, and swap page.
 * @sideEffects Delegated feature hooks may load configured data; wallet and transaction side effects require explicit user actions.
 * @security Business rules remain in feature controllers/services rather than this composition boundary.
 */
export default function App() {
    const { layoutStyle, header, page } = useSwapController()

    return (
        <AppLayout
            style={layoutStyle}
            header={<AppHeader {...header} />}
        >
            <SwapPage {...page} />
        </AppLayout>
    )
}
