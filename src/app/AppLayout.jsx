/**
 * Provides the existing top-level application shell and CSS-variable boundary.
 * @param {{style: object, header: import('react').ReactNode, children: import('react').ReactNode, overlays: import('react').ReactNode}} props Layout slots.
 * @returns {import('react').ReactElement} Main application landmark.
 * @sideEffects None; child slots own their interactions.
 */
export default function AppLayout({ style, header, children, overlays }) {
    return (
        <main className="app-shell" style={style}>
            {header}
            {children}
            {/* Keep this public content in sync with the static swap/index.html footer. */}
            <footer className="app-info-footer" aria-label="About Pistachio Swap">
                <h1>Pistachio Swap</h1>
                <p>Compare crypto swap routes with a self-custodial wallet. Gas Assist is available for eligible BNB Chain swaps; costs apply.</p>
                <nav aria-label="Product guides">
                    <a href="/">About</a>
                    <a href="/landing/wallet/">Pistachio Wallet</a>
                    <a href="/landing/gas-assist/">Gas Assist</a>
                    <a href="/landing/how-it-works/">How Pistachio Swap works</a>
                    <a href="/landing/faq/">FAQ</a>
                    <a href="/legal/third-party/">Legal &amp; third-party notices</a>
                </nav>
            </footer>
            {overlays}
        </main>
    )
}
