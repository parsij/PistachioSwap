/** Decorative chevron used by existing token and brand buttons. */
export function ChevronDownIcon({ className = '' }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
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
