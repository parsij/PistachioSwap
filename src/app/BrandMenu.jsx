import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    ArrowLeftRight,
    CircleHelp,
    Compass,
    Fuel,
    Network,
    Rocket,
    WalletCards,
    Waves,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { ChevronDownIcon, GitHubIcon, MenuIcon } from '../shared/components/AppIcons.jsx'

const LANDING_HREF = '/landing/'
// Keep in sync with the compact-header media query in src/index.css.
const MOBILE_MEDIA = '(max-width: 1024px)'
const HOVER_CLOSE_DELAY_MS = 160

const APP_LINKS = [
    { href: '/', label: 'Trade', Icon: ArrowLeftRight },
    { href: '/landing/#networks', label: 'Explore', Icon: Compass },
    { href: '/landing/gas-assist/', label: 'Launches', badge: 'Beta', Icon: Rocket },
    { href: '/landing/#how', label: 'Pool', Icon: Waves },
    { href: '/landing/#wallet', label: 'Portfolio', Icon: WalletCards },
]

const PRODUCT_LINKS = [
    {
        href: '/landing/#wallet',
        label: 'Pistachio Wallet',
        description: 'Self-custody wallet',
        Icon: WalletCards,
    },
    {
        href: '/landing/gas-assist/',
        label: 'Gas Assist',
        description: 'Swap without gas',
        Icon: Fuel,
    },
    {
        href: '/landing/#how',
        label: 'Smart routing',
        description: 'Compare swap routes',
        Icon: ArrowLeftRight,
    },
    {
        href: '/landing/#networks',
        label: 'Multi-chain',
        description: '25 EVM networks',
        Icon: Network,
    },
]

const PROTOCOL_LINKS = [
    { href: '/', label: 'Trade' },
    { href: '/landing/gas-assist/', label: 'Gas Assist' },
    {
        href: 'https://github.com/parsij/PistachioSwap',
        label: 'Developers',
        external: true,
    },
]

const COMPANY_LINKS = [
    { href: '/landing/', label: 'About' },
    { href: '/landing/faq/', label: 'FAQ' },
    { href: '/landing/#risk', label: 'Safety' },
]

const LEGAL_LINK = {
    href: '/legal/third-party/',
    label: 'Legal & third-party notices',
}

function readMobileViewport() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(MOBILE_MEDIA).matches
        : false
}

function useMobileViewport() {
    const [mobile, setMobile] = useState(readMobileViewport)

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined
        const media = window.matchMedia(MOBILE_MEDIA)
        const onChange = () => setMobile(media.matches)
        onChange()
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
    }, [])

    return mobile
}

function MenuLink({ href, label, description, badge, Icon, external, onNavigate, appLink = false }) {
    const rel = external ? 'noopener noreferrer' : undefined
    const target = external ? '_blank' : undefined
    const className = description
        ? 'brand-menu-product'
        : appLink
            ? 'brand-menu-app-link'
            : 'brand-menu-link'

    return (
        <a
            className={className}
            href={href}
            rel={rel}
            target={target}
            onClick={onNavigate}
        >
            {Icon ? (
                <span className="brand-menu-product-icon">
                    <Icon aria-hidden="true" />
                </span>
            ) : null}
            <span className="brand-menu-product-copy">
                <span className="brand-menu-product-label">
                    {label}
                    {badge ? <span className="brand-menu-badge">{badge}</span> : null}
                </span>
                {description ? (
                    <span className="brand-menu-product-description">{description}</span>
                ) : null}
            </span>
        </a>
    )
}

function MobileSection({ title, links, onNavigate }) {
    const [expanded, setExpanded] = useState(false)
    const contentId = useId()

    return (
        <section className={`brand-menu-mobile-section${expanded ? ' is-expanded' : ''}`}>
            <button
                type="button"
                className="brand-menu-section-trigger"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => setExpanded((current) => !current)}
            >
                <span>{title}</span>
                <ChevronDownIcon className="brand-menu-section-chevron" />
            </button>
            <div id={contentId} className="brand-menu-section-content" hidden={!expanded}>
                {links.map((item) => (
                    <MenuLink key={item.label} {...item} onNavigate={onNavigate} />
                ))}
            </div>
        </section>
    )
}

function BrandMenuContents({ mobile, onNavigate }) {
    if (mobile) {
        return (
            <>
                <section className="brand-menu-app-section">
                    <p className="brand-menu-heading">App</p>
                    <div className="brand-menu-app-links">
                        {APP_LINKS.map((item) => (
                            <MenuLink key={item.label} {...item} appLink onNavigate={onNavigate} />
                        ))}
                    </div>
                </section>
                <div className="brand-menu-mobile-groups">
                    <MobileSection title="Products" links={PRODUCT_LINKS} onNavigate={onNavigate} />
                    <MobileSection title="Protocol" links={PROTOCOL_LINKS} onNavigate={onNavigate} />
                    <MobileSection title="Company" links={COMPANY_LINKS} onNavigate={onNavigate} />
                </div>
            </>
        )
    }

    return (
        <>
            <p className="brand-menu-heading">Products</p>
            <div className="brand-menu-products">
                {PRODUCT_LINKS.map((item) => (
                    <MenuLink key={item.label} {...item} onNavigate={onNavigate} />
                ))}
            </div>
            <div className="brand-menu-columns">
                <section>
                    <p className="brand-menu-heading">Protocol</p>
                    {PROTOCOL_LINKS.map((item) => (
                        <MenuLink key={item.label} {...item} onNavigate={onNavigate} />
                    ))}
                </section>
                <section>
                    <p className="brand-menu-heading">Company</p>
                    {COMPANY_LINKS.map((item) => (
                        <MenuLink key={item.label} {...item} onNavigate={onNavigate} />
                    ))}
                </section>
            </div>
        </>
    )
}

function BrandMenuFooter({ onNavigate }) {
    return (
        <div className="brand-menu-footer">
            <MenuLink {...LEGAL_LINK} onNavigate={onNavigate} />
            <div className="brand-menu-socials">
                <a
                    className="brand-menu-social"
                    href="https://github.com/parsij/PistachioSwap"
                    rel="noopener noreferrer"
                    target="_blank"
                    aria-label="GitHub"
                    onClick={onNavigate}
                >
                    <GitHubIcon />
                </a>
                <a
                    className="brand-menu-social"
                    href="/landing/faq/"
                    aria-label="Help"
                    onClick={onNavigate}
                >
                    <CircleHelp aria-hidden="true" />
                </a>
            </div>
        </div>
    )
}

function BrandMenuPanel({ id, mobile, onNavigate, reducedMotion }) {
    const panelMotion = mobile
        ? {
            initial: { opacity: 0, y: reducedMotion ? 0 : 32 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: reducedMotion ? 0 : 24 },
        }
        : {
            initial: { opacity: 0, scale: reducedMotion ? 1 : 0.97, y: reducedMotion ? 0 : -6 },
            animate: { opacity: 1, scale: 1, y: 0 },
            exit: { opacity: 0, scale: reducedMotion ? 1 : 0.985, y: reducedMotion ? 0 : -4 },
        }

    return (
        <motion.nav
            id={id}
            className={mobile ? 'brand-menu-sheet' : 'brand-menu-dropdown'}
            aria-label="PistachioSwap"
            onClick={mobile ? (event) => event.stopPropagation() : undefined}
            {...panelMotion}
            transition={reducedMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 520, damping: 40, mass: 0.72 }}
        >
            {mobile ? <div className="brand-menu-handle" aria-hidden="true" /> : null}
            <BrandMenuContents mobile={mobile} onNavigate={onNavigate} />
            <BrandMenuFooter onNavigate={onNavigate} />
        </motion.nav>
    )
}

/**
 * Brand mark plus Uniswap-style product menu: logo hover and chevron on desktop, hamburger sheet on mobile.
 * @param {{name: string}} props Brand labels used by the landing-page link.
 * @returns {import('react').ReactElement} Logo home link and product menu trigger.
 * @sideEffects Locks body scroll while the mobile sheet is open.
 */
export default function BrandMenu({ name }) {
    const mobile = useMobileViewport()
    const reducedMotion = useReducedMotion()
    const [open, setOpen] = useState(false)
    const menuId = useId()
    const rootRef = useRef(null)
    const closeTimerRef = useRef(null)

    const cancelScheduledClose = useCallback(() => {
        if (closeTimerRef.current === null) return
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
    }, [])

    const closeMenu = useCallback(() => {
        cancelScheduledClose()
        setOpen(false)
    }, [cancelScheduledClose])

    useEffect(() => () => cancelScheduledClose(), [cancelScheduledClose])

    useEffect(() => {
        if (!open) return undefined

        function onKeyDown(event) {
            if (event.key === 'Escape') closeMenu()
        }

        function onPointerDown(event) {
            if (rootRef.current?.contains(event.target)) return
            const sheet = document.getElementById(menuId)
            if (sheet?.contains(event.target)) return
            closeMenu()
        }

        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('pointerdown', onPointerDown, true)
        }
    }, [closeMenu, menuId, open])

    useEffect(() => {
        if (!open || !mobile) return undefined
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [mobile, open])

    function openFromHover() {
        if (mobile) return
        cancelScheduledClose()
        setOpen(true)
    }

    function leaveFromHover() {
        if (mobile) return
        cancelScheduledClose()
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null
            setOpen(false)
        }, HOVER_CLOSE_DELAY_MS)
    }

    function handleTriggerClick() {
        setOpen((current) => !current)
    }

    const sheet = mobile && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
                {open ? (
                    <motion.div
                        className="brand-menu-backdrop"
                        onClick={closeMenu}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.16 }}
                    >
                        <BrandMenuPanel
                            id={menuId}
                            mobile
                            onNavigate={closeMenu}
                            reducedMotion={reducedMotion}
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>,
            document.body,
        )
        : null

    return (
        <div
            ref={rootRef}
            className="brand-cluster"
            onMouseEnter={openFromHover}
            onMouseLeave={leaveFromHover}
        >
            <a
                className="brand-home"
                href={LANDING_HREF}
                aria-label={`${name} landing page`}
            >
                <img
                    src="/icons/PistachioLogo.svg"
                    alt=""
                    className="brand-logo"
                    draggable="false"
                />
            </a>
            <div className="brand-menu">
                <button
                    type="button"
                    className="brand-menu-trigger"
                    aria-label={open ? 'Close product menu' : 'Open product menu'}
                    aria-expanded={open}
                    aria-haspopup="true"
                    aria-controls={open ? menuId : undefined}
                    onClick={handleTriggerClick}
                >
                    <ChevronDownIcon className={`brand-chevron brand-menu-chevron${open ? ' is-open' : ''}`} />
                    <MenuIcon className="brand-menu-hamburger" />
                </button>
            </div>
            <AnimatePresence>
                {open && !mobile ? (
                    <BrandMenuPanel
                        id={menuId}
                        mobile={false}
                        onNavigate={closeMenu}
                        reducedMotion={reducedMotion}
                    />
                ) : null}
            </AnimatePresence>
            {sheet}
        </div>
    )
}
