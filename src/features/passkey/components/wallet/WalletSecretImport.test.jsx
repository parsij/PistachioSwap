// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Mnemonic, sha256 } from 'ethers'
import { createHash } from 'node:crypto'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalletSecretImport } from './WalletSecretImport.jsx'
import { validatePrivateKey, validateRecoveryWords } from './walletImportValidation.js'

// Adapt only the checksum output to jsdom's byte-array realm; use real SHA-256.
sha256.register((bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()))

function ImportHarness({ mode = 'mnemonic' }) {
    const [words, setWords] = useState(Array(12).fill(''))
    const [value, setValue] = useState('')
    const [pasteError, setPasteError] = useState(false)
    const validation = mode === 'mnemonic' ? validateRecoveryWords(words) : validatePrivateKey(value)
    return <><WalletSecretImport mode={mode} words={words} onWordsChange={setWords} value={value} onChange={setValue} validation={validation} onPasteError={setPasteError} /><button disabled={!validation.valid || pasteError}>Review</button></>
}
function pasteWords(text, index = 1) {
    fireEvent.paste(screen.getByLabelText(`Word ${index}`), { clipboardData: { getData: () => text } })
}
// Only deterministic public test vectors are entered into these tests.
const phrase = `${'abandon '.repeat(11)}about`
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
function mockClipboard(readText) {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
}

describe('hidden wallet import and immediate validation', () => {
    afterEach(() => {
        cleanup()
        if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
        else delete navigator.clipboard
    })

    it('fills every field from standard text/plain clipboard data pasted into any word', () => {
        render(<ImportHarness />)
        const getData = vi.fn((format) => format === 'text/plain' ? phrase : '')
        fireEvent.paste(screen.getByLabelText('Word 8'), { clipboardData: { getData } })
        expect(getData).toHaveBeenCalledWith('text/plain')
        phrase.split(' ').forEach((word, index) => expect(screen.getByLabelText(`Word ${index + 1}`).value).toBe(word))
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it('falls back to legacy text clipboard data and preserves input on empty pastes', () => {
        render(<ImportHarness />)
        fireEvent.paste(screen.getByLabelText('Word 4'), { clipboardData: { getData: (format) => format === 'text' ? phrase : '' } })
        fireEvent.paste(screen.getByLabelText('Word 12'), { clipboardData: { getData: () => '' } })
        expect(screen.getByLabelText('Word 12').value).toBe('about')
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it.each([16, 20, 24, 28, 32])('fills the whole phrase from the Paste button (%s entropy bytes) without reading automatically', async (bytes) => {
        const user = userEvent.setup()
        const words = Mnemonic.fromEntropy(new Uint8Array(bytes).fill(42)).phrase.split(' ')
        const readText = vi.fn().mockResolvedValue(`  ${words.join('\n\t').toUpperCase()}  `)
        mockClipboard(readText)
        render(<ImportHarness />)
        expect(readText).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))
        await user.click(screen.getByRole('button', { name: 'Paste recovery phrase' }))
        await waitFor(() => expect(screen.getByLabelText('Phrase length').value).toBe(String(words.length)))
        words.forEach((word, index) => {
            expect(screen.getByLabelText(`Word ${index + 1}`).value).toBe(word)
            expect(screen.getByLabelText(`Word ${index + 1}`).type).toBe('password')
        })
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
        expect(screen.getByRole('button', { name: 'Paste recovery phrase' }).disabled).toBe(false)
        expect(readText).toHaveBeenCalledOnce()
    })

    it('retains existing words and offers normal paste when clipboard permission is denied', async () => {
        const user = userEvent.setup()
        mockClipboard(vi.fn().mockRejectedValue(new DOMException('Test-only clipboard refusal.', 'NotAllowedError')))
        render(<ImportHarness />)
        pasteWords(phrase)
        await user.click(screen.getByRole('button', { name: 'Paste recovery phrase' }))
        expect((await screen.findByRole('alert')).textContent).toContain('Paste your phrase into any word field instead')
        expect(screen.getByLabelText('Word 12').value).toBe('about')
        expect(screen.getByRole('button', { name: 'Paste recovery phrase' }).disabled).toBe(false)
        pasteWords(phrase)
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it('offers manual paste when clipboard reading is unavailable', async () => {
        const user = userEvent.setup()
        mockClipboard(undefined)
        render(<ImportHarness />)
        await user.click(screen.getByRole('button', { name: 'Paste recovery phrase' }))
        expect(screen.getByRole('alert').textContent).toContain('Clipboard access is unavailable')
        pasteWords(phrase)
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it.each(['', 'abandon about', 'abandon '.repeat(25)])('does not replace existing words with an incomplete or oversized clipboard phrase (%s)', async (text) => {
        const user = userEvent.setup()
        mockClipboard(vi.fn().mockResolvedValue(text))
        render(<ImportHarness />)
        pasteWords(phrase)
        await user.click(screen.getByRole('button', { name: 'Paste recovery phrase' }))
        expect((await screen.findByRole('alert')).textContent).toContain('Nothing was replaced')
        expect(screen.getByLabelText('Word 12').value).toBe('about')
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true)
    })

    it('does not replace newer manual edits after a delayed clipboard prompt', async () => {
        const user = userEvent.setup()
        let resolveRead
        mockClipboard(vi.fn(() => new Promise((resolve) => { resolveRead = resolve })))
        render(<ImportHarness />)
        await user.click(screen.getByRole('button', { name: 'Paste recovery phrase' }))
        fireEvent.change(screen.getByLabelText('Word 1'), { target: { value: 'about' } })
        await act(async () => resolveRead(phrase))
        expect(screen.getByLabelText('Word 1').value).toBe('about')
        expect(screen.getByLabelText('Word 12').value).toBe('')
    })

    it('ignores a delayed clipboard result after leaving the import screen', async () => {
        const user = userEvent.setup()
        let resolveRead
        mockClipboard(vi.fn(() => new Promise((resolve) => { resolveRead = resolve })))
        const onWordsChange = vi.fn()
        const words = Array(12).fill('')
        const { unmount } = render(<WalletSecretImport mode="mnemonic" words={words} onWordsChange={onWordsChange} validation={validateRecoveryWords(words)} />)
        await user.click(screen.getByRole('button', { name: 'Paste recovery phrase' }))
        unmount()
        await act(async () => resolveRead(phrase))
        expect(onWordsChange).not.toHaveBeenCalled()
    })

    it('masks all numbered words by default and reveals them only on request', async () => {
        const user = userEvent.setup()
        render(<ImportHarness />)
        pasteWords(phrase)
        expect(screen.getByRole('group', { name: 'Recovery phrase' })).toBeTruthy()
        for (let index = 1; index <= 12; index++) expect(screen.getByLabelText(`Word ${index}`).type).toBe('password')
        await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))
        for (let index = 1; index <= 12; index++) expect(screen.getByLabelText(`Word ${index}`).type).toBe('text')
        await user.click(screen.getByRole('button', { name: 'Hide recovery phrase' }))
        expect(screen.getByLabelText('Word 12').type).toBe('password')
        expect(screen.getByLabelText('Word 12').value).toBe('about')
    })

    it('checks phrase checksum immediately, before review, without deleting any words', () => {
        render(<ImportHarness />)
        pasteWords('abandon '.repeat(12))
        expect(screen.getByRole('alert').textContent).toContain('Check their order and the last word')
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true)
        expect(screen.getByLabelText('Word 12').value).toBe('abandon')
        expect(screen.getByLabelText('Word 12').getAttribute('aria-describedby')).toBe('pistachio-import-validation')
        fireEvent.change(screen.getByLabelText('Word 12'), { target: { value: 'about' } })
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it.each([16, 20, 24, 28, 32])('accepts pasted BIP-39 phrases with %s entropy bytes and adjusts the word count', (bytes) => {
        const words = Mnemonic.fromEntropy(new Uint8Array(bytes).fill(42)).phrase.split(' ')
        render(<ImportHarness />)
        pasteWords(`  ${words.join('\n\t').toUpperCase()}  `, 5)
        expect(screen.getByLabelText('Phrase length').value).toBe(String(words.length))
        words.forEach((word, index) => expect(screen.getByLabelText(`Word ${index + 1}`).value).toBe(word))
        expect(screen.queryByLabelText(`Word ${words.length + 1}`)).toBeNull()
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it('preserves empty word positions and moves to the next word on Space', async () => {
        const user = userEvent.setup()
        render(<ImportHarness />)
        await user.type(screen.getByLabelText('Word 2'), 'about ')
        expect(screen.getByLabelText('Word 1').value).toBe('')
        expect(screen.getByLabelText('Word 2').value).toBe('about')
        expect(document.activeElement).toBe(screen.getByLabelText('Word 3'))
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true)
    })

    it('rejects oversized pastes without silently truncating or replacing the existing phrase', () => {
        render(<ImportHarness />)
        pasteWords(phrase)
        pasteWords('abandon '.repeat(25))
        expect(screen.getByRole('alert').textContent).toContain('Nothing was replaced')
        expect(screen.getByLabelText('Word 12').value).toBe('about')
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true)
        pasteWords(phrase)
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(false)
    })

    it('does not discard filled words when selecting a shorter phrase', () => {
        render(<ImportHarness />)
        fireEvent.change(screen.getByLabelText('Phrase length'), { target: { value: '24' } })
        fireEvent.change(screen.getByLabelText('Word 24'), { target: { value: 'about' } })
        expect(screen.getByRole('option', { name: '12 words' }).disabled).toBe(true)
        expect(screen.getByRole('option', { name: '21 words' }).disabled).toBe(true)
        fireEvent.change(screen.getByLabelText('Word 24'), { target: { value: '' } })
        expect(screen.getByRole('option', { name: '12 words' }).disabled).toBe(false)
    })

    it('hides revealed secrets when leaving the tab without clearing input', async () => {
        const user = userEvent.setup()
        render(<ImportHarness mode="private-key" />)
        const input = screen.getByLabelText('Private key')
        fireEvent.change(input, { target: { value: '11'.repeat(32) } })
        await user.click(screen.getByRole('button', { name: 'Reveal private key' }))
        expect(input.type).toBe('text')
        const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
        try {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true })
            fireEvent(document, new Event('visibilitychange'))
            expect(input.type).toBe('password')
            expect(input.value).toBe('11'.repeat(32))
        } finally {
            if (descriptor) Object.defineProperty(document, 'hidden', descriptor)
            else delete document.hidden
        }
    })

    it.each(['0'.repeat(64), 'f'.repeat(64), 'g'.repeat(64), '1234'])('preserves invalid private keys and blocks review before import (%s)', (key) => {
        render(<ImportHarness mode="private-key" />)
        const input = screen.getByLabelText('Private key')
        fireEvent.change(input, { target: { value: key } })
        expect(input.type).toBe('password')
        expect(input.value).toBe(key)
        expect(input.getAttribute('aria-invalid')).toBe('true')
        expect(screen.getByRole('alert').textContent).not.toContain(key)
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true)
    })
})
