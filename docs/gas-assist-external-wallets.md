# External-wallet Gas Assist compatibility research

Reviewed 2026-10-20. Frontend baseline: `11c37f14e0965ee94ae09559677f8981b3a6b085`.
Private Gas Assist baseline: `c25d755b112c6443fa1ea8792f5ed37c8eacab06`.

## Release status

This is a **draft integration**, not a production compatibility certification.
The adapter and full source-operation submission fixtures pass, and the actual
external wallet's cryptographic signer module has been exercised. An installed
extension UI/transport session and an end-to-end sponsored transaction have NOT
been verified. Do not merge or advertise a supported wallet until those checks
are completed. No transactions were sent and no production configuration,
contracts, fee formula, exemptions, or balances were changed.

## What the existing flow needs

An external signer must provide all of the following for the selected account:

1. Account access and a chain-scoped authentication message signature.
2. A genuine EIP-7702 authorization for the configured Simple7702Account delegate
   and exact live EOA nonce. A personal-message or typed-data signature cannot
   substitute for this signature.
3. An EIP-712 signature over the final ERC-4337 v0.8 operation after gas estimation
   and final sponsorship. The browser verifies both signatures locally.
4. The same selected account and source chain throughout signing.

The existing Paymaster pins both the 7702 initCode marker and the trusted
delegation code hash. Its five-call policy collects the exact quoted token
payment atomically with the source swap. Wallet-native gas abstraction or batch
support alone does not meet this interface. Destination fulfillment remains
asynchronous, and the existing fixed quoted service charge and retained margin
model is unchanged.

## Wallet and interface findings

| Wallet / interface | Evidence | Conclusion for this direct flow |
| --- | --- | --- |
| Pistachio Wallet | Existing private connector authorization RPC and EIP-712 operation signatures | Existing implementation preserved; its reviewed passkey session remains local-wallet-only. |
| MetaMask extension / mobile | [Official 7702 quickstart](https://docs.metamask.io/smart-accounts-kit/development/get-started/smart-account-quickstart/eip7702/) explicitly excludes JSON-RPC accounts from `signAuthorization`; [batch API](https://docs.metamask.io/wallet/how-to/send-transactions/send-batch-transactions/) uses wallet-managed upgrades | No documented direct authorization interface established. Do not mark compatible or use the local-private-key quickstart as evidence of browser-wallet support. |
| Rabby | [Open upstream request #3102](https://github.com/RabbyHub/Rabby/issues/3102) requests authorization signing; this is an issue, not an API guarantee | Direct support not established. No adapter claiming Rabby support. |
| Coinbase Wallet / Base Account | [Current SDK documentation](https://docs.cdp.coinbase.com/coinbase-wallet/overview) and [ERC-7677](https://eips.ethereum.org/EIPS/eip-7677) describe different wallet/paymaster integration surfaces | Not interchangeable with the current private order endpoints and pinned delegate. A separate account/EntryPoint/call-encoding integration needs verification. Current frontend also disables Base Account and requests EOA-only Coinbase connections. |
| Ambire | [Account source](https://github.com/AmbireTech/ambire-common/blob/v2/contracts/AmbireAccount7702.sol) uses its account implementation and a different EntryPoint | No documented arbitrary trusted-delegate authorization API established. Existing account must not be silently replaced. |
| Trust Wallet | [Provider docs](https://developer.trustwallet.com/developer/develop-for-trust/browser-extension/evm) and [FlexGas description](https://trustwallet.com/blog/academy/flex-gas-pay-for-gas-with-twt-usdt-or-bnb) | EVM connectivity and FlexGas do not establish the required external signing RPC. Direct compatibility remains unverified. |
| OKX Wallet | [Provider API](https://web3.okx.com/onchainos/dev-docs/wallet/dapp-connect/chains/evm/provider) and [7702 announcement](https://www.okx.com/en-us/help/okx-web3-wallet-to-support-eip-7702-at-the-earliest-opportunity) | Announcement and SDK key-signing helpers are not a documented browser authorization API. Direct compatibility remains unverified. |
| Phantom | [Wallet-native EVM gasless transactions](https://help.phantom.com/articles/understanding-gasless-transactions-on-evm-networks-53467684967443) | Native gasless support does not establish this direct external authorization method. Not enabled by name. |
| Ledger, connected directly | [Official Ethereum Signer Kit](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/eth) documents `signDelegationAuthorization` and typed-data signing | Plausible separate hardware connector; not implemented or device-tested here. Ledger behind MetaMask is still limited by MetaMask's provider API. |
| Privy / other embedded SDK wallets | [Privy authorization API](https://docs.privy.io/wallets/using-wallets/ethereum/sign-7702-authorization) supports embedded signing | Technically capable through their SDKs; not evidence that attaching an arbitrary external wallet enables authorization. Adding an embedded-wallet product is separate integration work. |
| Dogeshit Wallet 0.6.2 | [Pinned README](https://github.com/dogeshitmeme/dogeshit-wallet/blob/8131fa08f89874db3a3ea3fca391ed84c62bb75f/README.md), [provider handler](https://github.com/dogeshitmeme/dogeshit-wallet/blob/8131fa08f89874db3a3ea3fca391ed84c62bb75f/src/background.ts), [signer](https://github.com/dogeshitmeme/dogeshit-wallet/blob/8131fa08f89874db3a3ea3fca391ed84c62bb75f/src/core/crypto.ts) | Implements the exact nonstandard RPC used in this draft. Source-level interoperability verified; installed-extension and transaction compatibility still unverified. Its manifest explicitly describes it as experimental and not audited. This is not a wallet security recommendation. |

Absence of a verified interface here is not proof that a vendor can never support
it. Recheck current provider releases and APIs before expanding this matrix.
EIP-1193 connectivity, WalletConnect transport, and viem's local-account helpers
do not independently supply the missing authorization interface.

## Adapter protocol and security checks

The draft sends only the provider's documented request shape:

```js
provider.request({
  method: 'wallet_signAuthorization',
  params: [{ address: trustedDelegate, chainId: '0x38', nonce: '0x3' }],
})
```

This method is **nonstandard**; it is not asserted to exist in all wallets. The
provider returns `{ address, chainId, nonce, yParity, r, s }`. All fields are
checked against the requested values. The existing flow recovers the signer,
rechecks the on-chain nonce and code, and preserves the exact order/call policy.
The external account/chain are checked before and after authorization, before
typed-data signing, and before submission. Unsupported/restricted methods fail
closed. Rejections do not trigger alternative signing methods or funding.
No `eth_sign`, seed import, dummy transaction, or key export fallback is used.
Existing third-party delegation is rejected in the external path.

## Already-delegated accounts and the pinned Bundler

[ERC-7769](https://eips.ethereum.org/EIPS/eip-7769#support-for-eip-7702-authorizations)
allows later operations without a fresh authorization once delegation is stored.
However, [Alto v1.2.8's field validator](https://github.com/pimlicolabs/alto/blob/37cade5d2804a60ab30362ea27054514e1d7a7c8/src/rpc/rpcHandler.ts)
rejects the marker without `eip7702Auth`, even for an existing delegation. The
current Paymaster also rejects empty initCode, so simply omitting the factory
fields is not a workaround. This draft preserves the fresh-authorization path.

A future standards-compatible Bundler correction could enable typed-data-only
external signing for accounts **already delegated to the exact trusted
implementation**. It would not solve first-time MetaMask/Rabby onboarding.
That correction requires separate validation and a controlled Bundler rollout;
API deployment alone does not recreate the root-managed production Bundlers.
No Bundler patch or contract replacement is included in this draft.

[ERC-7902](https://eips.ethereum.org/EIPS/eip-7902) proposes wallet capabilities for
account delegation and AA configuration, but remains a draft. Do not treat the
proposal as proof that any connected wallet implements it.

## Validation and remaining release gates

Completed:

- Gas Assist tests: 175 passed across 16 files, including all four source chain
  IDs, modified authorization fields, unsupported methods, rejected requests,
  account changes, external hook selection, and full mocked source submission.
- Production frontend build passed; lint passed with pre-existing repository
  warnings. Diff whitespace check passed.
- Independently bundled the pinned external wallet's real `src/core/crypto.ts`,
  generated an ephemeral test wallet in memory, and called its actual
  `signAuthorizationFromMnemonic` through the adapter's documented wire shape.
  Recovered the expected signer for BNB, Polygon, Base, and Optimism. No keys or
  seed were printed, and no production RPC calls or broadcasts were made.

Not completed:

- Actual installed-extension account connection, review UI, rejection and approval
  transport, EIP-712 confirmation, and chain/account switching. A browser test was
  attempted with a locally built pinned extension; Chromium could not start
  because this execution environment denies the required process singleton
  socket (`EPERM`). This is an environment limit, not a successful wallet test.
- A complete testnet or isolated-chain transaction with the real extension,
  EntryPoint v0.8, trusted delegate, Paymaster, and Bundler, including success,
  reverted payment, stale nonce, and cross-chain source/destination separation.
- A funded mainnet external-wallet transaction. This must not be implied by CI,
  signature recovery, compilation, deployment, or capability status.

Keep this PR in draft until the installed-wallet and end-to-end checks succeed.
Do not recommend depositing funds into an experimental wallet to test support.
