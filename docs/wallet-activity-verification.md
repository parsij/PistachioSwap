# Wallet activity verification

## Production failure established on 2026-09-07

Wallet: `0x880c39159919700166E4612d4b7Aa344fc21CD6F`, BNB Chain, chain ID 56.

The deployed API returned HTTP 200 with zero items, `failedChainIds: [56]`,
and `partial: true`. A direct Moralis request returned HTTP 401 stating that
free usage was paused. This is a provider entitlement failure, not a chain ID,
wallet casing, date cutoff, or frontend rendering failure. No credentials were
changed. The configured Alchemy endpoint worked.

## Pipeline and changes

- Remote history enters `/v1/wallet-activity`. Previously the only history
  source was one Moralis page (at most 50 rows), with internal transactions
  explicitly disabled and the returned cursor ignored. No date/block cutoff
  was configured. Token and native movement arrays were already supported.
- Moralis now follows up to five 50-row pages and requests internal transfers.
  Failed/unavailable Moralis history on chain 56 falls back to the existing
  Alchemy RPC infrastructure. Other chains report provider failures explicitly.
- Alchemy discovers incoming/outgoing ERC20 transfers and external transactions
  in separate streams, including zero-value calls. Each stream has at most five
  100-row pages, with repeated-cursor detection. At most 200 recent distinct
  transaction hashes are hydrated, in batches of five transactions/ten RPC calls.
  Each complete receipt supplies token logs, rather than treating transfer-index
  rows as separate user-facing activities. These bounds are reported as truncated
  coverage when reached. There is no unbounded history scan or background polling.
- Receipt status, wallet-relative asset flows, swap events, calldata and known
  executor authorizations drive classification. BigInt amounts are retained.
  Refunds are netted, same-token flows aggregated, and BNB/WBNB wrapping is not
  classified as exchanging materially different assets. Approval decoding runs
  before swap inference. Self-transfers and zero-value calls cannot supply swap
  flows. Failed receipts cannot become successful swaps.
- Healthy Moralis responses mislabeled as Send receive supplemental receipt
  verification when two-sided flows are ambiguous. A failed supplemental lookup
  preserves fetched history and reports partial coverage; it does not discard
  the entire history. Total history-provider failure returns HTTP 503.
- Token metadata enriches history; it is not required for a user-initiated
  transaction to exist. Existing inbound spam trust filtering remains. Outbound
  logs emitted by unrelated transactions also need token trust, because the
  real wallet's history contains forged outbound logs from counterfeit tokens.
- The frontend calls the same API in supported-chain batches. It normalizes
  records, merges localStorage history by numeric chain ID and lowercase hash,
  preserves richer swap information, sorts newest first, and applies the same
  visibility function used by the diagnostic. Type is no longer part of identity.
- Activity refetches on wallet/chain changes, opening the wallet panel, manual
  refresh and activity-recording events after sends and swaps (including Gas
  Assist). Previous-wallet results are aborted/cleared. No persistent remote
  activity cache was found; HTTP requests use no-store. Existing provider
  in-flight deduplication now includes the Moralis cursor. Local history remains
  capped at 100 records, remote display at 50, with three overview rows and the
  existing View all activity view.

## Reproduce without signing or broadcasting

Run with the existing API environment configured locally (never commit it):

```sh
pnpm diagnose:wallet-activity \
  0x880c39159919700166E4612d4b7Aa344fc21CD6F 56 \
  --api http://127.0.0.1:3017 --verify \
  --output /tmp/pistachio-activity-final.json
```

The script independently discovers indexed transactions and obtains their
receipts, queries the running activity route, then executes the frontend's real
normalization, merge and visibility functions. Expectations come from receipt
flows and swap events, not a list of expected hashes or the backend's classifier.
It prints a per-hash comparison and totals. `--local <file>` accepts an optional
JSON array of exported browser activity; without it, local history is explicitly
zero because the VPS cannot read a user's browser storage. Output files are not
part of the repository and contain public chain evidence, not environment values.

## Real-chain evidence

Discovery found 101 transfer-index records across 71 distinct transactions.
After removing untrusted unsolicited/forged entries, 31 activities survived both
the API and frontend: **7 swaps, 12 sends, 2 receives, 8 approvals, 2 contract
interactions**. The 12 sends include 9 plain ERC20 sends and 3 outgoing
router/executor transactions without a confirmed BNB-chain buy flow.

The acceptance check independently asserted 18 transactions: all 7 same-chain
swaps, 9 plain token sends and 2 direct token receives. All were returned with
the expected types by the backend and remained visible with those types after
the frontend merge. Output was ordered newest first.

| Swap transaction | Executor or router |
| --- | --- |
| `0xd5f6b95f2475675b539d08b8d73b2609ad8355a099b1ee771ad304778d91e79f` | `0x517b6c94da086f3f69dc725d7d70cdba7c4a9b62` (Gas Assist authorization) |
| `0xb08d5c09450b467cfec999ce6f570e63551ac7d906025910421b2e8e1afebd46` | `0x973731be76bdb84b994d32ef1e9607edebfbe470` (Gas Assist authorization) |
| `0x96a74e1a436b8458ed049659a8504600583e13521631bdc7d994eda8716f3835` | `0x1b81d678ffb9c0263b24a97847620c99d213eb14` |
| `0x4868c5797d02852850a973186ee7ee853d9ded23cf8248346f332edc6335eeb0` | `0x0000000000001ff3684f28c67538d4d072c22734` |
| `0x7dd27835a657dfabca571f0783ec33d35a8b656eef85486870772cc91288b487` | `0x0000000000001ff3684f28c67538d4d072c22734` |
| `0x2add50af47e3c06ef17e1f9a414f1fbc1fd128ce075ca4f226273208df033efb` | `0x02e5be68d46dac0b524905bff209cf47ee6db2a9` |
| `0x4f531bcb223a1dd5db7fba93dbe14af00d66651aa437787b3b102471166a6599` | `0x02e5be68d46dac0b524905bff209cf47ee6db2a9` |

Transactions `0xfe6df57cd68300ed9ae73bc66adf9b044b4bacb3c4dcfe6278b50f900f0bb7b9`
and `0x7933f4a55030f30519c4b6a1ef8db1de708034a9420edc67b842d871de46b376`
authorize `0x21331d393a0622eeddffce3e9db29448b6110bc6`. Both are retained as
outgoing activity. Their BNB receipts do not show a distinct buy asset arriving
back at this wallet. This verification does not assert destination-chain
completion or label every call to that executor a successful same-chain swap.

## Coverage limits and regression investigation

The Alchemy BNB transfer index rejects the internal category, and the configured
plan rejects call tracing. The API explicitly reports
`internal-native-transfers-unavailable` when using this fallback. Normal external
BNB sends/receives are supported and regression-tested, but none were discovered
for this wallet by the available index. Internal-only native receipts cannot be
claimed complete under this provider configuration. Moralis internal coverage
becomes available again when its account entitlement is restored.

The focused suite initially failed after supplemental receipt verification was
added: an older arbitrary-self-call fixture had no mock for the new RPC lookup.
The command was valid. The fixture now supplies a successful receipt with no
swap events, and asserts one lookup and a non-swap result. An additional test
proves supplemental RPC failure retains history with partial coverage. The
focused tests pass in their ordinary order and with shuffled order/seed 2718.
