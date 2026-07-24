# Unchained wallet data and Uniswap volume catalog

PistachioSwap can use two independent token-data paths:

- Self-hosted ShapeShift Unchained for wallet balances.
- Public Uniswap v3/v4 subgraphs for a ranked rolling 24-hour volume catalog.

These services solve different problems. Unchained does not provide the ranked Uniswap token catalog, and the Uniswap subgraphs do not provide wallet inventories.

## Wallet balances through Unchained

Configure one Unchained EVM coinstack endpoint per supported chain. PistachioSwap calls:

```text
GET {UNCHAINED_HTTP_URL}/api/v1/account/{walletAddress}
```

Example backend configuration:

```dotenv
UNCHAINED_ENABLED=true
UNCHAINED_REQUEST_TIMEOUT_MS=8000
UNCHAINED_HTTP_URLS_JSON={"56":"http://127.0.0.1:3000"}
```

Unchained is attempted first for configured chains. If it is unavailable, the existing Alchemy or legacy wallet discovery path remains available as a fallback.
Localhost HTTP endpoints are allowed without `UNCHAINED_ALLOW_INSECURE_HTTP=true`.
Non-localhost endpoints still must use HTTPS. Do not configure a chain unless
its Unchained coinstack is actually running.

The Unchained balance response is joined against PistachioSwap's established market catalog:

- Curated or established contracts appear in the primary wallet list.
- Unknown contracts are marked `unverified` and placed in the existing **Hidden tokens** section.
- Unknown contracts do not contribute to portfolio value.
- A token appearing in the wallet never makes it eligible for Gas Assist by itself.

## Uniswap rolling 24-hour volume catalog

Enable the built-in reviewed subgraph registry with a backend-only The Graph
gateway key:

```dotenv
UNISWAP_VOLUME_ENABLED=true
THE_GRAPH_API_KEY=
UNISWAP_TOKEN_LIST_URL=https://tokens.uniswap.org
UNISWAP_SUBGRAPH_TIMEOUT_MS=12000
UNISWAP_SUBGRAPH_URLS_JSON={}
```

`UNISWAP_SUBGRAPH_URLS_JSON` is an advanced HTTPS override and takes
precedence over the built-in registry. The backend constructs built-in gateway
URLs as:

```text
https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/${SUBGRAPH_ID}
```

The current reviewed built-in registry includes:

| Chain ID | Network | Protocol | Subgraph ID |
| --- | --- | --- | --- |
| 56 | bsc | Uniswap v3 | F85MNzUGYqgSHSHRGgeVMNsdnW1KtZSVgFULumXRZTw2 |

Unsupported chains fall back to the existing PistachioSwap market catalog.
PistachioSwap queries `tokenHourDatas`, adds the previous 24 hours of
`volumeUSD`, and aggregates configured protocol versions by chain and exact
contract address. Only contracts in the Uniswap default token list are
published, so every visible result has curated metadata and a logo.

Build the persisted catalog with:

```bash
pnpm --filter @pistachio/api uniswap-volume-tokens:build
```

The command writes atomically to:

```text
apps/api/data/uniswap-volume-token-catalog.v1.json
```

If `THE_GRAPH_API_KEY` is absent, startup does not crash. The backend serves
the last valid persisted catalog when present; otherwise the frontend continues
using the existing market catalog fallback. Use the audit command to inspect
non-secret configuration status:

```bash
pnpm --filter @pistachio/api uniswap-volume-tokens:audit
```

The endpoint is:

```text
GET /v1/uniswap-volume-tokens?chainId=all&limit=100
```

`chainId=all` means all chains present in `UNISWAP_SUBGRAPH_URLS_JSON`. It does not invent endpoints for unconfigured chains.

Enable this catalog in the web token selector:

```dotenv
VITE_USE_UNISWAP_VOLUME_TOKENS=true
```

The web app fetches the combined persisted catalog once, caches it in the
project's persistent browser token cache, immediately reuses that cache on
future loads, and filters name, symbol, and address locally while the user
types. Exact symbol and address matches rank above substring matches. The
existing PistachioSwap market catalog remains a fallback and metadata
supplement.

## Important limitation

This reproduces a public-subgraph 24-hour Uniswap volume ranking. It is not guaranteed to exactly match app.uniswap.org because Uniswap Labs uses a private Data API for its own interface. Public subgraph indexing delays, protocol-version coverage, and chain configuration can produce differences.

## Smoke checks

```bash
curl 'http://127.0.0.1:3001/v1/wallet-tokens?chainId=all&address=0xYOUR_WALLET'
```

The response should contain `provider: "unchained"` when Unchained was used.

```bash
curl 'http://127.0.0.1:3001/v1/uniswap-volume-tokens?chainId=all&limit=20'
```

The response should contain tokens ordered by descending `volume24hUsd`.
