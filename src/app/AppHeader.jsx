import WalletConnectionButton from '../features/wallet/components/WalletConnectionButton.jsx'
import { PistachioWalletButton } from '../features/passkey/components/PistachioWalletController.jsx'
import { ChevronDownIcon, SearchIcon } from '../shared/components/AppIcons.jsx'

/**
 * Renders the application brand/navigation header and wallet controls.
 * @param {{brand: object, navigation: object[], searchLabel: string, wallet: object}} props Header view model.
 * @returns {import('react').ReactElement} Existing application header markup.
 * @sideEffects The wallet controls may open wallet UI or invoke the supplied async refresh callback.
 */
export default function AppHeader({ brand, navigation, searchLabel, wallet }) {
    return (
        <header className="app-header">
            <div className="header-left">
                <button type="button" className="brand-button" aria-label={brand.name}>
                    <img src={brand.logo} alt="" className="brand-logo" draggable="false" />
                    <ChevronDownIcon className="brand-chevron" />
                </button>
                <nav className="header-navigation">
                    {navigation.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            className={item.active ? 'header-navigation-item active' : 'header-navigation-item'}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>
            </div>
            <div className="header-right">
                <button type="button" className="header-icon-button" aria-label={searchLabel}>
                    <SearchIcon />
                </button>
                <PistachioWalletButton />
                <WalletConnectionButton {...wallet} />
            </div>
        </header>
    )
}
