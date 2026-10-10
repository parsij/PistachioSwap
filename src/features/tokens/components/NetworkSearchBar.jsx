import { Search, X } from 'lucide-react'
import './networkSearchBar.css'

/** Shared network search presentation; queries stay inside the open menu. */
export default function NetworkSearchBar({ value, onChange }) {
    return <div className="network-search-bar">
        <Search aria-hidden="true" />
        <input aria-label="Search networks" placeholder="Search networks" value={value}
            onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false}
            onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    event.currentTarget.closest('[data-network-menu]')?.querySelector('[role="option"]:not(:disabled)')?.focus()
                }
            }} />
        {value && <button type="button" aria-label="Clear network search" onClick={(event) => {
            onChange('')
            event.currentTarget.parentElement.querySelector('input')?.focus()
        }}><X aria-hidden="true" /></button>}
    </div>
}
