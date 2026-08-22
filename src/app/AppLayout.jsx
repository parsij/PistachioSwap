import { useEffect, useState } from 'react'

const legalFooterStyle = {
    padding: '2rem 1rem 1.25rem',
    color: 'var(--color-text-secondary, currentColor)',
    fontSize: '0.75rem',
    opacity: 0.72,
    textAlign: 'center',
}

const legalLinkStyle = {
    color: 'inherit',
    textDecoration: 'none',
}

const legalSeparatorStyle = {
    margin: '0 0.5rem',
    opacity: 0.5,
}

const showLegalFooter = import.meta.env.PROD

/**
 * Provides the existing top-level application shell and CSS-variable boundary.
 * @param {{style: object, header: import('react').ReactNode, children: import('react').ReactNode, overlays: import('react').ReactNode}} props Layout slots.
 * @returns {import('react').ReactElement} Main application landmark.
 * @sideEffects None; child slots own their interactions.
 */
export default function AppLayout({ style, header, children, overlays }) {
    const [footerReady, setFooterReady] = useState(false)

    useEffect(() => {
        setFooterReady(true)
    }, [])

    return (
        <main className="app-shell" style={style}>
            {header}
            {children}
            {showLegalFooter && footerReady && (
                <footer style={legalFooterStyle}>
                    {/*
                      * The overview page is otherwise unreachable from the
                      * application, which would leave it orphaned for crawlers
                      * and for anyone wanting to read what this does first.
                      */}
                    <a href="/landing/" style={legalLinkStyle}>
                        About Pistachio Swap
                    </a>
                    <span style={legalSeparatorStyle} aria-hidden="true">·</span>
                    <a href="/landing/gas-assist/" style={legalLinkStyle}>
                        How Gas Assist works
                    </a>
                    <span style={legalSeparatorStyle} aria-hidden="true">·</span>
                    <a href="/landing/faq/" style={legalLinkStyle}>
                        FAQ
                    </a>
                    <span style={legalSeparatorStyle} aria-hidden="true">·</span>
                    <a href="/legal/third-party/" style={legalLinkStyle}>
                        Legal &amp; third-party notices
                    </a>
                </footer>
            )}
            {overlays}
        </main>
    )
}
