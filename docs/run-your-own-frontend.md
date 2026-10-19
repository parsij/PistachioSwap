# Run your own PistachioSwap frontend

Use a local checkout of the public frontend while getting quotes and hosted services from `https://pistachioswap.com`. No `.env` file, provider keys, local API, Gas Assist repository, or Docker is required for this mode.

## One command

Requires Git, Node.js **24**, and pnpm (the repository pins its package-manager version). On Linux, macOS, or Windows WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/run-frontend.sh | bash
```

This downloads and executes the public launcher from GitHub. You can inspect [the launcher](../scripts/run-frontend.sh) before running it. It clones into `./PistachioSwap` when the folder is absent, installs the lockfile dependencies using pnpm, loads browser-safe settings from the public production build manifest into the current process, and starts the frontend at **http://localhost:5173/swap/**. No configuration file is created, and no backend or private repository is started.

When run from the root of an existing PistachioSwap checkout, the command reuses it automatically. Otherwise it uses `./PistachioSwap` relative to your terminal's current directory. To choose a stable location, use an absolute path:

```bash
curl -fsSL https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/run-frontend.sh | bash -s -- --dir "$HOME/apps/PistachioSwap"
```

Spaces are supported when the path is quoted. Use the same `--dir` value on subsequent runs. The launcher verifies the existing checkout's origin and `main` branch, fetches current `main`, and applies only a clean fast-forward. It stops for local changes, local commits, diverged history, or an unrelated destination; it does not reset files, stash changes, switch branches, or reclone an existing checkout. Commit/stash or reconcile your work yourself, or choose another folder.

Stop the frontend with **Ctrl+C**. Re-run the command to check for updates and start again. Port 5173 must be free; the script will not silently change ports and put your wallet on a different browser origin.

From an existing checkout, `pnpm install --frozen-lockfile` followed by `pnpm self-host` starts the same mode without updating Git. No environment file is needed.

## What stays hosted

The local frontend sends `/api` requests through its local Vite proxy to the fixed PistachioSwap public API. Official `/api/…` Bundler endpoints use that same proxy in this mode. The proxy is not an arbitrary URL relay and does not supply private service credentials. Public feature flags and browser-safe connection settings come from the live build manifest over HTTPS; if they cannot be loaded and validated, startup fails instead of guessing settings. This is configuration distribution, not independent verification of the production deployment's provenance.

Quotes, routes, Gas Assist, screening, rate limits, provider availability, and fees still depend on the hosted services and applicable terms. This does not make the service offline, bypass screening, eliminate quoted charges, or guarantee a sponsored transaction. No price formula, recipient, signing authority, or contract deployment changes in this mode.

The local proxy reaches the hosted API from the computer running it. The hosted infrastructure sees that connection's network address; browser-direct RPC/indexer and wallet-connection requests still go to their providers. No wallet private key or seed phrase is required by the launcher or public configuration request. Never add private credentials to browser configuration.

## Wallets and browser origins

Use **localhost** consistently. Local vaults, storage, and passkeys are distinct from `pistachioswap.com` and from other browser origins. A website passkey does not unlock a localhost vault. Changing host, port, or browser profile can change available local wallet storage. Keep a recovery backup before moving or clearing wallet data.

External-wallet/provider features depend on the selected wallet and any origin restrictions imposed by Reown, RPC/indexer providers, and other services. Public production project IDs do not guarantee every feature is authorized for every mirror domain. No allowlist or passkey security check is disabled by this setup.

## Hosting on a public domain

This launcher serves a **local frontend**, bound to localhost; the Vite development server is not a public production hosting setup. The `--dir` option selects a filesystem folder, not a website URL prefix. Publishing on another domain requires a production build, HTTPS, server-side routing for `/api`, the applicable provider origin approvals, and deliberate configuration of that domain's own passkey relying-party ID. Do not reuse another domain's wallet identity or expose development servers publicly. See [local development](../README.md#local-development) for maintaining your own backend instead.

The existing [source license](../LICENSE), [commercial licensing conditions](../COMMERCIAL-LICENSE.md), and third-party notices continue to apply; this setup guide does not change them.
