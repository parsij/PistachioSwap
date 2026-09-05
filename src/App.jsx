import HostedAccessGate from './app/HostedAccessGate.jsx'
import AppHeader from './app/AppHeader.jsx'
import AppLayout from './app/AppLayout.jsx'
import SwapPage from './features/swap/components/SwapPage.jsx'
import { useSwapController } from './features/swap/hooks/useSwapController.js'

function SwapApp() {
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

/**
 * Gates the hosted UI before swap and wallet features mount.
 */
export default function App() {
    return <HostedAccessGate><SwapApp /></HostedAccessGate>
}
