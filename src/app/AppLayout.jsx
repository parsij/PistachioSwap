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
            {overlays}
        </main>
    )
}
