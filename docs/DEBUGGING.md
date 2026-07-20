# Debugging

Use existing frontend `approval.*` and swap diagnostic event names; their
payloads are intentionally preserved. Backend quote diagnostics remain emitted
by `apps/api/src/features/quotes/routes/quote-routes.ts` and selector/provider
code. Inspect request identity, quote expiry, canonical approval metadata, and
active wallet chain before changing execution logic.

Mocked tests cannot establish real wallet prompts, RPC behavior, or live
provider responses.
