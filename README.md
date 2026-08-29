<div align="center">

<a href="https://git.io/typing-svg">
  <img
    src="https://readme-typing-svg.demolab.com/?font=Noto+Sans&amp;weight=700&amp;size=30&amp;duration=1800&amp;pause=650&amp;color=22C55E&amp;center=true&amp;vCenter=true&amp;repeat=true&amp;width=850&amp;height=70&amp;lines=Hello%2C+World%21;%C2%A1Hola%2C+mundo%21;Bonjour+le+monde+%21;Hallo%2C+Welt%21;Ciao%2C+mondo%21;Ol%C3%A1%2C+mundo%21;%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%2C+%D0%BC%D0%B8%D1%80%21;%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C%EF%BC%81;%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF%E3%80%81%E4%B8%96%E7%95%8C%EF%BC%81;%EC%95%88%EB%85%95%ED%95%98%EC%84%B8%EC%9A%94%2C+%EC%84%B8%EA%B3%84%21;%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D9%8B+%D8%A8%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85%21;%D8%B3%D9%84%D8%A7%D9%85+%D8%AF%D9%86%DB%8C%D8%A7%21"
    alt="Hello World in multiple languages"
  />
</a>

# PistachioSwap

<div align="center">
  <img src="public/icons/PistachioLogo.svg" alt="PistachioSwap logo" width="104" />
  <p><strong>A self-custodial wallet and swap interface built around clearer routing, safer signing, and Gas Assist on BNB Chain.</strong></p>

  <p>
    <a href="https://pistachioswap.com"><img alt="Website" src="https://img.shields.io/badge/website-pistachioswap.com-2f9e44?style=flat-square" /></a>
    <img alt="Status" src="https://img.shields.io/badge/status-pre--release-f59f00?style=flat-square" />
    <img alt="License" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-7950f2?style=flat-square" />
    <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%2019-087ea4?style=flat-square" />
    <img alt="Backend" src="https://img.shields.io/badge/backend-Fastify%20%2B%20TypeScript-111111?style=flat-square" />
  </p>
</div>

> [!WARNING]
> PistachioSwap is pre-release software. It has not been independently audited and should not be treated as production-ready financial infrastructure. Use separate wallets and small amounts while development continues.

## What PistachioSwap does

PistachioSwap is a self-custodial wallet and swap interface. Users keep their keys. Ordinary send, same-chain swap, and cross-chain swap work across **25 curated EVM networks**. Users pay their own gas on those ordinary paths.

**Gas Assist** is separate and **BNB Smart Chain only** (chain ID 56). It is for eligible BEP-20 holders who do not have enough BNB to pay network gas. It is not free. The review UI shows the fee and the minimum output before signing.

Gas Assist is **one sponsored BNB Chain EIP-7702 self-transaction**. The disclosed fee goes from the user's EOA to the treasury, the quoted router receives an exact allowance, and the router spends the swap principal from that same EOA. Those steps share one transaction and revert together. Sequential prepaid packages, pull-executor fallback, cross-chain Gas Assist, and public 0x Gasless routes are not available.

The optional Pistachio Wallet is a browser passkey wallet. It is BSC-only. External wallets still work for ordinary swaps.

Provider availability is deployment-specific. A provider named in documentation is not necessarily enabled in every environment.

## Major components

| Area | Current role |
| --- | --- |
| **Pistachio Wallet** | Optional local self-custodial BSC wallet: encrypted IndexedDB vault, passkey/PRF, worker-owned unlocked session, signing review, and account/chain checks. |
| **Gas Assist** | BSC-only sponsored swaps when BNB is insufficient. Production path: one user-signed EIP-7702 self-call to `pistachio-atomic-v2-direct`. Fee, exact approval, and swap revert together. |
| **Same-chain routing** | Compares enabled quote providers (currently Uniswap, KyberSwap, and 0x) by net output and transaction cost. Those 0x quotes are ordinary gas-paid swaps, not 0x Gasless. |
| **Cross-chain routing** | Uses configured bridge/route providers and validates chain, token, recipient, amount, expiry, and execution data before use. Cross-chain swaps are not Gas Assist. |
| **Wallet portfolio** | Combines configured indexers, RPC fallbacks, market data, and local Pchained services for balances and activity. |
| **Token discovery** | Builds per-chain searchable catalogs from configured asset, market, liquidity, and token-security sources. Polygon zkEVM is curated for swapping but excluded from token discovery. |
| **Public API** | Fastify API with validation, rate limits, CORS restrictions, provider timeouts, and redacted logging. Private Gas Assist/MegaFuel work stays behind an internal proxy. Public `/v1/gas-assist/*` 0x Gasless paths are not allowlisted. |
| **Licensing pipeline** | Audits dependency licenses and copies exact installed custom-license texts/notices into production legal artifacts. |

## How the pieces connect

The React app talks to the public Fastify API. The API quotes swaps, prepares cross-chain routes, and loads wallet/token data from RPC, indexers, market sources, and Pchained. Ordinary transactions are signed in the user’s wallet (AppKit or Pistachio Wallet) and sent to public RPCs. Gas Assist requests go through the public API to a private sponsorship service; the browser signs one EIP-7702 self-transaction, and that service submits it. The private sponsorship service is not part of this repository.

## Security model

PistachioSwap is designed to fail closed around signing and private-service boundaries:

- Browser code does not contain private service credentials, private keys, or recovery phrases.
- Gas Assist requires explicit wallet review and authorization. It submits one sponsored EIP-7702 transaction and does not fall back to a normal gas-paid swap the wallet cannot fund, a sequential package, a pull executor, or 0x Gasless.
- The optional local wallet keeps unlocked secret material inside a dedicated worker-owned session and clears it on lock, timeout, account change, or disposal.
- APIs use bounded bodies, timeouts, rate limits, restricted CORS, no-store responses for sensitive paths, and log redaction for credentials and raw signed transactions.
- Public blockchain transactions remain public, generally irreversible, and outside PistachioSwap's control once broadcast.

These controls reduce risk. They do **not** prove that the software is vulnerability-free, audited, or safe against every malicious token, compromised browser, wallet exploit, provider failure, smart-contract bug, supply-chain compromise, or blockchain failure.

Security-sensitive reports should not include private keys, recovery phrases, passkey secrets, raw signed transactions, API credentials, internal service tokens, or other live secrets in public issues.

## Repository layout

```text
.
├── apps/api/                 Public Fastify API
├── docs/                     Architecture, operations, security, and licensing notes
├── public/                   Static application assets
├── scripts/                  Build, deployment, catalog, licensing, and audit tooling
├── src/                      React application, routing, wallet, and signing features
└── tests/                    Unit and browser integration tests
```

## Local development

### Requirements

- Node.js 24
- `pnpm` 10.30.3 or the compatible version declared by the repository
- Provider credentials only for integrations you intentionally enable

### Install and run

```bash
pnpm install
cp .env.example .env.local
cp apps/api/.env.example apps/api/.env

pnpm --filter @pistachio/api dev
pnpm dev --host 127.0.0.1
```

The frontend defaults to `http://127.0.0.1:5173` and the public API defaults to `http://127.0.0.1:3001`.

### Configuration boundaries

- Put public API secrets in `apps/api/.env` or the production API environment.
- Put only browser-safe public configuration in `.env.local` / `VITE_*` variables.
- Never put private credentials, wallet keys, or seed phrases in browser configuration.
- Enable only providers and chains actually operated by the deployment.

## Validation

Before merging or deploying material changes, run the relevant repository checks:

```bash
pnpm lint
pnpm --filter @pistachio/api typecheck
pnpm test
pnpm build
pnpm licenses:audit
pnpm audit:private-gas-assist-boundary
pnpm release-tree:audit
```

The build runs the license synchronization step. The licensing scripts retain exact installed custom-license evidence and fail the stricter audit when blocked or unresolved dependency license classifications remain.

## Cold wallets

- PistachioSwap: Cold Wallet 1 — `0x2941909551C7ceFd9EbEB1C5200D8B614CF887Ca`

## Legal, privacy, and third-party material

The repository contains:

- [Privacy Policy](PRIVACY.md)
- [Terms of Use](TERMS.md)
- [Project License](LICENSE)
- [Commercial Licensing Notes](COMMERCIAL-LICENSE.md)
- [Project Notice](NOTICE)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)
- [Contribution Rules](CONTRIBUTING.md)
- [Contributor Assignment Agreement](CONTRIBUTOR_ASSIGNMENT_AGREEMENT.md)
- [Contributors](CONTRIBUTORS.md)
- [Third-Party Licensing Notes](docs/third-party-licensing.md)

The Privacy Policy and Terms are pre-launch drafts tied to the software and data flows visible in the repository. They deliberately do not pretend that an unidentified future operating entity, unverified retention schedule, or unreviewed launch jurisdiction has magically become legally compliant because Markdown exists. Before commercial launch, the actual operator should verify entity/contact details, production vendors, retention/deletion schedules, fees, supported jurisdictions, sanctions/compliance obligations, consumer disclosures, and dispute terms with qualified counsel.

Third-party packages retain their own license terms. Reown/WalletConnect and MetaMask packages in particular use license terms that are not replaced by PistachioSwap's PolyForm license. Releases must preserve the exact installed license texts/notices produced by the licensing pipeline and comply with the then-current usage conditions of those dependencies.

## License

Owner-controlled PistachioSwap code is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE), except where a file or third-party notice says otherwise. Commercial use of owner-controlled code requires a separate written license from the project owner. Third-party code remains under its own license.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CONTRIBUTOR_ASSIGNMENT_AGREEMENT.md`](CONTRIBUTOR_ASSIGNMENT_AGREEMENT.md) before submitting code. Contributions must not contain secrets or material the contributor does not have the right to provide.

---

<div align="center">
  <strong>Built to make the missing-gas problem less absurd.</strong>
</div>
