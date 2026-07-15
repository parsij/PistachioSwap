const PUBLIC_BRANDING_ASSETS = [
    '/PistachioLogo.svg',
    '/favicon.svg',
]

export function selectBrandingPath(availableAssets) {
    return PUBLIC_BRANDING_ASSETS.find((asset) =>
        availableAssets.includes(asset),
    ) ?? null
}

export function createAppMetadata({
    origin,
    availableAssets = PUBLIC_BRANDING_ASSETS,
}) {
    const iconPath = selectBrandingPath(availableAssets)

    return {
        name: 'PistachioSwap',
        description: 'Swap tokens on BNB Chain',
        url: origin,
        icons: iconPath
            ? [new URL(iconPath, origin).href]
            : [],
    }
}
