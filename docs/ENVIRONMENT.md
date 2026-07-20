# Environment

Environment-variable names and `.env` files are not changed by this refactor.
Vite-visible values stay governed by the existing Vite configuration; provider
keys and Gas Assist credentials remain backend-only under `apps/api`. Use
`apps/api/.env.example` as the existing documented template. Do not expose
provider secrets in browser code, diagnostics, or route responses.
