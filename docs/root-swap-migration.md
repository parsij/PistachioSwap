# Root landing / swap app migration

## URL contract

| URL | Response after cutover |
| --- | --- |
| `/` | 200, static marketing page, self-canonical root |
| `/swap/` | 200, existing React swap/wallet app, self-canonical /swap/ |
| `/landing`, `/landing/`, `/landing/index.html` | 301 to root, query string retained |
| `/index.html` | 301 to root |
| `/swap`, `/swap/index.html` | 301 to /swap/, query string retained |
| `/?route=…`, `/index.html?route=…` | 301 to /swap/ with the full original query |
| Existing Wallet, How it works, FAQ and both Gas Assist guides | Same URLs and 200 HTML |
| Unknown pages | 404, not the app/landing shell with status 200 |

Root marketing URLs with only tracking parameters stay at root. The app's
existing `route` parameter is the only supported legacy root deep link found
in the source. URL fragments stay in the browser; the static fallback preserves
them, and normal HTTP redirects without a fragment inherit the original one.

Do **not** redirect all `/landing/*` pages to root. Do **not** redirect plain
`/` to the app: it would undermine the new home page and could create loops.
Links in the app, mobile menu, guides and home page point directly at the new
destinations, rather than depending on redirects.

## What is and is not changed

- Static landing HTML is now `index.html`; the app is `swap/index.html`.
  Landing CSS, ticker, images and guide URLs stay in their existing directories.
- The home page has no wallet entry script or wallet initialization. A tiny
  route-only script handles old deep links on static hosts during rollout.
- `landing/index.html` is only a static redirect fallback, not a second landing
  page. It is **not a substitute for HTTP 301 at the production origin/edge**.
- Canonical/OG/schema URLs, internal navigation, sitemap and llms.txt are aligned.
  The sitemap still contains seven canonical pages; /swap/ replaces /landing/.
- The manifest keeps `id: "/"` (the previous implicit identity) and `scope: "/"`,
  and changes `start_url` to `/swap/`. Keep the existing manifest URL.
- No wallet encryption, vault schema/database name, RP ID, connector metadata
  origin, signing code, API endpoint, or key material is migrated or rewritten.
- Googlebot access is unchanged. Live-answer assistant crawlers may now read
  the static root and fee guide; the existing training-crawler rules are retained.
- Vite dev/preview and the optional standalone Worker implement matching
  exact redirects. Vite uses multi-page mode so missing pages return 404.

This work does not apply live nginx/Cloudflare changes, deploy production, modify
Search Console, accept a contributor agreement, or initiate wallet transactions.

## Required owner/operator work

### 1. Review and merge the PR

The repository's Contributor Assignment Agreement requires personal acceptance
by the account that opens the PR: the exact checkbox **and** the new top-level
acceptance comment required by its template. Read the agreement yourself before
deciding whether to accept. The assistant must not sign or comment acceptance
on your behalf. The PR must not be merged while that check fails.

No owner-protected workflow, package manifest, lockfile, or deployment script is
changed. The existing release process still builds root index.html successfully,
but does **not** install the nginx/Worker examples automatically.

### 2. Coordinate the origin/edge cutover with the frontend build

The operator should review `deploy/nginx-origin-cache.conf` against the **active**
443 server config and keep a recoverable copy of that config and the prior release.
Replace matching locations; do not paste duplicate `location /` or exact blocks.
Preserve TLS, existing security/CSP headers, API and health proxy locations,
legal pages, and any site-specific infrastructure configuration.

The critical changes are:

- `/` serves the new root index.html.
- `/swap/` serves the new swap/index.html, without a generic root SPA fallback.
- Exact legacy entry points return 301 and retain query strings.
- Keep guide prefixes live, and unknown paths 404.
- Remove any old bot-specific root rewrite or external root → /landing/ rule.
- Keep the current HTTPS, non-www origin. Do not introduce app.pistachioswap.com.

Validate with `nginx -t` before the operator reloads nginx. Verify the new build
contains `build/swap/index.html` before sending traffic to it. Coordinate frontend
activation and config reload in one controlled cutover; applying redirects alone
against the old build can send visitors to a missing /swap/ page.

If the optional Worker is already active, update its code at the same cutover.
If it is not used, **do not create a Worker just for this migration**.
The Worker handles redirects/cache headers, not origin file provisioning.
Other CDN redirect/transform rules must not override the new route contract.

Invalidate the affected cached HTML and /sitemap.xml, /robots.txt and
/site.webmanifest after cutover. Never clear browser storage or send a
`Clear-Site-Data` header. Keep API responses uncached. Avoid a global WAF disable.

### 3. Verify before requesting indexing

Run the read-only HTTP probe from a checkout with dependencies installed:

```sh
node scripts/check-public-routes.mjs https://pistachioswap.com
```

It checks the seven pages, canonicals, app entry location, CTA links, permanent
redirects (GET and HEAD), query retention, missing-page 404s, sitemap and manifest.
It uses ordinary and Google-InspectionTool User-Agents, but cannot prove access
from Google's real infrastructure or guarantee indexing.

Manual checks on desktop and mobile:

1. Home → Open wallet → /swap/; reload /swap/ directly.
2. App logo/About → home; desktop Trade and mobile Trade stay at /swap/.
3. All guide links and back-to-home links work.
4. Old /landing/#wallet links still reach the correct home section.
5. In the **same browser/profile and HTTPS origin**, open an existing
   Pistachio Wallet and confirm it shows the same address and unlocks with its
   existing passkey. The user completes any OS/authenticator prompt.
6. Check existing external-wallet reconnect and an installed PWA shortcut.
   Older shortcuts may still open root until their browser updates the manifest;
   Open wallet remains available. Do not uninstall a wallet or clear its data.

No transaction, new passkey, recovery-phrase reveal, or backup export is needed
for these navigation checks. Localhost cannot validate a production passkey or
read a production-origin vault. Unit tests of RP ID and unchanged storage code
are not substitutes for the existing-wallet smoke test.

### 4. Google Search Console

- Keep the existing domain property; this is not a domain migration.
- Submit/check `https://pistachioswap.com/sitemap.xml` after its URLs are updated.
- Inspect root and /swap/: Test live URL, then request indexing once when the
  live test succeeds and the page is eligible. Existing unchanged guides stay
  in the sitemap; they do not all need repeated manual requests.
- /landing/ should eventually be reported as a redirected page. Do not request
  it to become a separate indexed page and do not use the Removals tool on it.
- Monitor Page indexing and Google-selected canonicals after recrawl. A
  temporary old canonical or ranking fluctuation is possible during processing.
- A generic “Something went wrong” during Live Test needs separate diagnosis;
  this routing migration does not establish its cause or guarantee a fix.

Google chooses sitelinks and indexing. Keep redirects for at least a year and
preferably as long as old links are used; do not promise an indexing deadline.

## Local validation

```sh
pnpm test
pnpm build
node scripts/check-public-seo.mjs
pnpm exec vite preview --host 127.0.0.1 --port 5176 --strictPort
# In another terminal:
node scripts/check-public-routes.mjs http://127.0.0.1:5176
```

## Rollback

Keep the previous release and reviewed nginx/Worker configuration together.
If the app is inaccessible, use the normal release rollback procedure and
restore matching origin/edge routes, then invalidate only affected CDN cache.
Rolling back files alone while /landing/ still redirects to root or /swap/
still points at a missing file is not a complete rollback. Do not delete or
migrate browser vaults, modify RP IDs, or clear wallet data as part of rollback.

## References

- [Google URL migration guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- [Google canonical consolidation](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google recrawl requests](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Web app manifest identity](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
- [Cloudflare Worker redirects](https://developers.cloudflare.com/workers/examples/redirect/)
