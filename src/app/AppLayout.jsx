import './AppLayout.css'

/**
 * Provides the existing top-level application shell and CSS-variable boundary.
 * @param {{style: object, header: import('react').ReactNode, children: import('react').ReactNode, overlays: import('react').ReactNode}} props Layout slots.
 * @returns {import('react').ReactElement} Main application landmark.
 * @sideEffects None; child slots own their interactions.
 */
export default function AppLayout({ style, header, children, overlays }) {
    return (
        <main className="app-shell" style={style}>
            <h1 className="app-page-heading">Pistachio Swap</h1>
            {header}
            {children}
            <footer className="app-info-footer" aria-label="Pistachio Swap links">
                <nav aria-label="Product guides">
                    <a href="/">About</a>
                    <a href="/wallet/">Pistachio Wallet</a>
                    <a href="/gas-assist/">Gas Assist</a>
                    <a href="/how-it-works/">How Pistachio Swap works</a>
                    <a href="/faq/">FAQ</a>
                    <a href="/legal/third-party/">Legal &amp; third-party notices</a>
                </nav>
            </footer>
            {overlays}
        </main>
    )
}
