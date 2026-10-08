import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isRecoveryWord, RECOVERY_WORD_COUNTS } from './walletImportValidation.js'

export function WalletSecretImport({ mode, words, onWordsChange, value, onChange, validation, error, disabled, onPasteError }) {
    const [revealed, setRevealed] = useState(false)
    const [pasteError, setPasteError] = useState('')
    const inputs = useRef([])
    const mnemonic = mode === 'mnemonic'
    const label = mnemonic ? 'recovery phrase' : 'private key'
    useEffect(() => {
        const hideWhenAway = () => { if (document.hidden) setRevealed(false) }
        document.addEventListener('visibilitychange', hideWhenAway)
        return () => document.removeEventListener('visibilitychange', hideWhenAway)
    }, [])
    useEffect(() => { if (disabled) setRevealed(false) }, [disabled])

    function changeWord(index, text) {
        const entered = text.normalize('NFKD').trim().toLowerCase().split(/\s+/u).filter(Boolean)
        if (entered.length > 24 || (entered.length > 1 && !RECOVERY_WORD_COUNTS.includes(entered.length) && index + entered.length > 24)) {
            setPasteError('A recovery phrase must contain 12, 15, 18, 21, or 24 words. Nothing was replaced.')
            onPasteError?.(true)
            return
        }
        setPasteError('')
        onPasteError?.(false)
        // Pasting a whole phrase replaces the grid, even when a later word has focus.
        if (entered.length > 1 && RECOVERY_WORD_COUNTS.includes(entered.length)) {
            onWordsChange(entered)
            return
        }
        const required = Math.max(words.length, index + entered.length)
        const count = RECOVERY_WORD_COUNTS.find((size) => size >= required)
        const next = Array.from({ length: count }, (_, position) => words[position] ?? '')
        if (!entered.length) next[index] = ''
        else entered.forEach((word, offset) => { next[index + offset] = word })
        onWordsChange(next)
    }

    return (
        <div className="pistachio-secret-import">
            <div className="pistachio-secret-heading">
                {mnemonic ? <label htmlFor="pistachio-import-word-count">Phrase length</label> : <label htmlFor="pistachio-wallet-secret">Private key</label>}
                <button className="pistachio-secret-reveal" type="button" aria-pressed={revealed} disabled={disabled} onClick={() => setRevealed((current) => !current)}>
                    {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    {revealed ? 'Hide' : 'Reveal'} {label}
                </button>
            </div>
            {mnemonic ? (
                <>
                    <select id="pistachio-import-word-count" value={words.length} disabled={disabled} onChange={(event) => {
                        const count = Number(event.target.value)
                        setPasteError('')
                        onPasteError?.(false)
                        onWordsChange(Array.from({ length: count }, (_, index) => words[index] ?? ''))
                    }}>
                        {RECOVERY_WORD_COUNTS.map((count) => <option key={count} value={count} disabled={words.slice(count).some(Boolean)}>{count} words</option>)}
                    </select>
                    <fieldset className="pistachio-import-words">
                        <legend className="pistachio-sr-only">Recovery phrase</legend>
                        {words.map((word, index) => {
                            const invalid = Boolean(word) && !isRecoveryWord(word)
                            const errorId = `pistachio-import-word-${index}-error`
                            return (
                                <div className="pistachio-import-word" key={index}>
                                    <label htmlFor={`pistachio-import-word-${index}`}>
                                        <span aria-hidden="true">{index + 1}</span>
                                        <span className="pistachio-sr-only">Word {index + 1}</span>
                                    </label>
                                    <input id={`pistachio-import-word-${index}`} aria-label={`Word ${index + 1}`} ref={(element) => { inputs.current[index] = element }} type={revealed ? 'text' : 'password'} value={word} disabled={disabled} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" aria-invalid={invalid} aria-describedby={invalid ? errorId : validation.error || pasteError ? 'pistachio-import-validation' : error ? 'pistachio-wallet-error' : 'pistachio-import-help'} onChange={(event) => changeWord(index, event.target.value)} onPaste={(event) => {
                                        event.preventDefault()
                                        changeWord(index, event.clipboardData.getData('text'))
                                    }} onKeyDown={(event) => {
                                        if ((event.key === ' ' || event.key === 'Enter') && word) {
                                            event.preventDefault()
                                            inputs.current[index + 1]?.focus()
                                        }
                                    }} />
                                    {invalid && <span className="pistachio-import-word-error" id={errorId} role="alert">Invalid word</span>}
                                </div>
                            )
                        })}
                    </fieldset>
                </>
            ) : <input id="pistachio-wallet-secret" type={revealed ? 'text' : 'password'} value={value} disabled={disabled} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" aria-invalid={Boolean(validation.error || error)} aria-describedby={validation.error ? 'pistachio-import-validation' : error ? 'pistachio-wallet-error' : 'pistachio-import-help'} onChange={(event) => onChange(event.target.value)} />}
            {(pasteError || validation.error) && <p className="pistachio-import-validation" id="pistachio-import-validation" role="alert">{pasteError || validation.error}</p>}
            <p className="pistachio-wallet-note" id="pistachio-import-help">{mnemonic ? 'Enter each word in order, or paste your whole phrase into any word. Extra BIP-39 passphrases are not supported.' : 'Enter exactly 64 hexadecimal characters, with or without 0x. This wallet will not have a recovery phrase.'}</p>
        </div>
    )
}
