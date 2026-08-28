# PistachioSwap Terms of Use

**Effective date:** July 28, 2026  
**Last updated:** August 11, 2026

> [!IMPORTANT]
> **Pre-launch legal notice.** PistachioSwap is currently a project name and this repository does not yet identify the final operating legal entity. Before commercial launch, these Terms must be reviewed by qualified counsel and updated with the operator's exact legal name and address, monitored contact information, final production fees/features, supported jurisdictions, regulatory/compliance decisions, and final dispute provisions. These Terms are a repository-aligned pre-launch draft, not a claim that every launch jurisdiction has been cleared.

These Terms of Use (the "Terms") govern access to and use of the PistachioSwap website, wallet interface, public API, software, and related services (collectively, the "Service"). "PistachioSwap," "we," "us," and "our" refer to the person or entity operating the Service under the PistachioSwap name.

By accessing or using the Service, you agree to these Terms. If you do not agree, do not use the Service.

## 1. Eligibility

You may use the Service only if you are at least 18 years old, have legal capacity to agree to these Terms, and may lawfully use the Service where you live and where you access it. You may not use the Service if sanctions, court orders, law, or other restrictions prohibit your use, or if you are acting for another person or entity without authority.

Availability in the interface does not mean the Service is lawful, licensed, registered, or appropriate in every jurisdiction.

## 2. Pre-release software

PistachioSwap is under active development. Features may be incomplete, experimental, disabled, changed, unavailable, or removed without notice. The Service has not been independently audited and may contain bugs, vulnerabilities, inaccurate information, provider failures, or interruptions.

Do not use the Service with assets you cannot afford to lose. Test new functionality with small amounts and separate wallets.

## 3. What the Service does

Depending on configuration, the Service may:

- connect to an external wallet;
- create or import an optional browser-based Pistachio Wallet;
- display public balances, assets, activity, prices, and token information;
- request and compare swap or bridge quotes from third-party providers;
- prepare transaction, typed-data, or message-signing requests;
- submit or monitor transactions that you authorize; and
- offer Gas Assist for certain eligible BNB Chain transactions when the wallet lacks native BNB.

PistachioSwap may change supported chains, assets, providers, transaction types, limits, fees, and eligibility rules at any time.

## 4. Self-custody and wallet responsibility

PistachioSwap is designed as a self-custodial interface. Connecting a wallet, requesting a quote, or using the optional local wallet does not by itself transfer custody of your assets to PistachioSwap.

You are responsible for:

- your wallet, device, browser profile, passkeys, passwords, private keys, recovery phrases, backups, and account security;
- reviewing addresses, tokens, amounts, networks, approvals, fees, routes, and transaction details before authorization;
- maintaining recovery information for any local wallet you rely on;
- ensuring that your device, browser, extensions, wallet software, and network are authentic and uncompromised; and
- maintaining native currency when Gas Assist is unavailable or ineligible.

PistachioSwap cannot recover a lost private key, forgotten recovery phrase, deleted local vault, inaccessible passkey, or assets sent to an incorrect address or network.

Never provide a private key, seed/recovery phrase, passkey secret, raw signed transaction, API credential, or internal service token to anyone claiming to represent PistachioSwap.

## 5. Local Pistachio Wallet and passkeys

If enabled, Pistachio Wallet may store encrypted vault data and preferences in your browser's IndexedDB or related browser storage. Clearing site data, resetting or deleting a browser profile, uninstalling a browser, losing a device, or losing access to a required passkey may permanently remove access unless you have a valid recovery backup.

The wallet may use WebAuthn/passkeys and a platform authenticator. Your fingerprint, face scan, or other biometric template is handled by your device/authenticator/platform and is not supplied to PistachioSwap as the biometric template. Your platform or passkey provider may have separate terms and privacy practices.

Browser encryption and passkey protection reduce risk but do not make a compromised device safe. Malware, malicious extensions, operating-system compromise, phishing, synchronization-provider compromise, or physical access may expose or destroy wallet information.

## 6. One-confirmation Gas Assist authorization

For the current Pistachio Wallet prepaid Gas Assist flow on BNB Chain, the wallet may present one sponsored transaction. That transaction pays the disclosed fee, authorizes the exact swap amount, executes the swap, and requires the reviewed minimum output. Bought tokens are sent to the same user wallet.

When this atomic flow is available:

- Pistachio Wallet presents one review and, for an already-unlocked session, requires one fresh passkey reauthentication;
- a resumed session that has just been passkey-unlocked is not intentionally prompted for a second passkey for the same swap;
- the wallet validates chain ID, destination, calldata, nonce, gas, fee recipient, recipient, and minimum output against the backend-prepared payload before returning a signature;
- the frontend submits one signed transaction; and
- if the on-chain transaction fails, no fee is taken.

This confirmation authorizes only the exact reviewed transaction. It is not a blanket approval for future transactions, arbitrary tokens, arbitrary recipients, unlimited approvals, different networks, or unrelated Gas Assist orders.

Gas Assist wallet authentication is separate from transaction authorization. A fresh authentication session may require a message signature proving control of the wallet. That authentication message states that it does not itself authorize a transaction.

## 7. Quotes, routes, and execution

Quotes are estimates based on information available when requested. They may expire or change because of market movement, liquidity, slippage, price impact, gas prices, provider behavior, token taxes, rebasing, transfer restrictions, block timing, maximum extractable value, bridge conditions, front-running, blockchain reorganization, or other conditions.

A displayed route does not guarantee that:

- a transaction will be accepted, mined, finalized, profitable, reversible, or recoverable;
- the expected or minimum output will remain available after expiration;
- a token is safe, legitimate, liquid, transferable, redeemable, or non-malicious;
- a provider, smart contract, bridge, RPC endpoint, paymaster, or blockchain will operate correctly; or
- a risk label, simulation, token list, or security check is complete or correct.

Reject any wallet request that does not match your intent.

## 8. Fees and costs

The Service may charge disclosed platform, integrator, Gas Assist, fixed, percentage-based, progressive, or other fees. Third parties may separately charge liquidity-provider fees, bridge fees, protocol fees, token taxes, spreads, gas costs, relayer costs, sponsorship costs, or other charges.

Review the final quote/review information before authorization. Fees may vary by route, provider, asset, network, trade size, and current conditions. Unless expressly stated otherwise or required by law, fees are not refundable after an irreversible transaction has been submitted or completed.

A repository example, environment value, test fixture, or documentation sample is not a binding production price. The transaction-specific disclosure presented by the production Service controls, subject to obvious error and applicable law.

## 9. Gas Assist limitations

Gas Assist is intended to help eligible users execute supported transactions when the wallet lacks native gas currency. It may include network cost, sponsorship cost, conversion cost, and PistachioSwap fees in the quote or prepayment flow.

Gas Assist:

- is not free unless the interface expressly says so;
- is not available for every wallet, token, amount, route, or network;
- may require wallet authentication, a passkey, message/transaction signatures, exact token approval, payment, simulation, liquidity/price/security checks, and rate-limit or abuse checks;
- may be rejected because of token risk, liquidity, price impact, allowance, provider/paymaster support, policy restrictions, treasury limits, simulation, abuse controls, or network conditions;
- may expire before signing or submission is complete; and
- depends on service and third-party infrastructure that may be paused, unavailable, or changed.

PistachioSwap may pause, limit, refuse, or terminate Gas Assist when reasonably necessary to protect users, the treasury, providers, or the Service.

## 10. Public blockchain records

Blockchain transactions are generally public and irreversible. Once broadcast, a transaction and its wallet addresses, token amounts, approvals, calldata, and transaction hash may be permanently visible and copied by third parties.

PistachioSwap cannot delete, edit, hide, recall, or guarantee finality of public blockchain records.

## 11. Digital-asset and smart-contract risks

Digital assets and decentralized protocols involve substantial risk, including total or partial loss of value; smart-contract bugs and exploits; malicious upgrades; governance/admin-key attacks; fake, honeypot, fee-on-transfer, rebasing, blacklistable, pausable, or non-transferable tokens; depegging; insolvency; liquidity loss; bridge or oracle failure; market manipulation; approval/signature phishing; malicious calldata; network congestion; chain reorganizations/forks; validator/RPC failures; legal/tax changes; and loss caused by user error or a compromised device.

Risk labels, simulations, token lists, liquidity checks, and provider checks may be incomplete, delayed, incorrect, unavailable, or defeated by changing contract behavior. You must independently evaluate each asset and transaction.

## 12. No investment, legal, tax, or fiduciary advice

The Service provides software and transaction information. Nothing in the Service is investment, financial, trading, legal, tax, accounting, or fiduciary advice, and PistachioSwap does not recommend that you buy, sell, hold, bridge, stake, or use any asset.

You are responsible for your decisions and for professional advice appropriate to your circumstances.

## 13. Taxes and reporting

You are responsible for determining and satisfying taxes, reporting obligations, recordkeeping duties, sanctions/compliance obligations applicable to you, and other legal obligations arising from your transactions. PistachioSwap does not calculate or file taxes for you unless a separate written service expressly states otherwise.

## 14. Third-party services

The Service relies on or links to independent wallets, blockchains, RPC providers, indexers, token lists, market-data providers, swap aggregators, decentralized exchanges, bridges, relayers, sponsorship/paymaster providers, security services, hosting services, and software libraries.

Third-party services are not controlled by PistachioSwap. Their terms, privacy policies, fees, licenses, availability, security, and conduct apply separately. Integration does not imply endorsement, partnership, guarantee, or sponsorship unless expressly stated.

Names and logos of third parties remain the property of their respective owners.

## 15. Acceptable use

You may not use the Service to:

- violate law, sanctions, court orders, or another person's rights;
- launder money, finance unlawful activity, evade lawful restrictions, commit fraud, or conceal criminal proceeds;
- exploit, attack, overload, disrupt, probe, or bypass security controls, service boundaries, authorization, rate limits, or sponsorship restrictions;
- submit malicious transactions, signatures, payloads, tokens, links, code, or data;
- impersonate another person or misrepresent authority, affiliation, location, or identity;
- manipulate quotes, sponsorship eligibility, fees, abuse controls, referral systems, or provider systems; or
- scrape, copy, reverse engineer, redistribute, host, or resell software in violation of the applicable license or third-party terms.

We may investigate suspected abuse and cooperate with lawful requests.

## 16. Intellectual property and source license

Owner-controlled PistachioSwap source code is source-available under the PolyForm Noncommercial License 1.0.0 unless a file states otherwise. Commercial use of owner-controlled code requires a separate written license from the project owner.

Third-party packages, components, fonts, SDKs, data, token lists, and copied/generated materials remain subject to their own licenses and notices. The project owner's license does not override those rights or obligations.

These Terms govern use of the hosted Service. They do not expand the source-code license or transfer ownership of names, logos, domains, designs, or other intellectual property.

## 17. Feedback and contributions

If you submit non-confidential feedback or suggestions, you grant PistachioSwap a worldwide, perpetual, irrevocable, royalty-free right to use, modify, reproduce, publish, and incorporate that feedback without compensation or attribution, to the extent permitted by law.

Code contributions are governed by the repository license, `CONTRIBUTING.md`, the Contributor Assignment Agreement where accepted, and any separate written agreement. Do not contribute code or content you do not have the right to provide.

## 18. Privacy

The [Privacy Policy](PRIVACY.md) explains current repository-aligned data practices and the information that must still be finalized before launch.

Do not submit wallet secrets through support channels, analytics, issue trackers, pull requests, or other public channels.

## 19. Availability, changes, suspension, and termination

We may modify, suspend, restrict, or discontinue any part of the Service at any time. We may block or limit access when reasonably necessary for security, maintenance, legal compliance, provider requirements, suspected abuse, or treasury protection.

You may stop using the Service at any time. Stopping use does not reverse blockchain transactions, cancel third-party obligations, or remove public records.

Provisions that by their nature should survive termination survive, including ownership, risk allocation, disclaimers, limitations of liability, indemnity, and dispute provisions.

## 20. Disclaimers

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, SECURITY, ACCURACY, AVAILABILITY, OR QUIET ENJOYMENT.

PISTACHIOSWAP DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, AUDITED, LAWFUL IN YOUR JURISDICTION, OR COMPATIBLE WITH ANY WALLET, TOKEN, PROVIDER, BROWSER, DEVICE, NETWORK, SMART CONTRACT, OR PRIVATE BACKEND SERVICE.

Nothing in these Terms excludes a warranty or right that cannot lawfully be excluded.

## 21. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, PISTACHIOSWAP AND ITS OWNER, FUTURE OPERATING ENTITY, CONTRIBUTORS, CONTRACTORS, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, CONSEQUENTIAL, OR PUNITIVE DAMAGES; LOST PROFITS, REVENUE, DATA, GOODWILL, KEYS, TOKENS, OR OPPORTUNITIES; OR LOSSES ARISING FROM MARKET MOVEMENT, SMART CONTRACTS, TOKENS, BRIDGES, WALLETS, PROVIDERS, BLOCKCHAINS, SECURITY INCIDENTS, USER ERROR, OR UNAUTHORIZED ACCESS.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, TOTAL LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF: (A) THE FEES YOU PAID DIRECTLY TO PISTACHIOSWAP FOR THE SPECIFIC TRANSACTION GIVING RISE TO THE CLAIM; OR (B) US $100.

Some jurisdictions do not allow certain exclusions or limits. Mandatory rights remain unaffected.

## 22. Indemnification

To the maximum extent permitted by law, you agree to defend, indemnify, and hold harmless PistachioSwap, its owner, future operating entity, contributors, contractors, and service providers from claims, damages, obligations, losses, liabilities, costs, and expenses arising from your unlawful use of the Service, violation of these Terms, violation of another person's rights, or transactions you authorize.

This section does not require indemnification for conduct that cannot lawfully be indemnified.

## 23. Governing law and dispute venue

Unless mandatory law requires otherwise, these Terms are intended to be governed by California law, without regard to conflict-of-laws principles.

**The final venue, arbitration/class-action provisions (if any), and exact contracting entity are intentionally not finalized in this pre-launch draft.** Those provisions materially depend on the eventual operator's legal formation, address, consumer-law obligations, and launch jurisdictions. Before commercial launch, qualified counsel must replace this paragraph with enforceable production dispute terms and any required notices.

Nothing in this draft waives a mandatory consumer right or statutory forum that cannot lawfully be waived.

## 24. Changes to these Terms

We may update these Terms as the Service, operator, fees, providers, law, or risk profile changes. We will post the revised Terms and update the "Last updated" date. Additional notice will be provided where required by law.

Continued use after revised Terms become effective constitutes acceptance only to the extent permitted by applicable law. If you do not agree to revised Terms, stop using the Service.

## 25. General terms

If any provision is found unenforceable, it will be enforced to the maximum lawful extent and the remaining provisions will remain effective. Failure to enforce a provision is not a waiver. You may not assign these Terms without written consent; PistachioSwap may assign them as part of company formation, financing, reorganization, or transfer of the Service, subject to applicable law.

These Terms, the Privacy Policy, the applicable software license, transaction-specific disclosures, and any separate written agreement form the relevant agreement concerning the Service.

## 26. Contact

Legal questions: **legal@pistachioswap.com**  
Privacy questions: **privacy@pistachioswap.com**

Before commercial launch, the operator must confirm that these addresses exist and are monitored, identify the final legal entity, and add any legally required mailing address, registered-agent, representative, or regulatory contact information.

---

This pre-launch draft reflects major product and risk characteristics visible in the repository. It is not a substitute for qualified counsel reviewing the final operator, launch jurisdictions, money-transmission and sanctions analysis, consumer disclosures, privacy program, fees, and production infrastructure.
