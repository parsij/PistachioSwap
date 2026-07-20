import * as Popover from '@radix-ui/react-popover'

import SlippageSettingsSection from './SlippageSettingsSection.jsx'
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
                <SettingsVisibilitySection settings={settings} onSettingsChange={onSettingsChange} />
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>
}
