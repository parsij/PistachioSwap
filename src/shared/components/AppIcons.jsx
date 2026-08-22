/** Decorative chevron used by existing token and brand buttons. */
export function ChevronDownIcon({ className = '' }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        </svg>
    )
}

/** Decorative hamburger glyph used by the mobile brand menu trigger. */
export function MenuIcon({ className = '' }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
        </svg>
    )
}

/** Decorative GitHub mark used by the brand menu footer. */
export function GitHubIcon({ className = '' }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.36 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.2 9.2 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
            />
        </svg>
    )
}

/** Decorative search glyph for the application header. */
export function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4.3 4.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
    )
}

/** Decorative settings glyph for the swap toolbar. */
export function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58-1.92-3.32-2.39.96a7.2 7.2 0 0 0-1.62-.94L14.88 3h-3.84l-.36 3.18a7.2 7.2 0 0 0-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58a7.7 7.7 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58 1.92 3.32 2.39-.96c.5.39 1.04.7 1.62.94l.36 3.18h3.84l.36-3.18a7.2 7.2 0 0 0 1.62-.94l2.39.96 1.92-3.32-2.03-1.58ZM12.96 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
        </svg>
    )
}

/** Decorative direction glyph for the swap-direction control. */
export function ArrowDownIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v14m0 0-6-6m6 6 6-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        </svg>
    )
}

/** Decorative information glyph used inside accessible tooltip triggers. */
export function InfoIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M8 7.15v4.1" stroke="var(--color-background)" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="4.65" r=".85" fill="var(--color-background)" />
        </svg>
    )
}
