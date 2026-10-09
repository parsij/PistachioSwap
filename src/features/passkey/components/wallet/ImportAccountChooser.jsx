import { useState } from 'react'
import './importAccountChooser.css'

export default function ImportAccountChooser({ accounts, selectedAddress, busy, onSelect, onMore, onFind }) {
    const [expectedAddress, setExpectedAddress] = useState('')
    return <section className="pistachio-import-accounts" aria-label="Wallets from this recovery phrase">
        <p className="pistachio-wallet-note">One phrase can have multiple wallets. Select your existing address below, or paste its full address to find it.</p>
        <div className="pistachio-import-account-search">
            <label htmlFor="pistachio-expected-address">Expected wallet address</label>
            <input id="pistachio-expected-address" placeholder="0x…" value={expectedAddress} disabled={busy} autoComplete="off" spellCheck="false" onChange={(event) => setExpectedAddress(event.target.value)} />
            <button type="button" disabled={busy || !/^0x[0-9a-f]{40}$/iu.test(expectedAddress.trim())} onClick={() => onFind(expectedAddress.trim())}>Find wallet</button>
        </div>
        <fieldset className="pistachio-import-account-list" disabled={busy}>
            <legend>Choose wallet address</legend>
            {accounts.map((account) => <label key={account.index} className="pistachio-import-account-option">
                <input type="radio" aria-label={`Pistachio Wallet ${account.index + 1} ${account.address}`} name="import-account" checked={selectedAddress === account.address} onChange={() => onSelect(account.index)} />
                <span><strong>Pistachio Wallet {account.index + 1}</strong><code>{account.address}</code></span>
            </label>)}
        </fieldset>
        {accounts.length < 100 && <button className="pistachio-wallet-secondary" type="button" disabled={busy} onClick={() => onMore(Math.min(100, accounts.length + 10))}>Show more wallets</button>}
        <p className="pistachio-wallet-note">Checks the first 100 standard Ethereum accounts. No funds or wallet secrets are sent to a server.</p>
    </section>
}
