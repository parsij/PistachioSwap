import { getAddress } from 'viem'

import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../lib/address.js'
import { validateRemoteImageUrl } from '../lib/http.js'

export type LogoSource =
    | 'coingecko'
    | 'trustwallet'
    | 'alchemy'
    | 'local'
    | 'dexscreener-profile'
    | 'fallback'

export type TokenLogoEntry = {
    url: string
    source: Exclude<LogoSource, 'fallback'>
}

export function getTrustWalletLogoUrl(address: string) {
    const normalized = normalizeAddress(address)
    if (!normalized || normalized === NATIVE_TOKEN_ADDRESS) return null

    const checksum = getAddress(normalized)
    return (
        'https://raw.githubusercontent.com/trustwallet/assets/master/' +
        `blockchains/smartchain/assets/${checksum}/logo.png`
    )
}

export function getTokenLogoEntries({
    address,
    coinGeckoImage,
    alchemyImage,
    localImage,
    dexScreenerProfile,
}: {
    address: string
    coinGeckoImage?: string | null
    alchemyImage?: string | null
    localImage?: string | null
    dexScreenerProfile?: {
        tokenAddress: string
        imageUrl: string
    } | null
}) {
    const values: Array<{ url: string | null; source: LogoSource }> = [
        {
            url: validateRemoteImageUrl(coinGeckoImage),
            source: 'coingecko',
        },
        {
            url: getTrustWalletLogoUrl(address),
            source: 'trustwallet',
        },
        {
            url: validateRemoteImageUrl(alchemyImage),
            source: 'alchemy',
        },
        {
            url:
                typeof localImage === 'string' &&
                localImage.startsWith('/')
                    ? localImage
                    : validateRemoteImageUrl(localImage),
            source: 'local',
        },
        {
            url:
                normalizeAddress(dexScreenerProfile?.tokenAddress) ===
                normalizeAddress(address)
                    ? validateRemoteImageUrl(
                          dexScreenerProfile?.imageUrl,
                      )
                    : null,
            source: 'dexscreener-profile',
        },
    ]
    const seen = new Set<string>()
    return values.filter(({ url }) => {
        if (!url || seen.has(url)) return false
        seen.add(url)
        return true
    }) as TokenLogoEntry[]
}

export function buildTokenLogo(
    input: Parameters<typeof getTokenLogoEntries>[0],
) {
    const candidates = getTokenLogoEntries(input)

    return {
        logoURI: candidates[0]?.url ?? null,
        logoCandidates: candidates.map(({ url }) => url),
        logoSource: candidates[0]?.source ?? ('fallback' as const),
    }
}
