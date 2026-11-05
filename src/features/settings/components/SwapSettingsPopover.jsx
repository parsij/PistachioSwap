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
                    tooltip="Use one Pistachio Wallet unlock for eligible Gas Assist swaps, independently of Auto or Force Gas Assist. Ordinary swaps use one transaction confirmation when an allowance is already available; a new ERC-20 or Permit2 approval still needs its own authorization. Does not remove review, charges, or EIP-7702 delegation risks."
                    checked={settings.oneConfirmationEnabled === true}
                    onCheckedChange={(oneConfirmationEnabled) => onSettingsChange({ ...settings, oneConfirmationEnabled })} />
                <p className="swap-settings-smart-swap-note">Applies to Pistachio Wallet on supported routes. Auto and Force Gas Assist can both use a single unlock; normal gas swaps may still require a separate token approval. Sponsorship charges apply only to Gas Assist.</p>
                <div className="swap-settings-gas-assist">
                    <div className="settings-row-label"><label htmlFor="swap-gas-assist-preference">Gas Assist</label><InfoTooltip label="Auto uses Gas Assist when normal network gas is insufficient. Force requests Gas Assist even when gas is available, with a quoted token service charge. Off uses native gas and never requests sponsorship." /></div>
                    <select id="swap-gas-assist-preference" aria-label="Gas Assist preference" value={settings.gasAssistPreference ?? 'auto'} onChange={(event) => onSettingsChange({ ...settings, gasAssistPreference: event.target.value })}>
                        <option value="auto">Auto</option>
                        <option value="force">Force Gas Assist</option>
                        <option value="normal">Off (normal gas)</option>
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
