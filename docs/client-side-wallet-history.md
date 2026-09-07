# Client-side wallet history

PistachioSwap Recent Activity fetches historical wallet activity from browser-side providers. The PistachioSwap API/VPS is not used by this wallet-history read path.

## Architecture

1. The wallet panel reads cached normalized activity from IndexedDB immediately.
2. If the cache is less than 10 minutes old, no history network request is made.
3. Otherwise the browser uses Alchemy Transfers API on chains where Alchemy exposes that index.
4. If that Alchemy history query is unavailable, or the chain does not expose Alchemy Transfers API, the browser uses thirdweb Insight for wallet transactions and ERC-20 transfer discovery.
5. Transaction hashes are hydrated directly in the browser with `eth_getTransactionByHash` and `eth_getTransactionReceipt`. thirdweb RPC is the cross-chain RPC fallback.
6. Receipt logs and calldata are classified locally as swaps, Gas Assist swaps, approvals, sends, receives, or contract interactions.
7. The result is stored in IndexedDB with the latest scanned block.
8. Later refreshes start at the previous checkpoint minus a 64-block reorg buffer instead of refetching the wallet's entire history.

Confirmed historical activity is retained in IndexedDB rather than expiring after one or two weeks. The classifier version is stored with the cache so a future incompatible classifier can invalidate and rebuild it.

## Live history networks

The browser history path covers every currently live chain in PistachioSwap's curated EVM registry:

```text
1       Ethereum
10      Optimism
25      Cronos EVM
56      BNB Smart Chain
100     Gnosis
130     Unichain
137     Polygon
146     Sonic
204     opBNB
324     zkSync Era
480     World Chain
1088    Metis
1284    Moonbeam
5000    Mantle
8453    Base
34443   Mode
42161   Arbitrum
42220   Celo
43114   Avalanche
534352  Scroll
59144   Linea
80094   Berachain
81457   Blast
167000  Taiko
```

Polygon zkEVM (`1101`) is intentionally excluded from history refresh because the network was shut down on July 1, 2026. It remains in the wider legacy chain registry for compatibility until that registry is cleaned up separately.

## Provider selection

Alchemy Transfers API is preferred on the chains where the current Alchemy product matrix exposes it. The browser uses thirdweb Insight as the cross-chain fallback, including chains where Alchemy only exposes ordinary RPC and not Transfers API.

If Alchemy has a transient failure on an otherwise-supported chain and thirdweb is configured, the same refresh falls through to thirdweb instead of turning the wallet's history into an empty result.

Neither provider is routed through PistachioSwap's API.

## Production configuration

Create two dedicated browser application credentials:

1. an Alchemy browser app/key with the relevant mainnets enabled;
2. a thirdweb client ID with the production domains in the project's allowed-domain list.

Never reuse a backend Alchemy key, thirdweb secret key, or any credential from `api.env`.

Add these values to the persistent frontend build environment on the VPS:

```dotenv
VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY=<DEDICATED_BROWSER_ALCHEMY_KEY>
VITE_WALLET_HISTORY_THIRDWEB_CLIENT_ID=<DEDICATED_THIRDWEB_CLIENT_ID>
VITE_WALLET_HISTORY_CHAIN_IDS=1,10,25,56,100,130,137,146,204,324,480,1088,1284,5000,8453,34443,42161,42220,43114,534352,59144,80094,81457,167000
```

The production file is currently:

```text
/opt/pistachio/env/frontend-build.env
```

`VITE_*` values are compiled into the frontend and are public by design. These credentials must therefore be treated as restricted public application identifiers, not server secrets.

Optional Alchemy per-chain variables can override the shared key:

```dotenv
VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_56=<BNB_BROWSER_KEY>
VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_1=<ETHEREUM_BROWSER_KEY>
```

If `VITE_WALLET_HISTORY_CHAIN_IDS` is absent or invalid, the production-safe default is BNB only (`56`).

## Alchemy security settings

On the dedicated Alchemy app/key, configure a domain allowlist for every production hostname that legitimately serves the frontend. Add the parent and `www` hostname separately if both are used:

```text
pistachioswap.com
www.pistachioswap.com
```

Do not assume the parent domain automatically includes a subdomain. With a domain allowlist enabled, test that an unapproved origin cannot use the key.

The browser sends the Alchemy key in the `Authorization: Bearer ...` header rather than placing it in the request URL. The credential remains visible to a determined user because it is frontend code, but it is kept out of request URLs and constrained by the Alchemy domain allowlist.

## thirdweb security settings

Create a frontend project/client ID rather than a server secret key. In the thirdweb project, allow only the production domains that are supposed to use the client ID, including both production hostnames when applicable:

```text
pistachioswap.com
www.pistachioswap.com
```

Insight requests send the client ID through `x-client-id`. Raw thirdweb RPC uses thirdweb's documented client-ID RPC URL format. A client ID is intentionally a frontend identifier; domain restrictions are the abuse boundary.

## Content Security Policy

If production sends a CSP with `connect-src`, allow the provider hosts used by this feature. For all-chain history the narrow domain wildcards are:

```text
https://*.g.alchemy.com
https://*.insight.thirdweb.com
https://*.rpc.thirdweb.com
```

Do not loosen `connect-src` to `*`.

## Deployment

After changing `frontend-build.env`, deploy/rebuild the frontend through the normal `Deploy VPS` GitHub Actions workflow. Do not manually edit generated `dist` files. The Vite variables are build-time values, so changing the environment without rebuilding does not update the browser bundle.

## Cache behavior

- Store: browser IndexedDB database `pistachioswap-wallet-history`.
- Scope: same-origin and per wallet + chain.
- Freshness: 10 minutes before an incremental network check.
- Reorg protection: rescan the last 64 blocks on refresh.
- Historical retention: up to 200 normalized activities per wallet + chain in this implementation.
- Browser storage can still be cleared or evicted by the user/browser. The chain/indexer remains the source of truth and the cache is rebuilt when absent.
- A local Pistachio transaction is still recorded immediately and merged with chain history by `chainId + transactionHash`.

## Provider limitations

The history path can recover ordinary wallet transactions, ERC-20 transfers, approvals, receipt-backed swaps, Pistachio Gas Assist swaps, and contract interactions. Internal-only native movements still depend on whether the selected indexer/network exposes internal call data; do not fabricate those when no provider supplies trace evidence.

The browser preserves a stale IndexedDB copy if a provider is temporarily unavailable. A failed refresh must not erase previously confirmed history.

## Privacy and server load

Wallet-history reads go from the user's browser directly to Alchemy and/or thirdweb. PistachioSwap's API does not receive the history request in this mode. The selected indexer necessarily sees the wallet address being queried. This removes Pistachio's VPS from the history retrieval path; it does not make indexed blockchain-history discovery providerless.
