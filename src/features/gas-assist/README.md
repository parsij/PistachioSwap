# Gas Assist

Gas Assist uses the self-hosted BNB Chain ERC-4337 v0.8 Paymaster path.

## Runtime boundaries

- `hooks/usePrepaidSponsorship.js`: owns review/authentication/order/submission state.
- `services/prepaidSponsorship.js`: provider-neutral HTTP client for config, wallet authentication, order creation, and order polling.
- `services/selfHostedPaymaster.js`: validates the exact reviewed five-call batch, builds the EIP-7702/ERC-4337 UserOperation, requests Paymaster sponsorship, obtains the user's local signatures, and submits the final signed UserOperation to the Bundler.
- `components/`: Gas Assist review, status, and error UI.

There is no 0x Gasless, Particle, MegaFuel, server-submitted raw-transaction, or alternate sponsorship runtime in this feature. If the self-hosted Paymaster configuration is unavailable or mismatched, Gas Assist fails closed.

## Transaction boundary

The reviewed sponsored batch is exactly:

1. Gas Assist payment to the configured treasury.
2. Sell-token allowance reset to zero.
3. Exact net sell-token allowance.
4. Exact reviewed router calldata with zero native value.
5. Allowance reset to zero.

The user's wallet creates the EIP-7702 authorization and final UserOperation signature locally. The Gas-Assist API receives only unsigned UserOperations for policy/sponsorship. The signed UserOperation is sent from the browser to the Pistachio Bundler.
