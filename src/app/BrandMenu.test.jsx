// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BrandMenu from './BrandMenu.jsx'

function installMatchMedia(mobile) {
    window.matchMedia = vi.fn((query) => ({
        matches: query === '(max-width: 640px)' ? mobile : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }))
}

describe('brand menu', () => {
    afterEach(() => {
        cleanup()
        vi.useRealTimers()
        vi.restoreAllMocks()
        document.body.style.overflow = ''
    })

    describe('desktop', () => {
        beforeEach(() => {
            installMatchMedia(false)
        })

        it('sends the pistachio icon to the landing page', () => {
            render(<BrandMenu name="PistachioSwap" />)
            expect(screen.getByRole('link', { name: 'PistachioSwap landing page' }).getAttribute('href'))
                .toBe('/landing/')
        })

        it('opens on chevron hover and stays closed when hovering the logo', () => {
            render(<BrandMenu name="PistachioSwap" />)

            fireEvent.mouseEnter(screen.getByRole('link', { name: 'PistachioSwap landing page' }))
            expect(screen.queryByRole('navigation', { name: 'PistachioSwap' })).toBeNull()

            fireEvent.mouseEnter(document.querySelector('.brand-menu'))
            const menu = screen.getByRole('navigation', { name: 'PistachioSwap' })
            expect(menu.className).toContain('brand-menu-dropdown')
            expect(screen.getByRole('link', { name: /Trade/ }).getAttribute('href')).toBe('/')
            expect(screen.getByRole('link', { name: /Gas Assist/ }).getAttribute('href'))
                .toBe('/landing/gas-assist/')
            expect(screen.getByRole('link', { name: /About/ }).getAttribute('href'))
                .toBe('/landing/')
            expect(screen.getByRole('link', { name: /FAQ/ }).getAttribute('href'))
                .toBe('/landing/faq/')
        })

        it('closes after the pointer leaves the triangle', () => {
            vi.useFakeTimers()
            render(<BrandMenu name="PistachioSwap" />)

            fireEvent.mouseEnter(document.querySelector('.brand-menu'))
            expect(screen.getByRole('navigation', { name: 'PistachioSwap' })).toBeTruthy()

            fireEvent.mouseLeave(document.querySelector('.brand-menu'))
            act(() => {
                vi.advanceTimersByTime(120)
            })
            expect(screen.queryByRole('navigation', { name: 'PistachioSwap' })).toBeNull()
        })
    })

    describe('mobile', () => {
        beforeEach(() => {
            installMatchMedia(true)
        })

        it('keeps the logo as a landing link and opens a bottom sheet from the hamburger', () => {
            render(<BrandMenu name="PistachioSwap" />)

            expect(screen.getByRole('link', { name: 'PistachioSwap landing page' }).getAttribute('href'))
                .toBe('/landing/')

            fireEvent.mouseEnter(document.querySelector('.brand-menu'))
            expect(screen.queryByRole('navigation', { name: 'PistachioSwap' })).toBeNull()

            fireEvent.click(screen.getByRole('button', { name: 'Open product menu' }))
            const menu = screen.getByRole('navigation', { name: 'PistachioSwap' })
            expect(menu.className).toContain('brand-menu-sheet')
            expect(menu.querySelector('.brand-menu-handle')).toBeTruthy()
            expect(menu.parentElement.className).toContain('brand-menu-backdrop')
        })

        it('closes the sheet on escape', () => {
            render(<BrandMenu name="PistachioSwap" />)
            fireEvent.click(screen.getByRole('button', { name: 'Open product menu' }))
            fireEvent.keyDown(document, { key: 'Escape' })
            expect(screen.queryByRole('navigation', { name: 'PistachioSwap' })).toBeNull()
        })
    })

    it('shows a chevron on desktop and a hamburger on mobile', () => {
        const css = readFileSync(resolve('src/index.css'), 'utf8')
        expect(css).toMatch(/\.brand-menu-hamburger\s*\{[^}]*display:\s*none/)
        expect(css).toMatch(
            /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.brand-menu-chevron\s*\{[^}]*display:\s*none/,
        )
        expect(css).toMatch(
            /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.brand-menu-hamburger\s*\{[^}]*display:\s*block/,
        )
        expect(css).toMatch(/\.brand-menu-sheet\s*\{[^}]*border-radius:\s*24px 24px 0 0/)
        expect(css).toMatch(/\.brand-menu-backdrop\s*\{[^}]*align-items:\s*end/)
    })
})
