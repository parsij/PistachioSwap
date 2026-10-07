# Production provider audit — October 7, 2026

No secrets or configuration values are recorded here. Existing treasury and
economic platform fee settings remain unchanged.

| Provider | Production requirement | Fee mechanism |
| --- | --- | --- |
| 0x same-chain | Existing API credential | Existing provider affiliate configuration |
| Uniswap | Existing API credential | Existing output integrator fee |
| PancakeSwap | Source contracts/RPC and fee executor | Not registered by the normal API selector; disabled |
| KyberSwap | Public endpoint, optional client identity | Existing aggregator fee configuration |
| Across | API key and integrator ID | `appFee` ratio and `appFeeRecipient` treasury |
| Relay | API key for `/quote/v2` since October 2, 2026 | `appFees[].fee` BPS and `recipient` treasury claim address |
| deBridge DLN | Public API is credential-optional; commercial integrations require a dedicated API credential | `affiliateFeePercent` and `affiliateFeeRecipient` treasury; referral is separate |
| 0x cross-chain | Existing 0x API credential | `feeBps`, `feeRecipient`, `feeToken` source token |
| Chainflip | Mainnet broker and independently established treasury withdrawal ownership | Broker commission, not the shared platform fee |

Official references:

- https://docs.across.to/introduction/api-keys
- https://docs.across.to/api-reference
- https://docs.relay.link/references/api/api-keys
- https://docs.relay.link/features/app-fees
- https://docs.debridge.com/dln-details/integration-guidelines/order-creation/authentication
- https://docs.debridge.com/api-reference/dln/this-endpoint-returns-the-data-for-a-transaction-to-place-a-cross-chain-dln-order
- https://docs.chainflip.io/brokers/broker-api/requests
- https://docs.0x.org/docs/core-concepts/contracts

Relay app fees accrue as claimable off-chain USDC balances, not immediate
transfers to the treasury. No withdrawal or fee payment was performed to verify
realized revenue. deBridge public quote construction was tested without access
token or referral; successful public construction does not remove the documented
commercial authentication requirement. It remains disabled pending that setup.
Chainflip remains disabled without a configured broker and treasury evidence.

0x discovery now consumes exact directed `bridges[].chainPairs` from the actual
production `/cross-chain/sources` response. It does not infer every pair from
a list of chains or swap liquidity sources. deBridge source deployment metadata
now includes verified Optimism/Polygon/Arbitrum/Linea execution contracts as
well as existing Ethereum/BNB/Base targets.

Run the read-only diagnostic from the API directory using its server-only env:

```bash
pnpm exec tsx --env-file=.env scripts/diagnose-provider-matrix.ts
```

The output is a closed schema: presence classifications, capability states,
numeric chain IDs, fee BPS and fixed reasons. It never includes API keys,
treasury addresses, broker URLs or raw upstream errors. `CAPABLE` is not a
guarantee that every token pair has executable liquidity. Normal routing is
independent of Gas Assist enablement, sponsorship token eligibility and source
pins. Failure isolation remains in the existing cross-chain registry.
