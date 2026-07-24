export const unchainedLocalChains = Object.freeze([
  { chainId: 1, chain: 'Ethereum', coinstack: 'ethereum', port: 3101 },
  { chainId: 10, chain: 'OP Mainnet', coinstack: 'optimism', port: 3110 },
  { chainId: 56, chain: 'BNB Chain', coinstack: 'bnbsmartchain', port: 3156 },
  { chainId: 100, chain: 'Gnosis Chain', coinstack: 'gnosis', port: 3100 },
  { chainId: 137, chain: 'Polygon PoS', coinstack: 'polygon', port: 3137 },
  { chainId: 8453, chain: 'Base', coinstack: 'base', port: 3453 },
  { chainId: 42161, chain: 'Arbitrum One', coinstack: 'arbitrum', port: 3161 },
  { chainId: 43114, chain: 'Avalanche C-Chain', coinstack: 'avalanche', port: 3114 },
])

export function unchainedHttpUrlsJson() {
  return JSON.stringify(Object.fromEntries(
    unchainedLocalChains.map(({ chainId, port }) => [
      String(chainId),
      `http://127.0.0.1:${port}`,
    ]),
  ))
}
