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
UNCHAINED_HTTP_URLS_JSON={"1":"https://ethereum.unchained.example","56":"https://bnb.unchained.example"}
UNCHAINED_REQUEST_TIMEOUT_MS=8000
```

Unchained is attempted first for configured chains. If it is unavailable, the existing Alchemy or legacy wallet discovery path remains available as a fallback.

The Unchained balance response is joined against PistachioSwap's established market catalog:

- Curated or established contracts appear in the primary wallet list.
- Unknown contracts are marked `unverified` and placed in the existing **Hidden tokens** section.
- Unknown contracts do not contribute to portfolio value.
- A token appearing in the wallet never makes it eligible for Gas Assist by itself.

## Uniswap rolling 24-hour volume catalog

Configure one or more v3/v4 GraphQL subgraphs per chain:

```dotenv
UNISWAP_TOKEN_LIST_URL=https://tokens.uniswap.org
UNISWAP_SUBGRAPH_URLS_JSON={"1":["https://gateway.thegraph.com/api/KEY/subgraphs/id/ETH_V3_ID"],"8453":["https://gateway.thegraph.com/api/KEY/subgraphs/id/BASE_V3_ID"]}
```

PistachioSwap queries `tokenHourDatas`, adds the previous 24 hours of `volumeUSD`, and aggregates configured protocol versions by chain and contract. Only contracts in the Uniswap default token list are published, so every visible result has curated metadata and a logo.

The endpoint is:

```text
GET /v1/uniswap-volume-tokens?chainId=all&limit=100
```

`chainId=all` means all chains present in `UNISWAP_SUBGRAPH_URLS_JSON`. It does not invent endpoints for unconfigured chains.

Enable this catalog in the web token selector:

```dotenv
VITE_USE_UNISWAP_VOLUME_TOKENS=true
```

The web app fetches the combined catalog once, caches it for two minutes, and filters it locally while the user types. The existing PistachioSwap market catalog remains a fallback and metadata supplement.

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
