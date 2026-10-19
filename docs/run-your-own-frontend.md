# Run your own PistachioSwap frontend

Use a local checkout of the public frontend while getting quotes and hosted services from `https://pistachioswap.com`. No `.env` file, provider keys, local API, Gas Assist repository, or Docker is required for this mode.

## One command

On Linux, macOS, or Windows WSL, run:

```bash
curl -fsSL https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/run-frontend.sh | bash
```

This downloads and executes the public launcher from GitHub. You can inspect [the launcher](../scripts/run-frontend.sh) before running it. It clones into `./PistachioSwap` when the folder is absent, installs the lockfile dependencies using pnpm, loads browser-safe settings from the public production build manifest into the current process, and starts the frontend at **http://localhost:5173/swap/**. No configuration file is created, and no backend or private repository is started.

The launcher installs missing prerequisites first. Git and required download/archive utilities use the detected package manager: apt, dnf, pacman, zypper, apk, or an existing Homebrew installation. System packages may request sudo approval through your terminal. Unsupported systems stop with an explanation rather than attempting an unknown installer. On macOS without Git/Homebrew, install Apple command-line tools or Homebrew before rerunning.

If Node.js is missing or is not version 24, an official Node.js 24 archive is downloaded over HTTPS, checked against the official SHA-256 manifest **before extraction or execution**, and installed in `${XDG_DATA_HOME:-$HOME/.local/share}/pistachioswap/tools/node`. Existing system Node.js is not replaced. Missing pnpm is installed with npm into the same application-specific tools area, pinned to the repository's current version (10.34.5). The private tool paths apply to the launcher process; shell startup files are not edited. Compatible tools already available are reused. Automatic Node installation supports x64/arm64 platforms for which Node publishes a matching archive. Package-manager/network failures stop setup; no broad OS upgrade is performed.

## Windows PowerShell

On Windows 10/11, paste this into PowerShell (no WSL required):

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/run-frontend.ps1').Content))
```

For a custom installation folder, append `-Dir "$HOME\apps\PistachioSwap"` to that command. Reuse the same path on later runs. You can inspect [the Windows launcher](../scripts/run-frontend.ps1) before running it.

Missing Git is installed with Microsoft's winget; Windows may request approval. If winget itself is absent, install/update Microsoft App Installer first and rerun. If Node.js is absent or incompatible, the launcher installs an official, SHA-256-verified Node.js 24 archive under `%LOCALAPPDATA%\PistachioSwap\tools\node`. Missing pnpm is installed under that same private tools area using npm. Neither the system Node.js installation nor the machine execution policy is changed. Native Windows supports x64/arm64 when official Node archives are available. Clone/update checks preserve local changes and require clean `main`, just like the Unix launcher.

## Custom folders and repeat runs

When run from the root of an existing PistachioSwap checkout, the command reuses it automatically. Otherwise it uses `./PistachioSwap` relative to your terminal's current directory. To choose a stable location, use an absolute path:

```bash
curl -fsSL https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/run-frontend.sh | bash -s -- --dir "$HOME/apps/PistachioSwap"
```

Spaces are supported when the path is quoted. Use the same `--dir` value on subsequent runs. The launcher verifies the existing checkout's origin and `main` branch, fetches current `main`, and applies only a clean fast-forward. It stops for local changes, local commits, diverged history, or an unrelated destination; it does not reset files, stash changes, switch branches, or reclone an existing checkout. Commit/stash or reconcile your work yourself, or choose another folder.

Stop the frontend with **Ctrl+C**. Re-run the command to check for updates and start again. Port 5173 must be free; the script will not silently change ports and put your wallet on a different browser origin.

From an existing checkout, `pnpm install --frozen-lockfile` followed by `pnpm self-host` starts the same mode without updating Git if compatible tools are already on your shell's PATH. If the launcher installed private tools, rerun the launcher to restore its PATH automatically. No environment file is needed.

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
