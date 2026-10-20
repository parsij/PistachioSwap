import * as Popover from '@radix-ui/react-popover'

import SlippageSettingsSection from './SlippageSettingsSection.jsx'
import InfoTooltip from './InfoTooltip.jsx'
import SettingsToggleRow from './SettingsToggleRow.jsx'
import SettingsVisibilitySection from './SettingsVisibilitySection.jsx'
import { useSwapSettingsPopover } from '../hooks/useSwapSettingsPopover.js'
import './SwapSettingsPopover.css'

/**
 * Composes the persisted swap-settings trigger and Radix portal.
 * @param {object} props
 * @param {import('react').ReactNode} props.children Existing trigger element; its classes/children are preserved.
 * @param {object} props.settings Normalized persisted settings from `useSwapSettings`.
 * @param {(settings: object) => void} props.onSettingsChange Receives normalized full settings objects.
 * @returns {import('react').ReactElement} Existing popover trigger and content.
 * @sideEffects Delegates persistence and draft focus behavior to settings hooks; presentation performs no storage/network calls.
 * @accessibility Preserves Radix dialog, portal, focus prevention, Escape handling, labels, and existing CSS classes.
 */
export default function SwapSettingsPopover({ children, settings, onSettingsChange }) {
    const { open, settingsTrigger, handleOpenChange, draft } = useSwapSettingsPopover({ children, settings, onSettingsChange })
    return <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>{settingsTrigger}</Popover.Trigger>
        <Popover.Portal>
            <Popover.Content className="swap-settings-popover" side="bottom" align="end" sideOffset={10} collisionPadding={12} avoidCollisions onOpenAutoFocus={(event) => {
                event.preventDefault()
                if (settings.slippageMode === 'custom') draft.customInputRef.current?.focus()
                else draft.autoButtonRef.current?.focus()
            }}>
                <SlippageSettingsSection draft={draft} />
                <SettingsToggleRow label="One-confirmation swaps"
                    tooltip="Use Gas Assist to bundle the token charge, approval and swap. Review once, then authorize with one passkey in Pistachio Wallet on eligible routes. A token service charge applies even if you have native gas. Delegation persists; replacing another wallet’s delegation requires a separate review. External wallets control their own prompts."
                    checked={settings.gasAssistPreference === 'force'}
                    onCheckedChange={(enabled) => onSettingsChange({ ...settings, gasAssistPreference: enabled ? 'force' : 'auto' })} />
                <p className="swap-settings-smart-swap-note">Pistachio Wallet + Gas Assist. Eligible routes only; the quoted token service charge applies. Review is always required.</p>
                <div className="swap-settings-gas-assist">
                    <div className="settings-row-label"><label htmlFor="swap-gas-assist-preference">Gas Assist</label><InfoTooltip label="Auto uses Gas Assist when gas is low. Force requires an eligible token and enabled network. Normal gas uses your wallet’s native balance." /></div>
                    <select id="swap-gas-assist-preference" aria-label="Gas Assist preference" value={settings.gasAssistPreference ?? 'auto'} onChange={(event) => onSettingsChange({ ...settings, gasAssistPreference: event.target.value })}>
                        <option value="auto">Auto</option>
                        <option value="force">One-confirmation (Gas Assist)</option>
                        <option value="normal">Normal gas</option>
                    </select>
                </div>
                <SettingsToggleRow label="Auto network cost"
                    tooltip="Turn this off to choose Less, Standard, High, or custom native gas fees in the expanded swap details. Automatic fees follow the network and your wallet. Gas Assist fees are managed separately."
                    checked={settings.autoNetworkCost !== false}
                    onCheckedChange={(autoNetworkCost) => onSettingsChange({ ...settings, autoNetworkCost })} />
                <SettingsVisibilitySection settings={settings} onSettingsChange={onSettingsChange} />
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>
}
