# Backend

`apps/api/src/app.ts` registers Fastify routes. Same-chain quote endpoints are
implemented at `apps/api/src/features/quotes/routes/quote-routes.ts`; provider
selection is in `services/quote-selector.ts`; PancakeSwap, Uniswap, and 0x
adapters are in `providers/`. Existing route URLs and JSON contracts are
unchanged. Gas Assist remains under `apps/api/src/gas-assist/` and
`apps/api/src/modules/gas-assist.ts`.

Backend source follows NodeNext rules: TypeScript source imports use `.js`
suffixes. Provider keys remain server-only.
