import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, BookOpen, CircleHelp, Fuel } from 'lucide-react'

import { ChevronDownIcon, GitHubIcon, MenuIcon } from '../shared/components/AppIcons.jsx'

const LANDING_HREF = '/landing/'
const MOBILE_MEDIA = '(max-width: 640px)'
const HOVER_CLOSE_DELAY_MS = 120

const APP_LINKS = [
    {
        href: '/',
        label: 'Trade',
        description: 'Swap tokens',
        Icon: ArrowLeftRight,
    },
    {
        href: '/landing/gas-assist/',
        label: 'Gas Assist',
        description: 'Cover swap gas',
        Icon: Fuel,
    },
    {
        href: '/landing/',
        label: 'About',
        description: 'What Pistachio is',
        Icon: BookOpen,
    },
    {
        href: '/landing/faq/',
        label: 'FAQ',
        description: 'Common questions',
        Icon: CircleHelp,
    },
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

function MenuLink({ href, label, description, Icon, external, onNavigate }) {
    const rel = external ? 'noopener noreferrer' : undefined
    const target = external ? '_blank' : undefined

    return (
        <a
            className={description ? 'brand-menu-product' : 'brand-menu-link'}
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
                <span className="brand-menu-product-label">{label}</span>
                {description ? (
                    <span className="brand-menu-product-description">{description}</span>
                ) : null}
            </span>
        </a>
    )
}

function BrandMenuPanel({ id, mobile, onNavigate }) {
    return (
        <nav
            id={id}
            className={mobile ? 'brand-menu-sheet' : 'brand-menu-dropdown'}
            aria-label="PistachioSwap"
            onClick={mobile ? (event) => event.stopPropagation() : undefined}
        >
            {mobile ? <div className="brand-menu-handle" aria-hidden="true" /> : null}
            <p className="brand-menu-heading">App</p>
            <div className="brand-menu-products">
                {APP_LINKS.map((item) => (
                    <MenuLink key={item.label} {...item} onNavigate={onNavigate} />
                ))}
            </div>
            <div className="brand-menu-footer">
                <MenuLink {...LEGAL_LINK} onNavigate={onNavigate} />
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
            </div>
        </nav>
    )
}

/**
 * Brand mark plus Uniswap-style product menu: hover chevron on desktop, hamburger bottom sheet on mobile.
 * @param {{name: string}} props Brand labels used by the landing-page link.
 * @returns {import('react').ReactElement} Logo home link and product menu trigger.
 * @sideEffects Locks body scroll while the mobile sheet is open.
 */
export default function BrandMenu({ name }) {
    const mobile = useMobileViewport()
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
        if (mobile) {
            setOpen((current) => !current)
            return
        }
        setOpen(true)
    }

    const sheet = open && mobile && typeof document !== 'undefined'
        ? createPortal(
            <div className="brand-menu-backdrop" onClick={closeMenu}>
                <BrandMenuPanel
                    id={menuId}
                    mobile
                    onNavigate={closeMenu}
                />
            </div>,
            document.body,
        )
        : null

    return (
        <div className="brand-cluster">
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
            <div
                ref={rootRef}
                className="brand-menu"
                onMouseEnter={openFromHover}
                onMouseLeave={leaveFromHover}
            >
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
                {open && !mobile ? (
                    <BrandMenuPanel id={menuId} mobile={false} onNavigate={closeMenu} />
                ) : null}
            </div>
            {sheet}
        </div>
    )
}
