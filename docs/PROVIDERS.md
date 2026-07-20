# Providers

`apps/api/src/features/quotes/providers/` contains PancakeSwap, Uniswap, and
0x adapters. `services/quote-selector.ts` preserves concurrent execution,
diagnostics, normalization, and the current provider ranking. PancakeSwap
keeps native-token and Permit2/Universal Router handling; Uniswap keeps
integrator-fee validation; 0x keeps allowance-holder and legal-restriction
normalization. Do not change ranking during directory-only edits.
