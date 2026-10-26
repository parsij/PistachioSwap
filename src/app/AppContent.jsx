import PortfolioPage from '../features/portfolio/components/PortfolioPage.jsx'
import TokenDetailsPage from '../features/tokens/components/TokenDetailsPage.jsx'
import TokenSelectorOverlay from '../features/tokens/components/TokenSelectorOverlay.jsx'
export default function AppContent({ view, wallet, page, search, children }) {
    if (view === 'portfolio') return <><PortfolioPage wallet={wallet} /><TokenSelectorOverlay {...page.tokenSelector} /></>
    if (view === 'token') return <TokenDetailsPage onBrowseTokens={search?.onOpen} token={page.card.buyPanel.token} page={page} />
    return children
}
