import SwapSettingsPopover from '../../settings/components/SwapSettingsPopover.jsx'
import { SettingsIcon } from '../../../shared/components/AppIcons.jsx'

/** Renders the existing swap tabs and settings trigger without owning their state. */
export default function SwapToolbar({ tabs, activeTab, onTabSelect, settings }) {
    return (
        <div className="swap-toolbar">
            <nav className="swap-tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => onTabSelect(tab)}
                        className={activeTab === tab ? 'swap-tab active' : 'swap-tab'}
                    >
                        {tab}
                    </button>
                ))}
            </nav>
            <SwapSettingsPopover
                settings={settings.value}
                onSettingsChange={settings.onChange}
                defaultSlippageBps={settings.defaultSlippageBps}
                recommendedSlippageBps={settings.recommendedSlippageBps}
            >
                <button type="button" className="settings-button" aria-label={settings.ariaLabel}>
                    <SettingsIcon />
                </button>
            </SwapSettingsPopover>
        </div>
    )
}
