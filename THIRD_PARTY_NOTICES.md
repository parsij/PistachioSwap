# Third-Party Software Notices

**Last reviewed:** August 11, 2026

PistachioSwap includes and depends on software, data, fonts, SDKs, and other material owned by third parties. The PolyForm Noncommercial License in `LICENSE` applies only to portions of this repository for which the PistachioSwap project owner controls the copyright. It does **not** replace, narrow, expand, or relicense any third-party material.

This file is a human-readable notice for material known to require special attention. The dependency graph changes over time, so it must be used together with the repository's automated license inventory and the exact installed license texts collected during the build/release process. If this summary conflicts with an exact third-party license, the exact license controls.

## Reown AppKit and WalletConnect

PistachioSwap uses Reown AppKit and WalletConnect packages for wallet connectivity and related UI/infrastructure.

These package families use their applicable Reown/WalletConnect Community License terms rather than PistachioSwap's PolyForm license. Those terms include conditions relating to permitted use, commercial/RPC/MAU thresholds, required infrastructure connections, redistribution/attribution, and other obligations that can change independently of PistachioSwap.

Do not rely on a hard-coded traffic or user threshold in this repository. Before each commercial release or material traffic increase, review the **exact installed license text and current upstream license** for the deployed version and confirm that the deployment remains within the permitted use or has the required commercial agreement.

Upstream references currently used for review:

- Reown AppKit repository and Community License: https://github.com/reown-com/appkit
- WalletConnect monorepo and Community License: https://github.com/WalletConnect/walletconnect-monorepo

The build/license synchronization process must preserve the exact license files required by the installed package versions.

## MetaMask Connect components

PistachioSwap currently depends on MetaMask Connect components, including `@metamask/connect-multichain` and transitive MetaMask packages.

MetaMask packages do not all use one uniform permissive license. Some installed packages contain ConsenSys/MetaMask custom terms. PistachioSwap's commercial rights in its own code do not override those terms.

Because custom-license wording and thresholds can vary by package/version, **this notice intentionally does not state a fixed monthly-active-user threshold as a universal rule**. The exact installed license evidence produced by `pnpm licenses:evidence` / `pnpm licenses:sync` and the upstream license for the deployed version must be reviewed before a commercial launch, traffic expansion, redistribution, or version upgrade.

Required MetaMask license copies and notices identified by the audit must remain in distributed artifacts.

## LGPL-licensed dependencies

The current production dependency graph has included LGPL-family packages such as PancakeSwap SDK components and `rpc-websockets`. Known entries at the time of this review include:

- `@pancakeswap/infinity-stable-sdk`
- `@pancakeswap/multicall`
- `@pancakeswap/permit2-sdk`
- `@pancakeswap/smart-router`
- `@pancakeswap/stable-swap-sdk`
- `@pancakeswap/swap-sdk-evm`
- `@pancakeswap/swap-sdk-solana`
- `@pancakeswap/token-lists`
- `@pancakeswap/v2-sdk`
- `rpc-websockets`

PistachioSwap does not relicense these packages. When distributing copies that contain LGPL-covered components, preserve notices and comply with the exact installed LGPL version and any corresponding source, replacement, reverse-engineering-for-debugging, or relinking obligations that apply to the manner of distribution.

A web deployment, source repository, Docker image, packaged application, and redistributed dependency archive can have different compliance implications. The release audit must evaluate the actual artifact being distributed.

## MPL-2.0 dependencies

Known MPL-2.0 entries at the time of this review include:

- `@ethereumjs/rlp`
- `@ethereumjs/tx`
- `@ethereumjs/util`

MPL-2.0 obligations are file-scoped. If PistachioSwap modifies MPL-covered source files and distributes those files, the applicable source/license obligations must be satisfied for those covered files. Merely listing MPL packages here is not a substitute for preserving their exact notices and license.

## Fonts

The Ubuntu font package used by the project is governed by the Ubuntu Font License 1.0. The applicable font license must be preserved in the distributed legal/license artifacts when required.

## Other permissive and custom licenses

Most dependencies are under common permissive licenses such as MIT, ISC, Apache-2.0, BSD variants, or similar licenses, but each retains its own copyright notices and terms. Some packages have incomplete package-manager metadata or non-standard/custom terms. The release process must not silently classify an unknown license as permissive.

Previously investigated metadata cases include:

- selected `@chainflip/*` toolkit packages whose package metadata may omit a license while the exact upstream monorepo root declares ISC;
- `eyes@0.1.8`, whose installed package contains the MIT License and its copyright notice;
- `text-encoding-utf-8@1.0.2`, whose installed package contains public-domain/Unlicense material;
- selected `@metamask/*` packages with custom ConsenSys/MetaMask terms; and
- selected `@reown/*` and `@walletconnect/*` packages with family-specific Community License files.

These determinations must be rechecked when versions change. A past audit result is not permanent permission for a future package version. Humans, apparently, do occasionally edit license files.

## Third-party data and network services

PistachioSwap may request or display data from third-party APIs, blockchains, token lists, RPC providers, indexers, market-data services, bridge providers, swap providers, and security services. API terms, data licenses, trademarks, attribution duties, rate limits, and acceptable-use rules can apply separately from npm package licenses.

Repository code currently contains integrations or optional support for providers/services including Reown/WalletConnect, MetaMask, Uniswap, 0x, PancakeSwap, Across, deBridge, Relay, Chainflip, Alchemy, Moralis, CoinGecko, GeckoTerminal, DexScreener, DexPaprika, ShapeShift asset data, Honeypot.is, GoPlus, and public blockchain/RPC infrastructure. Naming a provider here does not mean it is enabled in every deployment or that PistachioSwap owns, endorses, or is endorsed by that provider.

Production operators must comply with the API/data terms for the services actually enabled.

## Trademarks

Third-party names, logos, product names, and trademarks belong to their respective owners. Their appearance in code, dependency names, provider selectors, or documentation is for identification/interoperability and does not imply sponsorship or endorsement.

## Release evidence and required checks

Before a release that distributes frontend bundles or other packaged artifacts:

```bash
pnpm licenses:evidence
pnpm licenses:sync
pnpm licenses:audit
```

The release must also pass the repository build/security gates that invoke or verify the legal-artifact pipeline.

A release must not claim that the dependency tree is fully license-compliant merely because installation, tests, or the frontend build pass. At minimum, the release process must:

1. inventory the exact resolved dependency versions;
2. fail or require review for blocked, unknown, ambiguous, or custom licenses;
3. preserve required copyright and license notices;
4. copy exact custom-license evidence required by distributed components;
5. satisfy copyleft obligations appropriate to the actual distributed artifact;
6. review API/data-provider terms for enabled production integrations; and
7. re-check Reown/WalletConnect/MetaMask commercial-use conditions against the exact deployed versions and current upstream terms.

`pnpm licenses:evidence` exists specifically so incomplete package metadata produces evidence for human review rather than a confident little legal hallucination from a package manager.

## No legal conclusion from this notice

This file is intended to improve attribution and license hygiene. It is not a legal opinion that every possible deployment or redistribution method is compliant. Before a material commercial release, the actual dependency graph, generated legal artifacts, third-party service terms, distribution method, modifications to copyleft-covered code, and custom-license thresholds should be reviewed by qualified counsel or an experienced licensing professional.
