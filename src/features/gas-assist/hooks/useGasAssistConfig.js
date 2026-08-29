// Compatibility export for callers that still use the former hook name.
// Configuration now comes exclusively from the atomic/prepaid sponsorship API.
export {
    useSponsorshipConfig as useGasAssistConfig,
    sponsorshipConfigInternals as gasAssistConfigInternals,
} from './useSponsorshipConfig.js'
