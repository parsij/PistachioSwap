# Verifying the production frontend

PistachioSwap publishes source code, but source availability alone does not prove that a web server is serving the same code. The production deployment therefore publishes a cryptographically attested build manifest and deploys the exact frontend artifact that GitHub Actions built.

This verification covers the frontend bytes served from `https://pistachioswap.com`. It does not claim that source availability or an attestation makes the code safe.

## What is attested

Every successful production deployment builds the frontend once on a GitHub-hosted Actions runner. The workflow then:

1. builds the production `dist/` directory from the exact `main` commit being deployed;
2. hashes every production file in `dist/` with SHA-256, including HTML, JavaScript, CSS, source maps, workers, images, fonts, and other static assets;
3. writes identical manifest bytes to `/pistachio-build-manifest.json` and `/.well-known/pistachio-build-manifest.json`, containing those hashes, byte lengths, the full Git commit SHA, build workflow, Node/pnpm versions, and the browser-visible `VITE_*` build configuration;
4. verifies the manifest and both public aliases against the local `dist/` directory before packaging;
5. creates a deterministic frontend archive and GitHub artifact attestations for both the manifest and the frontend archive;
6. puts that already-built `dist/` directory into the VPS release archive;
7. verifies the hashes again on the VPS and serves that directory without rebuilding it; and
8. checks that the origin-served attested manifest is byte-for-byte identical to the manifest in the release.

The root path `/pistachio-build-manifest.json` is the preferred public verification endpoint. The `/.well-known/` copy is retained as a compatibility alias. This avoids making verification depend on CDN, WAF, or other edge rules that may treat hidden `/.well-known` paths specially.

The build provenance is created by GitHub's `actions/attest` action using GitHub Actions OIDC. The attestation is stored by GitHub independently of the PistachioSwap VPS, so replacing both the site files and the site's copy of the manifest is not enough to create a valid provenance record.

## Easiest verification

Requirements:

- Node.js 24 or a recent Node.js version with built-in `fetch` support;
- the GitHub CLI (`gh`);
- an authenticated GitHub CLI session (`gh auth login`).

### No clone required

A machine that has never cloned or downloaded the PistachioSwap repository can verify the live frontend with one command. The verifier is streamed from GitHub directly into Node and is not downloaded from `pistachioswap.com`.

Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/verify-live-frontend.mjs | node --input-type=module -
```

Windows PowerShell:

```powershell
(Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/parsij/PistachioSwap/main/scripts/verify-live-frontend.mjs').Content | node --input-type=module -
```

These commands do not clone the repository and do not run `pnpm install`. They only stream the standalone verifier from GitHub, then let it verify GitHub build provenance and the bytes served by the production site.

### From an existing checkout

If the repository is already available locally, run:

```bash
node scripts/verify-live-frontend.mjs https://pistachioswap.com
```

or:

```bash
pnpm verify:frontend
```

The verifier performs two independent checks:

1. it downloads the live manifest, preferring `/pistachio-build-manifest.json` and falling back to the `/.well-known/` alias, then asks `gh attestation verify` to prove that exact manifest was attested by `parsij/PistachioSwap`, from `refs/heads/main`, by `.github/workflows/deploy-vps.yml`, on a GitHub-hosted runner, for the commit written in the manifest; and
2. it downloads every file listed in the manifest from `pistachioswap.com`, hashes the raw response bytes, checks the byte length, and compares both with the attested manifest.

A successful result ends with output similar to:

```text
✓ GitHub build provenance verified
  125/125 production files verified
✓ https://pistachioswap.com matches the GitHub-attested PistachioSwap frontend build.
```

The exact file count changes as the application changes.

## Manual verification

Download the manifest directly from the production site:

```bash
curl -fsS \
  https://pistachioswap.com/pistachio-build-manifest.json \
  -o pistachio-build-manifest.json
```

Read the source commit:

```bash
node -e "const m=require('./pistachio-build-manifest.json'); console.log(m.source.commit)"
```

Then verify the GitHub provenance. Replace `<COMMIT>` with the full commit printed above:

```bash
gh attestation verify pistachio-build-manifest.json \
  --repo parsij/PistachioSwap \
  --signer-workflow parsij/PistachioSwap/.github/workflows/deploy-vps.yml \
  --source-ref refs/heads/main \
  --source-digest <COMMIT> \
  --deny-self-hosted-runners
```

A valid attestation proves that the bytes of the manifest being checked were produced and attested by the expected GitHub Actions identity for that source commit. It does not merely trust a version string returned by the PistachioSwap server.

The `files` array in the manifest contains a SHA-256 digest and exact byte count for every built frontend file. The repository verifier automates downloading and comparing all of them; they can also be checked individually with `sha256sum` or another SHA-256 tool.

## Checking whether the deployment is current

The manifest records the exact deployed commit. Compare it with the current `main` branch:

```bash
gh api repos/parsij/PistachioSwap/commits/main --jq .sha
```

A deployment can legitimately lag `main` briefly while a new deployment is running. The verifier reports that condition as a notice rather than treating an otherwise valid older attested deployment as forged.

## Rebuilding for additional review

The manifest records the browser-visible production `VITE_*` configuration, Node version, pnpm version, source commit, and build workflow. Those values make the build inputs easier to audit and reproduce.

A local rebuild is useful as an additional review technique, but it is not the primary production identity check. Toolchain, operating-system, compression, or bundler details can make independently rebuilt archives differ even when the source is equivalent. The production guarantee is simpler: the exact files GitHub Actions hashed and attested are the exact files the deployment is expected to serve.

## Frontend files versus smart-contract bytecode

The browser frontend is HTML, JavaScript, CSS, workers, source maps, images, fonts, and other static files. Those files are verified byte-for-byte with SHA-256. Minified JavaScript is not EVM bytecode.

Any smart-contract bytecode used by PistachioSwap is a separate trust surface. Contract verification should compare the deployed chain bytecode with verified contract source and the documented contract address on the relevant block explorer. A valid frontend attestation does not prove that an arbitrary on-chain address contains the expected contract bytecode.

## What this does not prove

Frontend verification intentionally has a narrow claim. It proves the identity and integrity of the static production frontend build that was attested and served. It does **not** by itself prove:

- that the source code is vulnerability-free or audited;
- that the backend/API is running the public backend source;
- that third-party RPC, routing, bridge, market-data, wallet, or token-data providers return honest data;
- that an on-chain contract at an address has expected bytecode;
- that a user's browser, extension, operating system, DNS resolver, or device is uncompromised; or
- that a malicious service worker previously installed in an already-compromised browser profile has disappeared.

For the strongest independent check, verify from a clean browser/profile or a separate machine and review the attested source commit before authorizing meaningful transactions.

## Why the VPS cannot silently rebuild the frontend

Production activation fails unless the release already contains `dist/index.html` and the verification manifest. The VPS verifies every file against that manifest and checks that the manifest's source commit and origin match the release being activated. The activation script no longer runs Vite or rebuilds the frontend.

That removes a previous trust gap where GitHub Actions could build one frontend while the VPS built a second frontend from the same source with a separate environment. The deployed frontend is now the build artifact that GitHub Actions hashed and attested.
