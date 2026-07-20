import SettingsToggleRow from './SettingsToggleRow.jsx'

/**
 * Renders the persisted token-visibility toggles.
 * @param {object} props Current normalized settings and semantic update callback.
 * @param {object} props.settings Persisted settings object.
 * @param {(settings: object) => void} props.onSettingsChange Receives the full next settings object.
 * @returns {import('react').ReactElement} Existing toggle rows with tooltips.
 * @sideEffects Delegates persistence to the parent settings hook; no storage access occurs here.
 */
export default function SettingsVisibilitySection({ settings, onSettingsChange }) {
    return <>
        <SettingsToggleRow label="Hide unknown tokens" tooltip="Unverified, spam-like, and potentially risky tokens will be hidden from your portfolio." checked={settings.hideUnknownTokens} onCheckedChange={(checked) => onSettingsChange({ ...settings, hideUnknownTokens: checked })} />
        <SettingsToggleRow label="Hide small balances" tooltip="Balances under 20 cents will be hidden from your portfolio." checked={settings.hideSmallBalances} onCheckedChange={(checked) => onSettingsChange({ ...settings, hideSmallBalances: checked })} />
    </>
}
