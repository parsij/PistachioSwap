import { getAddress } from 'viem'

import {
    NATIVE_TOKEN_ADDRESS,
    normalizeAddress,
} from '../lib/address.js'
import { validateRemoteImageUrl } from '../lib/http.js'

export type LogoSource =
    | 'curated'
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

const TRUST_WALLET_CHAIN_PATHS: Readonly<Record<number, string>> = Object.freeze({
    1: 'ethereum', 10: 'optimism', 25: 'cronos', 56: 'smartchain',
    100: 'xdai', 130: 'unichain', 137: 'polygon', 146: 'sonic',
    204: 'opbnb', 324: 'zksync', 480: 'worldchain', 1088: 'metis',
    1284: 'moonbeam', 5000: 'mantle', 8453: 'base', 34443: 'mode',
    42161: 'arbitrum', 42220: 'celo', 43114: 'avalanchec',
    59144: 'linea', 80094: 'berachain', 81457: 'blast',
    167000: 'taiko', 534352: 'scroll',
})

const TRUSTED_EXACT_ASSET_IMAGES: Readonly<Record<string, string>> = Object.freeze({
    '100:0xe91d153e0b41518a2ce8dd3d7944fa863463a97d':
        'https://coin-images.coingecko.com/coins/images/11062/large/Identity-Primary-DarkBG.png?1696511004',
    '204:0x4200000000000000000000000000000000000006':
        'https://coin-images.coingecko.com/coins/images/53120/large/wrapped_bnb.png?1735265071',
    '480:0x4200000000000000000000000000000000000006':
        'https://coin-images.coingecko.com/coins/images/50790/large/wETH_32.png?1729214345',
    '1284:0xacc15dc74880c9944775448304b263d191c6077f':
        'https://coin-images.coingecko.com/coins/images/22459/large/Moonbeam_GLMR_ICON.png?1716647586',
    '5000:0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8':
        'https://coin-images.coingecko.com/coins/images/30983/large/mantle.jpeg?1696529822',
    '34443:0x4200000000000000000000000000000000000006':
        'https://coin-images.coingecko.com/coins/images/39726/large/weth.png?1723757432',
    '167000:0xa51894664a773981c6c112c43ce576f315d5b1b6':
        'https://coin-images.coingecko.com/coins/images/38460/large/wETH_32.png?1717593430',
})

const TRUSTED_NATIVE_ASSET_IMAGES: Readonly<Record<string, string>> = Object.freeze({
    ethereum: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
    binancecoin: 'https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png?1696501970',
    'matic-network': 'https://coin-images.coingecko.com/coins/images/4713/large/polygon.png?1698233745',
    'avalanche-2': 'https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png?1696512369',
    celo: 'https://coin-images.coingecko.com/coins/images/11090/large/InjXBNx9_400x400.jpg?1696511031',
    xdai: 'https://coin-images.coingecko.com/coins/images/11062/large/Identity-Primary-DarkBG.png?1696511004',
    moonbeam: 'https://coin-images.coingecko.com/coins/images/22459/large/Moonbeam_GLMR_ICON.png?1716647586',
    mantle: 'https://coin-images.coingecko.com/coins/images/30983/large/mantle.jpeg?1696529822',
    'berachain-bera': 'https://coin-images.coingecko.com/coins/images/25235/large/BERA.png?1738822008',
    'crypto-com-chain': 'https://coin-images.coingecko.com/coins/images/7310/large/cro_token_logo.png?1696507599',
    'metis-token': 'https://coin-images.coingecko.com/coins/images/15595/large/Metis_Black_Bg.png?1702968192',
    'sonic-3': 'https://coin-images.coingecko.com/coins/images/38108/large/200x200_Sonic_Logo.png?1734679256',
})

export function getTrustedNativeAssetImage(coinGeckoId: string) {
    return TRUSTED_NATIVE_ASSET_IMAGES[coinGeckoId] ?? null
}

export function getTrustedExactAssetImage(chainId: number, address: string) {
    const normalized = normalizeAddress(address)
    return normalized
        ? TRUSTED_EXACT_ASSET_IMAGES[`${Number(chainId)}:${normalized}`] ?? null
        : null
}

export function getTrustWalletLogoUrl(chainId: number, address: string) {
    const normalized = normalizeAddress(address)
    const chainPath = TRUST_WALLET_CHAIN_PATHS[Number(chainId)]
    if (!chainPath || !normalized || normalized === NATIVE_TOKEN_ADDRESS) return null
    if (getTrustedExactAssetImage(chainId, normalized)) return null

    const checksum = getAddress(normalized)
    return (
        'https://raw.githubusercontent.com/trustwallet/assets/master/' +
        `blockchains/${chainPath}/assets/${checksum}/logo.png`
    )
}

export function getTokenLogoEntries({
    chainId,
    address,
    curatedImages,
    coinGeckoImage,
    alchemyImage,
    localImage,
    dexScreenerProfile,
}: {
    chainId?: number
    address: string
    curatedImages?: readonly string[] | null
    coinGeckoImage?: string | null
    alchemyImage?: string | null
    localImage?: string | null
    dexScreenerProfile?: {
        tokenAddress: string
        imageUrl: string
    } | null
}) {
    const curated = (curatedImages ?? []).filter(
        (url) => url !== '/icons/token-fallback.svg',
    )
    const localCurated = curated.filter((url) => url.startsWith('/'))
    const remoteCurated = curated.filter((url) => !url.startsWith('/'))
    const values: Array<{ url: string | null; source: LogoSource }> = [
        ...localCurated.map((url) => ({
            url:
                typeof url === 'string' && url.startsWith('/')
                    ? url
                    : validateRemoteImageUrl(url),
            source: 'curated' as const,
        })),
        {
            url:
                typeof localImage === 'string' && localImage.startsWith('/')
                    ? localImage
                    : validateRemoteImageUrl(localImage),
            source: 'local',
        },
        {
            url: getTrustWalletLogoUrl(chainId ?? 56, address),
            source: 'trustwallet',
        },
        {
            url: getTrustedExactAssetImage(chainId ?? 56, address),
            source: 'coingecko',
        },
        {
            url: validateRemoteImageUrl(coinGeckoImage),
            source: 'coingecko',
        },
        ...remoteCurated.map((url) => ({
            url: validateRemoteImageUrl(url),
            source: 'curated' as const,
        })),
        {
            url: validateRemoteImageUrl(alchemyImage),
            source: 'alchemy',
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
        { url: '/icons/token-fallback.svg', source: 'local' },
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
