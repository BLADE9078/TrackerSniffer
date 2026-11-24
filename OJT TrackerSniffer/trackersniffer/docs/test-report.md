# Test report

Environment: Node 22.23, Google Chrome for Testing 153.0.8010.12 (Linux), tracker list `disconnect@7a9e2be`. Run on 2026-11-22.

| Suite | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **39 / 39 passed** |
| Labeled-set evaluation | `npm run evaluate` | **All 4 targets met**, see [evaluation-results.md](evaluation-results.md) |
| End-to-end (real Chrome, real extension) | `npm run e2e` | **20 / 20 checks passed**, 5 of 5 consecutive runs |
| Page-breakage checks on live sites | Manual, table in section 4 | To be filled in on your machine |

## 1. Unit tests (`tests/*.test.mjs`)

| Area | Tests | Cases covered |
|---|---|---|
| Domain extraction & normalization (`domain.test.mjs`) | 7 | Case, whitespace and dots; invalid hosts rejected; paths, queries, ports, userinfo; IPv6, punycode and IDN; missing, malformed and unsupported URLs (`data:`, `blob:`, `chrome-extension:`); PSL registrable domains (`co.uk`, `co.in`, `github.io`, IPs, localhost); first-party subdomains vs lookalikes vs uncertain; supported pages |
| Tracker matching (`trackers.test.mjs`) | 8 | Exact vs subdomain; lookalikes (`notexample.com`, `example.com.evil.net`, `example.co`, …); host-specific entries don't match parent or siblings; unknown is never "safe"; catalog validation; **66-case labeled set**; performance |
| Score (`score.test.mjs`) | 7 | 100/A baseline; weights, caps and rounding; clamping; multi-category weight; every grade boundary (90/89, 80/79, 65/64, 50/49); threshold validation; density and ratios n/a on zero denominators |
| Cookies (`cookies.test.mjs`) | 5 | **Values never copied**; first/third/uncertain; tracker match; expiry states; Secure/HttpOnly/SameSite risk flags; partitioned cookies |
| Audit builder (`audit.test.mjs`) | 8 | Full audit numbers; unsupported pages; no observation → partial with **null** counts; stale observation from another site; late start; cookie errors; no third-party resources; tracker's own site; URL sanitizing |
| Export (`export.test.mjs`) | 2 | CSV escaping, **spreadsheet formula-injection guard**, no values or queries in any export |
| Catalog (`catalog.test.mjs`) | 2 | Metadata present; every entry normalized, no paths, known category |

## 2. End-to-end test (`scripts/e2e-test.mjs`)

The test loads the unpacked extension in Chrome and serves a local "news site". Real tracker hostnames are mapped to `127.0.0.1` with `--host-resolver-rules`, so it's offline and repeatable. The page loads:
- a first-party subdomain,
- doubleclick, google-analytics, facebook, jsdelivr,
- an unknown CDN and the lookalike `notdoubleclick.net`,
- a tracker pixel 1.5 s after load.

Before that, the tab visits a criteo page and a doubleclick page.

| Check | Result |
|---|---|
| Status complete | ✓ |
| Exactly the 5 expected tracker domains recognized | ✓ |
| Previous page's requests (criteo.com) not counted | ✓ |
| Late-loading tracker captured | ✓ |
| Lookalike `notdoubleclick.net` → unknown | ✓ |
| Unknown CDN → unknown | ✓ |
| First-party subdomain → first-party | ✓ |
| Third-party domain count = 7 | ✓ |
| First-party cookies found (2) | ✓ |
| Third-party tracker cookie (`IDE` on `.doubleclick.net`) found | ✓ |
| **No cookie value appears anywhere in the audit** | ✓ |
| Score and grade present (67, C) | ✓ |
| Page still works after the audit | ✓ |
| Popup renders the grade | ✓ |
| Second scan reports comparison with the previous scan | ✓ |
| Clean page → "no tracker-list match" message | ✓ |
| No third-party domains → density n/a | ✓ |
| Page with no observation → partial, null counts, Rescan prompt | ✓ |
| `about:blank` → unsupported | ✓ |
| No JavaScript errors in the popup | ✓ |
| Settings page renders | ✓ (screenshot) |

Screenshots: `docs/screenshots/`.

**Issues found and fixed during testing**
1. A previous page's late favicon request was counted on the new page. Fix: requests made before the new document commits are buffered and attributed with `webNavigation.onCommitted` and `documentId`.
2. Right after a fresh install, Chrome sometimes restarts the extension's service worker, and requests during that restart are missed. The extension already reported these audits as **partial** ("recording started after this page loaded") rather than showing wrong counts. The e2e test now waits for the worker to settle. A normal user installs the extension long before browsing, so this only affects the first page after installation.
3. CSS class clash (`.info`) broke the layout of informational messages. Renamed.

## 3. Evaluation summary

See [evaluation-results.md](evaluation-results.md).
- Specification accuracy: 100% of 66 cases.
- Lookalike false positives: 0 of 12.
- Lookup speed: 10,000 lookups in about 9 ms.
- Audit build time: 300 hosts in about 2.5 ms.
- Against independent real-world labels: 0 false positives outside Disconnect's *Content* category.
- 2 false negatives (list coverage gaps), reported as Unknown.

## 4. Page-breakage checks on live sites (manual: fill in on your machine)

The core mode can't block anything: there are no blocking listeners and no `declarativeNetRequest` rules. These checks confirm that in practice. For each site:
1. Load it once with the extension disabled and once enabled.
2. Use the main feature listed.
3. Open the popup and click Rescan.

| Site | Main action tested | Works with extension? | Grade | Notes |
|---|---|---|---|---|
| ndtv.com | Open an article, play a video | | | |
| amazon.in | Search, open a product, add to cart | | | |
| flipkart.com | Search, filter | | | |
| bbc.com | Open an article | | | |
| youtube.com | Play a video | | | |
| github.com (logged in) | Open a repo | | | |
| A Razorpay/Stripe checkout test page | Load the payment form | | | |
| A single-page app (e.g. web.whatsapp.com) | Navigate inside the app | | | |

Limitation: passing these checks doesn't guarantee that every website will work.
