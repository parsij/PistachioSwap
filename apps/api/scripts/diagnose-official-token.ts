import { multiplyDecimal } from '../src/providers/alchemy/wallet-tokens.js'
import { getOfficialAsset } from '../src/providers/recognition/curated-token-lists.js'

function argument(name: string, fallback: string) {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const chainId = Number(argument('chain-id', '56'))
const address = argument(
    'address',
    '0x21caef8a43163eea865baee23b9c2e327696a3bf',
).toLowerCase()
const balance = argument('balance', '')
const marketPriceUSD = argument('market-price', '')
const asset = getOfficialAsset(chainId, address)
const validBalance = /^\d+(?:\.\d+)?$/.test(balance) ? balance : null
const validMarketPrice = /^\d+(?:\.\d+)?$/.test(marketPriceUSD)
    ? marketPriceUSD
    : null
const valueUSD = validBalance && validMarketPrice
    ? multiplyDecimal(validBalance, validMarketPrice)
    : null

process.stdout.write(`${JSON.stringify({
    chainId,
    address: address.length === 42
        ? `${address.slice(0, 8)}...${address.slice(-4)}`
        : 'invalid',
    curatedMatch: asset !== null,
    officialAsset: asset?.officialAsset === true,
    recognitionStatus: asset?.recognitionStatus ?? 'unverified',
    verifiedContract: asset?.verifiedContract ?? false,
    visibility: asset ? 'primary' : 'unverified',
    logoSource: asset ? 'curated' : 'fallback',
    hasMarketPrice: validMarketPrice !== null,
    hasUsdValue: valueUSD !== null,
}, null, 2)}\n`)
