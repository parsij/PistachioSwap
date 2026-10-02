# PistachioSwap production wallet security review

This review covers the browser passkey wallet, its provider bridge, public RPC submission path, and general API request hardening. It is a focused engineering review, not an independent security audit or a guarantee that no vulnerabilities remain.

## Security model after this change

The encrypted wallet remains saved in IndexedDB. A connected Pistachio Wallet may expose only its public address for balances, portfolio data, and transaction history without loading private key material.

A fresh passkey verification is required for:

- sending a transaction
- signing a normal transaction or Gas Assist EIP-7702 authorization
- signing a message or EIP-712 typed data
- revealing a recovery phrase or private key
- exporting a keystore or protected backup
- adding or removing passkeys

After each sensitive operation, the wallet worker is locked and discarded while the public address remains connected in view-only mode. Hiding the browser tab also clears an unlocked worker.

## Fixed in this pass

### Blocking lock screen

The inactive-session overlay no longer blocks the application in the production wallet flow. Inactivity now clears decrypted key material instead of preventing access to public wallet data.

### Connection confusion

A saved wallet can reconnect in view-only mode without a passkey. The UI separately labels normal wallet access and security/backup tools, so opening a wallet is no longer presented as the same operation as decrypting it.

### Sensitive-operation isolation

Only allowlisted EIP-1193 methods are accepted. Unsupported methods and oversized payloads are rejected before a passkey prompt. One sensitive action may run at a time, and a browser-tab limit prevents repeated passkey/signing prompt abuse.

### Public RPC abuse limits

The browser wallet permits only the internal `eth_chainId` and `eth_sendRawTransaction` RPC operations. Requests have a timeout, payload bound, response-size bound, redirect rejection, JSON-RPC ID validation, and chain verification before broadcast.

### API resource limits

The API now has bounded request bodies, request and connection timeouts, bounded route parameter lengths, a maximum number of requests per socket, safer JSON prototype handling, a lower global request limit, and a separate health endpoint limit.

### Sensitive logging and caching

Additional wallet secrets, backups, credentials, passwords, and recovery material are redacted from API logs. Wallet, sponsorship, and Gas Assist responses receive `Cache-Control: no-store` and defensive response headers.

### Proxy trust

Forwarded client IP headers are not trusted by default. Production may set `TRUST_PROXY_HOPS=1` only for the current nginx-to-API loopback topology. The API validates that the immediate proxy address is loopback before trusting forwarded client metadata. Multi-hop numeric proxy trust is rejected; add explicit trusted proxy addresses before introducing another proxy hop. Do not use an unrestricted `trustProxy=true` configuration.

## Production configuration

Start from `apps/api/.env.production.example`, replace `YOUR_PRODUCTION_FRONTEND_ORIGIN`, and copy only the relevant values into the real, uncommitted `apps/api/.env`.

When the API is directly exposed:

```dotenv
TRUST_PROXY_HOPS=0
```

When exactly one trusted reverse proxy, such as nginx or a load balancer, sits in front of the API:

```dotenv
TRUST_PROXY_HOPS=1
```

Count only proxy hops that actually add or forward the client-IP headers received by Fastify. Verify the value in the real deployment rather than copying an example and hoping networking has become self-aware.

Set `CORS_ORIGINS` to the exact production frontend origin. Do not include wildcard origins, preview domains, or localhost in the production environment.

The frontend must be delivered over HTTPS. Add production edge headers at the CDN or reverse proxy:

- `Strict-Transport-Security`
- a tested Content Security Policy
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin`
- an appropriate `Permissions-Policy`, including a deliberate WebAuthn policy

A Content Security Policy must be tested against WalletConnect, token images, RPC providers, and API origins before enforcement. Do not paste a broad wildcard policy merely to silence browser errors.

## Remaining launch blockers

1. Commission an independent wallet and smart-contract security review before custody of meaningful user funds.
2. Run dependency, secret, and static-analysis scanning on every pull request and on a schedule.
3. Use a shared rate-limit store such as Redis before running more than one API process. In-memory limits are per process and therefore not a complete distributed control.
4. Put the API behind a reverse proxy or managed edge with connection limits, request-size limits, bot controls, and DDoS protection.
5. Configure provider billing caps and alerts for Alchemy, Moralis, 0x, Uniswap, The Graph, and every other paid upstream.
6. Add structured security monitoring for repeated signing failures, sponsorship abuse, authentication failures, rate-limit events, provider cost spikes, and unusual wallet-action volume.
7. Perform a complete authorization review of sponsorship and admin routes. Every wallet, order, intent, refund, and rule identifier must be checked against the authenticated principal or an explicit admin credential.
8. Keep the wallet and worker scripts on the trusted first-party origin. Do not load third-party JavaScript that is unnecessary for the signing page.
9. Test recovery, passkey loss, multiple saved wallets, multiple tabs, browser storage deletion, browser restore, rejected signing, RPC failure, chain switching, and interrupted broadcasts on real devices.
10. Prepare an emergency switch that disables new sponsorship and wallet transaction submission without taking read-only portfolio access offline.

## Important limitation

Keeping decrypted key material in a Web Worker reduces accidental exposure to ordinary UI code, but it does not make an XSS vulnerability harmless. Malicious same-origin JavaScript could still ask the wallet worker to perform an operation. The signing review, fresh passkey verification, strict method allowlist, transaction validation, CSP, dependency control, and independent audit all remain necessary.
