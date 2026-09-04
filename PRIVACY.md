# PistachioSwap Privacy Policy

**Effective date:** July 28, 2026  
**Last updated:** August 11, 2026

> [!IMPORTANT]
> **Pre-launch status.** The repository does not yet identify the final legal entity that will operate PistachioSwap. Before commercial launch, this Policy must be updated with that entity's exact legal name, required address/contact details, actual production vendors, final retention/deletion schedules, supported jurisdictions, and any jurisdiction-specific disclosures. A qualified privacy lawyer should review the production deployment. This document describes the current software and intended data flows; it is not a certification of legal compliance.

This Privacy Policy explains how the operator of PistachioSwap ("PistachioSwap," "we," "us," or "our") may collect, use, disclose, and protect information when you use the PistachioSwap website, wallet interface, public API, and related services (collectively, the "Service").

## 1. Scope and public-blockchain warning

This Policy covers information processed through the Service. Independent wallets, blockchains, token issuers, decentralized exchanges, bridges, RPC providers, indexers, passkey/platform providers, and other third parties have their own practices and policies.

PistachioSwap is designed as a self-custodial interface. Public blockchain activity is not private. Wallet addresses, token balances, approvals, transfers, swaps, calldata, transaction hashes, and related records may be permanently visible to validators, RPC nodes, explorers, analytics services, counterparties, and the public. PistachioSwap generally cannot delete or alter public blockchain records.

## 2. Information the Service may process

### A. Wallet and blockchain information

Depending on the feature used, the Service may process:

- public wallet addresses and chain identifiers;
- token balances, allowances, transactions, activity, and portfolio values;
- token contract addresses, symbols, decimals, metadata, and selected networks;
- public transaction hashes, block information, receipts, and execution status; and
- wallet connection/session information supplied by the wallet or connection provider.

A public wallet address or transaction history can still be personal information when it can reasonably be linked to an individual or household.

### B. Quotes, swaps, and Gas Assist

When you request or execute a quote, bridge, swap, or Gas Assist transaction, the Service and configured providers may process:

- sell and buy tokens, amounts, chain, recipient, taker/wallet address, and slippage;
- quote IDs, routes, expected/minimum output, price impact, fees, gas estimates, expiration times, and provider responses;
- approval targets and exact approval amounts;
- transaction calldata and unsigned transaction fields prepared for your review;
- wallet-authentication challenges and signatures used to prove control of a wallet;
- signed raw transactions when required for an explicitly authorized Gas Assist flow;
- payment, approval, swap, bridge, and settlement transaction hashes;
- order/intent status, failure codes, recovery state, timestamps, idempotency values, and replay-prevention records; and
- sponsorship limits, abuse indicators, and security events.

For Gas Assist, a transaction is presented for wallet review before authorization. Private keys are not sent to PistachioSwap.

### C. Pistachio Wallet information stored on your device

If the optional Pistachio Wallet is enabled, browser storage may contain:

- encrypted vault records and ciphertext;
- public wallet addresses and vault identifiers;
- wallet labels and selected-vault preferences;
- passkey credential identifiers/metadata and values needed to request WebAuthn operations;
- recovery-backup confirmation state and local settings; and
- local session/activity metadata used to decide whether a wallet can be resumed or must be reauthenticated.

Unlocked secret material is designed to remain in a dedicated browser worker-owned session and to be cleared when the wallet locks, times out, changes account, or is disposed. The encrypted vault remains in browser storage until you delete it, clear site data, or remove the browser profile.

PistachioSwap does not receive your fingerprint, face scan, or other biometric template from WebAuthn. A device, operating system, authenticator, password manager, or passkey synchronization provider may independently process biometric or device information under its own terms.

### D. Network, device, and security information

Servers and infrastructure providers may receive or process:

- IP address and network information;
- request time, endpoint, method, selected headers, user-agent/browser/device information, and referring information when supplied;
- rate-limit, authentication, security, abuse-prevention, and error events;
- approximate location inferred by infrastructure or security providers from an IP address;
- sanctions-screening decisions, the version/hash of sanctions data used, and limited compliance case evidence when a transaction is restricted; and
- diagnostic information needed to operate or secure the Service.

Application logging is configured to redact sensitive fields including authorization credentials, internal service tokens, raw signed transactions, signatures, private keys, recovery phrases, passwords, and similar wallet-secret material. Operators must still review production logging and provider logging because no redaction configuration is infallible.

### E. Communications

If you contact us, we may process the address or account you contact us from, your name or alias, message contents, attachments, wallet address if you voluntarily provide it, and our response history.

Do not send private keys, seed/recovery phrases, passkey secrets, raw signed transactions, API credentials, or internal service tokens in support messages or public GitHub issues.

## 3. Sources of information

Information may come from:

- you and your browser/device;
- your connected wallet or optional local Pistachio Wallet;
- public blockchains, RPC nodes, indexers, explorers, and token registries;
- configured swap, bridge, liquidity, sponsorship, market-data, token-security, and wallet-connection providers; and
- PistachioSwap's APIs, databases, logs, caches, and security systems.

## 4. Why information is used

We may use information to:

- connect wallets and show balances, tokens, prices, and activity;
- request, compare, validate, prepare, sign, submit, recover, and monitor transactions you request;
- calculate and disclose expected output, minimum output, gas, price impact, and fees;
- authenticate wallet control and prevent replay or duplicate submissions;
- apply sponsorship eligibility, rate limits, fraud/abuse prevention, and treasury protections;
- identify unsupported, risky, unknown, hidden, or suspicious tokens;
- protect encrypted local-wallet state and enforce signing/account/chain invariants;
- operate, troubleshoot, test, secure, and improve the Service;
- provide support and respond to security, privacy, legal, or regulatory requests; and
- screen public wallet addresses and transaction requests for sanctions restrictions, reject prohibited hosted-service activity, document compliance decisions, and make legally required reports; and
- comply with applicable law and establish, exercise, or defend legal claims.

## 5. Legal bases for EEA/UK processing

If European or UK data-protection law applies to a particular processing activity, the eventual operator must identify and document an appropriate legal basis for that activity before launch. Depending on the final operation, relevant bases may include performance of a contract or steps requested by a user, legitimate interests such as fraud prevention/network security after the required balancing assessment, compliance with legal obligations, or consent where consent is actually requested and legally appropriate.

Because the final controller/entity and production processing inventory are not yet identified in this repository, this pre-launch Policy does **not** claim that every possible EEA/UK processing activity already has a finalized legal-basis analysis. That analysis, controller identity, international-transfer mechanism, and any required representative/DPO information must be completed before offering the production Service where those rules apply.

## 6. How information may be disclosed

Information may be disclosed as necessary to operate the Service to categories such as:

- hosting, database, CDN, security, RPC, and indexing providers;
- wallet-connection and wallet-software providers such as Reown/WalletConnect or the wallet you choose;
- swap, liquidity, sponsorship, and bridge providers such as configured Uniswap, 0x, PancakeSwap, MegaFuel/NodeReal, Across, deBridge, Relay, Chainflip, or similar services;
- market-data and token-security providers such as configured CoinGecko, GeckoTerminal, DexScreener, DexPaprika, Moralis, Alchemy, Honeypot.is, GoPlus, ShapeShift asset data, token lists, or self-hosted Pchained infrastructure;
- accountants, auditors, insurers, attorneys, regulators, courts, or law enforcement when reasonably necessary and lawful; and
- an acquirer, successor, or newly formed operating entity in a financing, merger, reorganization, sale, insolvency, or similar business transfer.

The exact provider list depends on production configuration. A provider named in repository documentation may be disabled in a particular deployment.

When a blockchain transaction is broadcast, transaction data is disclosed to the network and may become permanently public.

## 7. Sale, sharing, advertising, and preference signals

The current repository does not intentionally implement behavioral-advertising trackers or a business model that sells personal information or shares it for cross-context behavioral advertising. If the production operator begins a practice treated as a sale or sharing under applicable law, the Policy and required opt-out controls must be updated before that practice begins.

Where California law requires a covered business to honor a valid Global Privacy Control or similar legally recognized opt-out preference signal, the production Service must do so for applicable sale/sharing activity. The present absence of such sale/sharing activity should not be treated as a promise that the business model can never change; material changes require updated notice and controls.

## 8. Browser storage and tracking choices

The Service may use IndexedDB, local storage, session storage, caches, and wallet/connection-provider storage for encrypted wallet vaults, preferences, selected tokens, recent activity, connection state, and security/session information.

Clearing site/browser data can permanently remove local wallet data. Maintain a valid recovery backup before clearing storage. PistachioSwap cannot recover local wallet secrets that were never safely backed up.

Third-party wallets and providers may use their own storage or tracking technologies under their own policies.

## 9. Retention

Information should be retained only as long as reasonably necessary for transaction execution/recovery, security, abuse prevention, support, accounting/tax, disputes, and legal obligations.

Current categories include:

- **Local encrypted wallet data:** remains on the device until the vault/site data/browser profile is deleted.
- **Authentication challenges and sessions:** have configured expirations; security records may survive expiration when necessary for replay prevention, fraud investigation, or legal records.
- **Quotes, orders, and signing intents:** expire on configured schedules, while transaction/recovery records may be kept longer where operationally or legally necessary.
- **Transaction and fee records:** may be retained for accounting, tax, reconciliation, dispute, and legal needs.
- **Security/abuse records:** may be kept while a threat, limit, investigation, or legal need remains active.
- **Sanctions screening records:** ordinary checks are designed to store only compact wallet/chain/action, coarse location, decision, sanctions-data version, transaction reference, and time fields. Raw signed transactions and identity documents are not collected merely for routine sanctions screening. When a request is actually blocked or escalated, a separate case record may preserve the client IP and limited evidence needed for legal review/reporting. Records required by OFAC or other law may be retained for the legally required period, which is currently up to 10 years for records subject to OFAC's recordkeeping rule.
- **Support communications:** may be kept while necessary to resolve and document the request.
- **Backups:** may retain data for a limited additional period before rotation or deletion.

Before production launch, the operator must adopt specific documented retention and deletion schedules for logs, transaction records, authentication data, abuse/security records, backups, and support systems. De-identified or aggregated information may be kept where it can no longer reasonably identify a person.

## 10. Security

The Service implements safeguards intended to reduce risk, including encrypted local vault storage, passkey-based protection, dedicated worker-held unlocked secrets, explicit transaction review, server-side authentication, restricted administrative routes, request validation, rate limits, expiry, replay controls, provider restrictions, and sensitive-log redaction.

No wallet, browser, passkey implementation, smart contract, provider, server, database, blockchain, or transmission method is completely secure. You are responsible for securing your device, browser profile, passkeys, external wallets, backups, and recovery information.

## 11. Your choices and privacy rights

Depending on applicable law, you may have rights to know/access, correct, delete, restrict, object to certain processing, receive a portable copy, withdraw consent where consent is the basis, or obtain information about disclosures. You may also have a right to complain to an applicable data-protection authority.

You may disconnect an external wallet, delete a local Pistachio Wallet vault when the feature is available, clear browser storage after securing recovery information, decline an optional support disclosure, or reject a signing request before submission.

Public blockchain records generally cannot be deleted or corrected by PistachioSwap. Requests may also be limited where an exception applies, including inability to verify the requester, fraud/security needs, legal obligations, or establishment/defense of legal claims.

## 12. California privacy rights

If the California Consumer Privacy Act and related regulations apply to the production operator, California residents may have rights including rights to know/access, delete, correct, opt out of sale/sharing, limit certain uses of sensitive personal information where applicable, and exercise rights without unlawful discrimination.

Before launch, the operator must determine whether statutory thresholds apply and establish required intake, verification, response, and preference-signal processes. Privacy requests may be sent to **privacy@pistachioswap.com** only after the operator confirms that address is active and monitored. We will never require a seed phrase or private key to verify a privacy request.

## 13. EEA/UK rights and international transfers

Where GDPR/UK GDPR applies, individuals may have rights including access, rectification, erasure, restriction, portability, objection, and rights related to certain automated decisions, as well as the right to lodge a complaint with a competent supervisory authority.

PistachioSwap and its providers may process information in the United States and other countries. Before production use involving regulated international transfers, the operator must identify the controller/processor roles and implement any legally required transfer mechanism or safeguard.

## 14. Age eligibility

The Terms currently require users to be at least 18 years old. The Service is not directed to children. We do not knowingly seek personal information from children under 13, and the production operator must address any legally required process if it learns that such information was collected.

The current Service does not intentionally sell or share minors' personal information for behavioral advertising. If the business model changes, applicable age-specific requirements must be implemented before that activity begins.

## 15. Changes to this Policy

We may update this Policy when the Service, operator, vendors, law, data flows, or security practices change. The revised document will show an updated date, and additional notice will be provided when legally required or appropriate for a material change.

## 16. Contact

Privacy questions and requests: **privacy@pistachioswap.com**

Before commercial launch, the final section must identify the operating legal entity, confirm that the contact channel is monitored, and add any legally required mailing address, representative, or data-protection contact.

---

This is a repository-aligned pre-launch privacy notice, not a substitute for advice from qualified counsel reviewing the actual operator, production infrastructure, vendors, retention schedules, jurisdictions, and business practices.
