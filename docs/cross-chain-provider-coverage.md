# Cross-chain provider coverage

## Curated application chains

The product registry contains exactly these 25 EVM networks:

| Chain ID | Display name | Native symbol |
|---:|---|---|
| 1 | Ethereum | ETH |
| 56 | BNB Smart Chain | BNB |
| 137 | Polygon PoS | POL |
| 42161 | Arbitrum One | ETH |
| 10 | OP Mainnet | ETH |
| 8453 | Base | ETH |
| 43114 | Avalanche C-Chain | AVAX |
| 42220 | Celo | CELO |
| 100 | Gnosis Chain | xDAI |
| 59144 | Linea | ETH |
| 534352 | Scroll | ETH |
| 324 | ZKsync Era | ETH |
| 5000 | Mantle | MNT |
| 146 | Sonic | S |
| 80094 | Berachain | BERA |
| 130 | Unichain | ETH |
| 480 | World Chain | ETH |
| 81457 | Blast | ETH |
| 34443 | Mode | ETH |
| 1088 | Metis Andromeda | METIS |
| 25 | Cronos | CRO |
| 1284 | Moonbeam | GLMR |
| 167000 | Taiko | ETH |
| 204 | opBNB | BNB |
| 1101 | Polygon zkEVM | ETH |

All 25 are enabled for wallet Send, same-chain quote requests, and as candidate
cross-chain source/destination networks. Same-chain 0x and Uniswap support is
still determined by an exact current quote; PancakeSwap remains BNB-specific.
Gasless and MegaFuel remain BNB Smart Chain-only. Candidate means the request
validator and wallet can represent the chain; it does not mean every provider
has a route or token pair.

## Provider coverage is dynamic

| Provider | Capability source | Route granularity | Execution |
|---|---|---|---|
| Across | `/available-routes` | exact chain and token pair with contract metadata | validated EVM transaction |
| deBridge DLN | `/supported-chains-info` plus verified source deployments | exact chain pair; token checked at quote | validated EVM transaction |
| Relay | `/chains` contract metadata | exact chain pair; token checked at quote | ordered validated EVM transactions |
| Chainflip | SDK mainnet chain/asset catalog | exact EVM chain and asset pair | prepared deposit channel |

The authoritative coverage matrix is generated at run time:

```sh
pnpm --dir apps/api debug:cross-chain-providers
```

It performs bounded read-only discovery across all 25 chains and at most one indicative quote attempt per provider. `SUPPORTED` means current metadata contains the direction; `PARTIAL` means discovery/quote evidence exists but authentication or execution configuration is incomplete; `SKIPPED` means configuration prevents a request; `UNSUPPORTED` means no exact current capability exists. The output is evidence for that run only.

Chainflip coverage can be much smaller than the other providers because only its current EVM-mainnet asset intersection is eligible. Live Chainflip verification is partial until broker configuration and a controlled manual prepare/deposit/status test are completed. The diagnostic never requests a deposit address.

## Exclusions and limitations

LI.FI is not used. It is absent from runtime dependencies, endpoints, environment settings, adapters, registry entries, fallback behavior, and UI provider labels. Guard tests scan those surfaces while excluding these explanatory documents from string matching.

No static table should claim all-to-all provider support. Coverage varies by token, direction, amount, liquidity, contract metadata, authentication tier, fee compatibility, and provider health. A capability can disappear before quote time; refresh after cache expiry or configuration changes. Unsupported routes must remain visibly unavailable rather than being inferred or silently redirected.
