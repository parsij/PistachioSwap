import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

import { shortenAddress } from '../../services/address.js'

export default function ReceiveDialog({ open, onOpenChange, address }) {
    const [copied, setCopied] = useState(false)

    async function copyAddress() {
        await navigator.clipboard.writeText(address)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
    }

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="wallet-dialog-overlay nested" />
                <Dialog.Content className="wallet-dialog wallet-receive-dialog">
                    <header className="wallet-dialog-header">
                        <Dialog.Title>Receive</Dialog.Title>
                        <Dialog.Close className="wallet-icon-button" aria-label="Close receive dialog">
                            <X aria-hidden="true" />
                        </Dialog.Close>
                    </header>
                    <div className="wallet-network-label">
                        <img src="/icons/BSC.svg" alt="" />
                        <span>BNB Smart Chain</span>
                    </div>
                    <div className="receive-qr">
                        <QRCodeSVG
                            value={address}
                            size={210}
                            level="M"
                            bgColor="#ffffff"
                            fgColor="#191919"
                            title={`Receive at ${address}`}
                        />
                        <img src="/PistachioLogo.svg" alt="" className="receive-brand-mark" />
                    </div>
                    <strong className="receive-short-address">{shortenAddress(address, 6)}</strong>
                    <button type="button" className="receive-address-field" onClick={copyAddress}>
                        <span>{address}</span>
                        <Copy aria-hidden="true" />
                    </button>
                    <button type="button" className="wallet-primary-button" onClick={copyAddress}>
                        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied ? 'Copied' : 'Copy address'}
                    </button>
                    <p className="receive-warning">
                        Only send assets supported on BNB Smart Chain to this address.
                    </p>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
