# Client-side wallet history

PistachioSwap Recent Activity can fetch historical wallet activity directly from Alchemy in the user's browser. The PistachioSwap API/VPS is not used by this browser history path.

## Architecture

1. The wallet panel reads cached normalized activity from IndexedDB immediately.
2. If the cache is less than 10 minutes old, no history network request is made.
3. Otherwise the browser calls Alchemy directly with `alchemy_getAssetTransfers` for incoming/outgoing ERC-20 and external activity.
4. Discovered hashes are hydrated with `eth_getTransactionByHash` and `eth_getTransactionReceipt`.
5. Receipt logs and calldata are classified locally as swaps, Gas Assist swaps, approvals, sends, receives, or contract interactions.
6. The result is stored in IndexedDB with the latest scanned block.
7. Later refreshes start at the previous checkpoint minus a 64-block reorg buffer instead of refetching the wallet's entire history.

Confirmed historical activity is retained in IndexedDB rather than expiring after one or two weeks. The classifier version is stored with the cache so a future incompatible classifier can invalidate and rebuild it.

## Production configuration

Use a dedicated browser-visible Alchemy app/key. Never reuse a backend key from `api.env`.

For BNB-only history, add these values to the persistent frontend build environment on the VPS:

```dotenv
VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY=<DEDICATED_BROWSER_KEY>
VITE_WALLET_HISTORY_CHAIN_IDS=56
```

The production file is currently:

```text
/opt/pistachio/env/frontend-build.env
```

`VITE_*` values are compiled into the frontend and are public by design. This key must therefore be treated as a restricted public application credential, not a secret.

Optional per-chain variables can override the shared key:

```dotenv
VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_56=<BNB_BROWSER_KEY>
VITE_WALLET_HISTORY_ALCHEMY_PUBLIC_KEY_1=<ETHEREUM_BROWSER_KEY>
```

Only add a chain ID to `VITE_WALLET_HISTORY_CHAIN_IDS` after its Alchemy endpoint/app access is configured. The supported direct-history IDs in this implementation are `1,10,56,100,137,8453,42161,43114,59144`. BNB (`56`) is the default.

## Alchemy security settings

On the dedicated Alchemy app/key, configure a domain allowlist for every production hostname that legitimately serves the frontend. Alchemy documents domain entries as host/domain patterns, so add the parent and `www` hostname separately if both are used:

```text
pistachioswap.com
www.pistachioswap.com
```

Do not assume the parent domain automatically includes a subdomain. With a domain allowlist enabled, Alchemy rejects requests that do not carry an allowed `Origin`; test the restriction from an unapproved origin after it propagates.

The browser sends the Alchemy key in the `Authorization: Bearer ...` header rather than placing it in the URL. The credential remains visible to a determined user because it is frontend code, but it is kept out of request URLs and should be constrained by the Alchemy domain allowlist.

## Content Security Policy

If production sends a CSP with `connect-src`, it must allow every enabled Alchemy history origin. BNB needs:

```text
https://bnb-mainnet.g.alchemy.com
```

Do not loosen `connect-src` to `*`. Add only the exact history hosts actually enabled by `VITE_WALLET_HISTORY_CHAIN_IDS`.

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

## Provider limitation

Alchemy's BNB transfer index does not provide every internal-only native transfer under all plans. ERC-20 activity, external BNB transactions, zero-value contract calls discovered by the external stream, transactions, receipts and receipt logs are used by the browser classifier. Activity that requires unavailable internal call tracing cannot be claimed as complete without a provider/plan that exposes it.

## Privacy and server load

Wallet-history reads go from the user's browser directly to Alchemy. PistachioSwap's API does not receive the history request in this mode. Alchemy necessarily sees the wallet address being queried. This change removes Pistachio's VPS from the history retrieval path; it does not make an indexed blockchain-history query providerless.
