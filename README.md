Hello World!

# PistachioSwap Lite

React/Vite frontend with a Fastify/TypeScript backend for BNB Chain token
discovery, wallet balances, market data, and normalized swap quotes.

## Market data

- GeckoTerminal discovers candidate addresses from top BNB Chain pools.
- DexScreener supplies search results, pair data, prices, liquidity, volume,
  pair URLs, and secondary token images.
- Alchemy supplies ERC-20 metadata, wallet balances, optional prices, and BNB
  Chain RPC access.
- The empty-query catalog caches for 10 minutes and uses stale-while-revalidate.
  Search results use independent five-minute query caches.

Pair aggregation counts each `chain + dex + pair address` once. A pair assigns
half of its 24-hour volume and liquidity to each distinct token side. This
prevents the same pair's full market activity from being counted twice when
both assets are present in the catalog.

Native BNB uses the documented sentinel
`0x0000000000000000000000000000000000000000`. It maps to configured WBNB only
for market-data and direct-routing calls that require an ERC-20 address.

## Quotes

`POST /v1/quote` and `POST /v1/swap/build` return one normalized executable
quote plus summaries for every attempted provider. Best mode waits for all
enabled providers and selects the largest net buy-token amount. Gas is not
deducted unless it can be converted reliably.

Supported adapters are Uniswap Trading API, 0x Swap API, and a configured
PancakeSwap V3 router/quoter. PancakeSwap direct routes report zero platform
fee unless a reviewed fee-executor integration is available. The current code
rejects executor-contract fee mode inside the PancakeSwap adapter rather than
claiming that an unimplemented fee is collected.

Gas Assist implementation and operational notes are in
[`docs/gas-assist.md`](docs/gas-assist.md). Gas Assist is disabled by default.

## Development

```bash
pnpm install
pnpm --filter @pistachio/api dev
pnpm dev --host 127.0.0.1
```

Backend variables belong in `apps/api/.env`; see `apps/api/.env.example`.
Only public browser configuration belongs in root `.env.local`; see
`.env.example`.

```bash
pnpm lint
pnpm --filter @pistachio/api typecheck
pnpm test
pnpm build
```

## Reown AppKit origins

Add these origins to the allowlist for the supplied project in the Reown
Dashboard:

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `https://pistachioswap.com`
- `https://www.pistachioswap.com`

AppKit metadata uses `window.location.origin`. The browser origin must exactly
match an allowed Dashboard origin.