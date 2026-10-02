import WalletConnectionButton from '../features/wallet/components/WalletConnectionButton.jsx'
import { PistachioWalletButton } from '../features/passkey/components/PistachioWalletController.jsx'
import BrandMenu from './BrandMenu.jsx'
import HeaderSearch from './HeaderSearch.jsx'

/**
 * Renders the PistachioSwap header, brand menu, and wallet controls.
 * @param {{brand: object, wallet: object}} props Header view model.
 * @returns {import('react').ReactElement} Application header markup.
 * @sideEffects Wallet controls may open wallet UI or invoke the supplied async refresh callback.
 */
function navigationItemIsActive(item) {
    if (typeof window === 'undefined') return item.active === true
    const current = new URL(window.location.href)
    const target = new URL(item.href, current.origin)
    if (target.pathname !== current.pathname) return false
    return (target.searchParams.get('view') ?? 'trade') ===
        (current.searchParams.get('view') ?? 'trade')
}

function handleAppNavigation(event, item) {
    if (typeof window === 'undefined') return
    const target = new URL(item.href, window.location.origin)
    if (target.pathname !== '/swap/') return

    event.preventDefault()
    window.history.pushState(window.history.state, '', target)
    window.dispatchEvent(new CustomEvent('pistachio:navigate-app', {
        detail: {
            view: target.searchParams.get('view') === 'portfolio'
                ? 'portfolio'
                : 'trade',
        },
    }))
}

export default function AppHeader({ brand, navigation = [], search, wallet }) {
    return (
        <header className="app-header">
            <div className="header-left">
                <BrandMenu name={brand.name} />
                <nav className="header-navigation" aria-label="Primary navigation">
                    {navigation.map((item) => {
                        const active = navigationItemIsActive(item)
                        return (
                        <a
                            key={item.label}
                            className={`header-navigation-item${active ? ' active' : ''}`}
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            onClick={(event) => handleAppNavigation(event, item)}
                        >
                            <span>{item.label}</span>
                            {item.badge ? <span className="header-navigation-badge">{item.badge}</span> : null}
                        </a>
                    )})}
                </nav>
                {search ? <HeaderSearch {...search} /> : null}
            </div>
            <div className="header-right">
                <PistachioWalletButton />
                <WalletConnectionButton {...wallet} />
            </div>
        </header>
    )
}
