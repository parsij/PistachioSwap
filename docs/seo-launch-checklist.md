# Product guides and Google sitelinks

## Public page map

| Page | Canonical URL | Purpose |
| --- | --- | --- |
| Swap app | https://pistachioswap.com/swap/ | Branded app entry and crawlable guide links |
| About | https://pistachioswap.com/ | Product overview |
| Pistachio Wallet | https://pistachioswap.com/landing/wallet/ | Self-custody, passkeys, compatibility, recovery |
| Gas Assist | https://pistachioswap.com/landing/gas-assist/ | Getting started and BNB Chain sponsorship |
| How Pistachio Swap works | https://pistachioswap.com/landing/how-it-works/ | Quotes, approvals, routes, costs, confirmation |
| Gas Assist fees and eligibility | https://pistachioswap.com/gas-assist/ | Detailed cost, eligibility, atomic execution |
| FAQ | https://pistachioswap.com/landing/faq/ | Short answers and complete-guide links |

The home page and guides are static HTML: no wallet connection or JavaScript is needed to read them. New pages have distinct titles, descriptions, canonicals, social metadata, WebPage and BreadcrumbList structured data. The root retains WebSite/Organization identity. Important pages link to the guides using ordinary HTML anchors, including on mobile. Both original Gas Assist URLs remain: the overview and in-depth fee guide have different roles.

The sitemap lists canonical URLs only. No invented modification dates are generated. Google ignores priority/changefreq, so those hints were removed. Structured data describes visible content; it does not select sitelinks. Existing FAQ/HowTo markup is not a promise of a Google rich result.

## Required release work — not performed by this PR

1. Follow [the root/swap migration runbook](root-swap-migration.md) for the coordinated URL cutover. Merge and deploy through the normal release process. The deployment workflow does **not** automatically apply the nginx/optional Worker examples.
2. Have the server owner review and apply the changes in `deploy/nginx-origin-cache.conf` to the active configuration. Remove the old User-Agent-based `$pistachio_index` mapping and serve the static `/index.html` at `/` and the wallet `/swap/index.html` at `/swap/` for everyone. Apply exact `/landing/` → `/` redirects without redirecting its guide children. Preserve existing TLS, security headers, API/health proxies, and other site-specific locations. Run `nginx -t` before reloading.
3. If the optional `deploy/cloudflare-cache-and-crawlers.js` Worker is deployed, update it too. It must use the same migration redirects for humans and crawlers, without rewriting crawler requests to `/landing/`. Updating only frontend files will not remove an old edge/origin rewrite.
4. Invalidate affected cached HTML, `robots.txt`, `sitemap.xml`, and `site.webmanifest` after deployment. Keep Cloudflare from replacing/prepending the intended robots policy. Allow verified search crawlers to fetch public CSS, JavaScript, images, and guides. Preserve the separate training-crawler policy. Do not disable WAF protections globally or trust a claimed Googlebot User-Agent as authentication.
5. Complete the production checks below before requesting indexing. Do not submit localhost or preview URLs to Google.

This PR does not change Search Console, DNS, WAF settings, or the live server.

## Production acceptance checks

- All seven canonical URLs return HTTP 200 HTML and their own canonical/og:url, without a noindex meta or X-Robots-Tag header.
- Normal and Googlebot requests to `/` return the same landing title, self-canonical `https://pistachioswap.com/`, and visible guide links. Previously a crawler could receive the landing page and its different canonical at the root. Do not restore that mismatch.
- Verify `/landing/` returns HTTP 301 to `/`, `/swap` redirects to `/swap/`, and old `/?route=…` links retain their query at `/swap/`.
- Check mobile/desktop guide navigation, on-page links, and Open wallet. Reading a guide must not require wallet setup.
- A nonexistent guide such as `/landing/seo-missing-check/` returns 404, not a 200 app shell. Directory URLs without the final slash should redirect to the slash form at the origin.
- HTTP and www variants should redirect to the chosen HTTPS/non-www host, preserving the path. Those deployment-specific redirects are not changed here.
- Fetch the live robots.txt and sitemap.xml. Confirm the new URLs and that the Googlebot group no longer blocks /assets/. Robots rules control crawling, not confidentiality or guaranteed removal from search.
- Use Search Console's live URL test to inspect rendered HTML/screenshot and blocked/challenged resources. After recrawl, compare user-declared and Google-selected canonicals.

Local regression commands:

```sh
pnpm test
pnpm build
node scripts/check-public-seo.mjs
# After starting a built preview, or after deployment:
node scripts/check-public-routes.mjs http://127.0.0.1:5176
```

The standalone SEO build check verifies actual built HTML, unique metadata, JSON-LD, sitemap, guide links, local resources, and fragment targets. Run it after building. CI already runs the source-level guide and edge tests. This PR does not change the owner-protected build configuration. These checks cannot verify the deployed edge, indexing, or real passkey/device compatibility.

## Site-owner steps in Google Search Console

1. If not configured, add a **Domain property** for `pistachioswap.com` in [Search Console](https://search.google.com/search-console/). At your DNS provider, add the exact verification record Google supplies, verify, and leave the record in place. Do not invent a token or publish credentials. [Ownership verification](https://support.google.com/webmasters/answer/9008080).
2. Under **Sitemaps**, submit `https://pistachioswap.com/sitemap.xml`. Confirm it is read successfully and the discovered URLs are correct. This helps discovery but does not guarantee indexing. [Google's sitemap guide](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
3. Use **URL Inspection → Test live URL → Request indexing** for the root and `/swap/` after the migration, plus any changed Wallet/How it works or Gas Assist guides after the production checks pass. Repeated submissions do not speed processing. [Recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).
4. Check **Page indexing** for blocked/noindex, duplicate/canonical, soft-404, and server errors. In **Performance**, track branded queries such as Pistachio Swap and Pistachio Wallet, plus each guide's impressions/clicks. Compare meaningful periods, not a single personalized search screenshot.
5. Keep official website links and product names consistent on profiles you control. Update guides when fees, route support, recovery, compatibility, or audit status change. Do not buy links or manufacture reviews/trust claims.

## Expectations and content accuracy

Google selects sitelinks automatically by query and site structure. There is no switch, schema property, payment, or guaranteed date that makes the result match Uniswap. These changes improve discoverability and clarity; they do not guarantee ranking. [Google's sitelinks guidance](https://developers.google.com/search/docs/appearance/sitelinks).

Gas Assist is not free or universal. Preserve the BNB Chain limitation, quote-dependent availability, and distinction between an atomic sponsored revert and a normal transaction's gas costs. Do not describe all wallets or networks as gasless.

Pistachio Wallet is an optional browser wallet. A passkey is not a blockchain key or an independent wallet backup. Recovery depends on wallet source and authenticator compatibility. Preserve the unaudited/pre-release disclosure until there is verifiable audit evidence.

Content was checked against `docs/pistachio-passkey-wallet.md`, current wallet-manager curated-network validation, `docs/SAME_CHAIN_SWAP_FLOW.md`, and Gas Assist signing validation. The older wallet document's BNB-only introduction conflicts with the current curated-network code, so the guide does not repeat that stale wallet-wide restriction. Gas Assist remains BNB Chain-specific.

The deployment examples use the same URL/content for humans and bots, following [Google's rendering guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering). CSS/JS remain crawlable under [Google's robots guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro). The optional Worker's streamed responses and API no-store behavior are preserved.
