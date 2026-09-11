# Alchemy Gas Assist

PistachioSwap Gas Assist uses Alchemy Wallet APIs on BNB Smart Chain.

Execution priority:

1. The sell token must pass PistachioSwap's existing Gas Assist token policy.
2. Gas Assist first requests Alchemy ERC-20 pre-operation gas payment using that sell token.
3. If Alchemy deterministically reports that ERC-20 pre-op payment is unsupported for the token or permit shape, the backend falls back to the dedicated Alchemy sponsorship policy.
4. The sponsorship fallback is fail-closed and is approved only through Pistachio's server-side policy webhook.
5. If neither path is available, Gas Assist is unavailable for that swap.

The user's EOA remains the owner address. Alchemy EIP-7702 delegation uses only Alchemy's supported Modular Account V2 implementations. Pistachio Wallet signs every Alchemy signature request. The backend stores the prepared operation and forwards only the user-provided signatures to Alchemy.

## Fees

Pistachio's existing commercial fee calculation remains unchanged. With ERC-20 pre-op gas payment, the user pays Alchemy's gas charge separately from the sell token, so the Gas Assist batch transfers only the commercial Pistachio fee to `TREASURY_ADDRESS`. With sponsored fallback, the existing Gas Assist payment including the gas reserve is transferred to the Pistachio treasury so the sponsorship cost remains funded.

The swap call keeps an exact router approval and clears that approval after the swap.

## Required runtime configuration

The private Gas-Assist service requires:

- `ALCHEMY_GAS_ASSIST_ENABLED=true`
- `ALCHEMY_API_KEY`
- `ALCHEMY_ERC20_POLICY_ID`
- `ALCHEMY_SPONSORSHIP_POLICY_ID`
- `ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET` with at least 32 characters
- a BNB Chain RPC (`BSC_RPC_URL` or `ALCHEMY_BSC_RPC_URL`)
- the existing database, treasury, compliance, quote-provider, fee, and risk-limit configuration

The Alchemy sponsorship policy webhook must target the public Pistachio API route `/v1/sponsorship/alchemy/sponsorship-webhook` and must be configured to reject sponsorship when the webhook fails.

Legacy NodeReal/MegaFuel environment variables do not enable the Alchemy runtime. Historical MegaFuel database migrations are kept only so existing production databases can migrate forward and retain audit history.
