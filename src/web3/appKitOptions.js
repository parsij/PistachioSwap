// Content-sized wallet chooser. Full-screen mode creates a tall scrollable
// router even when the installed-wallet list leaves most of the viewport empty.
export const APPKIT_ENABLE_MOBILE_FULL_SCREEN = false

export const APPKIT_CONNECTOR_TYPE_ORDER = Object.freeze([
    'external',
    'walletConnect',
    'recent',
    'injected',
    'featured',
    'custom',
    'recommended',
])
