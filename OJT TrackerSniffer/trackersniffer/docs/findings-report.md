# TrackerSniffer — findings report

> **Status:** Sections 1–3 and 5–6 are complete. Section 4 (news vs e-commerce) has to be filled in from your own run of `analysis/sector_audit.mjs` → `analysis/output/summary.md`. It needs a live internet connection, so no numbers were made up here.

## 1. Question

Can a browser extension identify third-party domains and cookies on a website, classify known trackers with an offline list, and present an understandable privacy score — without collecting cookie values or browsing history?

**Hypothesis:** combining observed request origins, cookie metadata and a curated tracker list gives a useful summary of third-party tracking activity.

## 2. Method

- **Extension:** Chrome Manifest V3.
  - Non-blocking `webRequest` observation, with requests attributed to the committed document via `webNavigation`.
  - `chrome.cookies` metadata only.
  - First-/third-party boundary = registrable domain (Public Suffix List).
  - Exact or subdomain matching against the Disconnect list (4,472 domains, commit `7a9e2be`).
- **Score:** `100 − Σ category weights − min(20, unknown third-party domains) − min(15, 0.5 × third-party cookies)`, graded A–F at 90/80/65/50.
- **Validation:**
  - 39 unit tests.
  - A 66-case labeled domain set: known trackers, CDNs, lookalikes, malformed URLs.
  - An end-to-end test in real Chrome against a controlled local site with known contents.

## 3. Results — accuracy and reliability

| Measure | Target | Result |
|---|---|---|
| Hostname extraction and matching follow the specification | 100% | **100%** (66 of 66) |
| False positives on lookalike domains | 0 | **0 of 12** |
| Matching speed | 10,000 lookups < 100 ms | **≈ 9 ms** (≈ 1 µs per lookup) |
| Audit computation | 300 hosts < 20 ms | **≈ 2.5 ms** |
| Controlled site, real Chrome: correct trackers, cookies, states | all checks | **20 of 20** |

On the controlled test page the extension found:
- the 5 expected tracker domains, including one that loaded 1.5 s late,
- the lookalike and the unknown CDN, kept as *unknown*,
- 2 first-party cookies and 1 third-party tracker cookie, with no cookie values captured.

It graded the page **C (67/100)**. The page kept working.

The list itself has limits. Measured against independent real-world labels:
- **Precision 79%, recall 93%.**
- Every false positive was a CDN or embed that Disconnect deliberately lists as *Content* (e.g. fonts.gstatic.com, cdn.jsdelivr.net). These are shown as "Embedded content" and cost only 1 point.
- The 2 misses (googletagmanager.com, wzrkt.com) aren't hostname entries in this list version.

The classifier is reliable. Detection quality depends on the list.

## 4. Results — news vs e-commerce *(fill in after running the sector audit)*

Sample: ___ news and ___ e-commerce home pages (`analysis/sites.csv`), ___-second window, no consent interaction, Chrome ___, run on ___ from ___ (city/country).

| | News | E-commerce |
|---|---|---|
| Audits attempted / complete (completion rate) | ___ / ___ (___%) | ___ / ___ (___%) |
| Mean recognized tracker domains per site | ___ | ___ |
| Median recognized tracker domains per site | ___ | ___ |
| Median tracker density | ___% | ___% |
| Sector tracker density (Σ trackers ÷ Σ third-party) | ___% | ___% |
| Median privacy score | ___ | ___ |
| Same comparison including partial audits | ___ | ___ |

Most common tracker owners: ___ (chart `05_top_tracker_owners.png`).

Interpretation (2–3 sentences): ___

Charts: `analysis/output/01_trackers_mean_median.png`, `02_tracker_density.png`, `03_audit_completion.png`, `04_classification_coverage.png`, `05_top_tracker_owners.png`.

## 5. Limitations

- Results describe activity **observed in one window on one page**. Lazy-loaded and post-consent trackers, and non-network techniques (canvas fingerprinting, first-party CNAME cloaking, server-side tagging), may be missed.
- An unknown domain isn't necessarily safe, and a listed domain isn't proof of tracking on that page.
- `chrome.cookies` reports every accessible cookie for the observed domains, including ones set on earlier visits. The sector audit clears cookies before each site to keep the comparison fair.
- The score weights are a transparent project heuristic, not a privacy certification or a legal compliance assessment.
- The site sample is hand-picked and small, and results vary with country, time and consent state.

## 6. Conclusions

- The hypothesis holds for the extension: observed origins plus cookie metadata plus an offline list produce an accurate, explainable summary.
  - Zero lookalike false positives.
  - Clear handling of unsupported, partial and no-match cases.
  - No cookie values or browsing history leave the browser.
- The main weakness is **list coverage**, not the matching logic. Showing unknown domains separately, and recording the list version, keeps the result honest.
- The decision it supports: a **D or F grade, or a large share of unknown third-party domains**, is a signal to look at the site more closely. Owner names, categories and load times in the evidence drawer show which domains drive the result.
