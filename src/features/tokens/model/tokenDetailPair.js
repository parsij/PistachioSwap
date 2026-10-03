import { CANONICAL_NATIVE_TOKEN_ADDRESS, getCuratedEvmChain, getCuratedEvmChainLogoUri, getWrappedNativeTokenAddress } from '../../../web3/curatedEvmChains.js'

export function tokenDetailSellToken(token, catalog) {
    const chain = getCuratedEvmChain(token?.chainId)
    if (!chain) return null
    const native = token?.isNative || String(token?.address).toLowerCase() === CANONICAL_NATIVE_TOKEN_ADDRESS
    const address = native ? getWrappedNativeTokenAddress(chain.id) : CANONICAL_NATIVE_TOKEN_ADDRESS
    const available = catalog.find((candidate) => Number(candidate.chainId) === chain.id && String(candidate.address).toLowerCase() === address)
    if (available || native) return available ?? null
    return { chainId: chain.id, address, isNative: true, ...chain.nativeCurrency, logoURI: getCuratedEvmChainLogoUri(chain.id), source: 'static-fallback' }
}
