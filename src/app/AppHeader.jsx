import WalletConnectionButton from '../features/wallet/components/WalletConnectionButton.jsx'
import { PistachioWalletButton } from '../features/passkey/components/PistachioWalletController.jsx'
import BrandMenu from './BrandMenu.jsx'

/**
 * Renders the PistachioSwap header, brand menu, and wallet controls.
 * @param {{brand: object, wallet: object}} props Header view model.
 * @returns {import('react').ReactElement} Application header markup.
 * @sideEffects Wallet controls may open wallet UI or invoke the supplied async refresh callback.
 */
export default function AppHeader({ brand, wallet }) {
    return (
        <header className="app-header">
            <div className="header-left">
                <BrandMenu name={brand.name} />
            </div>
            <div className="header-right">
                <PistachioWalletButton />
                <WalletConnectionButton {...wallet} />
            </div>
        </header>
    )
}
