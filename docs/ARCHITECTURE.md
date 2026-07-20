# Architecture

The Vite client is rooted at `src/main.jsx` and composes `src/App.jsx` with
`src/web3/AppKitProvider.jsx`. Frontend feature code currently includes
`src/features/swap/` and `src/features/approvals/`; Gas Assist, cross-chain,
token, and wallet families remain at their established paths while their
behavioral boundaries are documented. The Fastify app is `apps/api/src/app.ts`;
same-chain quote code is `apps/api/src/features/quotes/`.

Normal paid approvals never import Gas Assist. The API route contracts and
environment names are stable. See `docs/FILE_MAP.md` for ownership.
