# Cleaning and preparation log

## 1. Tracker list (`scripts/build-tracker-catalog.mjs` → `data/catalog-build-log.json`)

Source: Disconnect `services.json`, commit `7a9e2be`, retrieved 2026-11-22.

| Problem | Action | Result |
|---|---|---|
| Raw domain entries across 11 categories | Flatten category → company → domains | **4,821** entries |
| Path-scoped rules (e.g. `google.com/pagead/1p-user-list`, `yandex.ru/ads/`) | **Dropped**. Hostname-only matching can't apply them, and keeping the host part would flag all of google.com / yandex.ru | **7** dropped |
| Uppercase, leading/trailing dots, whitespace | Lowercase and trim | **0** entries needed changes |
| Invalid hostnames | Rejected by `normalizeHostname()` | **0** |
| Same domain listed more than once | Deduplicated by normalized domain | **342** duplicates merged |
| Domain in several categories (e.g. Advertising + FingerprintingInvasive) | Keep all categories. The primary category is chosen by priority advertising > analytics > social > fingerprinting > cryptomining > email > content > anti-fraud > consent | **335** domains reconciled |
| Same domain under different companies | Owner taken from the primary category | **0** conflicts |
| Category names | Mapped: Advertising→advertising, Analytics→analytics, Social→social, FingerprintingInvasive/General→fingerprinting, Cryptomining→cryptomining, Email/EmailAggressive→email, Content→content, Anti-fraud→anti-fraud, ConsentManagers→consent | 0 unmapped |
| Entity flags (`session-replay`, `performance`, `dnt`) | Kept as tags (shown as "Notes" in the evidence drawer) | — |
| Staleness | Version (`disconnect@<commit>`) and retrieval date stored in `meta` and shown in the popup footer and Settings | — |

Result: **4,472** unique hostnames.

| Primary category | Domains |
|---|---|
| Advertising | 2,740 |
| Analytics | 520 |
| Email | 453 |
| Content | 394 |
| Fingerprinting | 239 |
| Social | 50 |
| Cryptomining | 33 |
| Anti-fraud | 29 |
| Consent | 14 |

To refresh: `npm run fetch-list && npm run build-catalog`, then reload the extension, or upload `data/trackers.json` in Settings.

## 2. Observed requests and cookies (at runtime, per audit)

| Problem | Action | Where it's recorded |
|---|---|---|
| Uppercase hostnames | Lowercased by the URL parser and `normalizeHostname()` | — (always applied) |
| URLs with paths, queries, ports, credentials | Hostname taken with `new URL()`, rest discarded. Full URLs never stored | — |
| Leading/trailing dots (e.g. cookie domain `.doubleclick.net`, `doubleclick.net.`) | Trimmed before comparison | — |
| Non-network schemes (`data:`, `blob:`, `chrome-extension:`), malformed URLs | Not counted | `metrics.dropped_requests` by reason (`unsupported-scheme`, `malformed-url`, `invalid-hostname`) |
| Duplicate requests to one hostname | Counted once for unique-domain metrics; `request_count` kept separately | Domains CSV `request_count`; footer shows requests vs hosts |
| Several hostnames of one registrable domain | Grouped for counts, hostnames kept as evidence | Evidence drawer |
| Tracker appears as a subdomain | Subdomain rule | `match_rule` column |
| Lookalike domains (`notdoubleclick.net`) | Label-boundary matching only | Tests: 12 of 12 rejected |
| Unknown classification | Labeled `unknown`, never `safe` | Unknown tab, `unknown_third_party_domains` |
| Requests from the previous page arriving after a new navigation (e.g. favicon) | Buffered until the navigation commits; kept only if they belong to the committed document | `metrics.dropped_requests['previous-page']` |
| Website redirects | Same request ID for server redirects: the observation is kept and the final URL becomes the site | `metrics.redirects` (hosts redirected through) |
| Late-loading resources | Everything until the popup opens is included; Rescan gives a fixed window (Settings, default 10 s) | `audit_duration_seconds`, `first_seen_ms` |
| Page loaded before the extension started, or back/forward-cache restore | Audit marked `partial` (no zero counts) | `audit_status`, popup message |
| Cookie lookup errors | Audit marked `partial` | `audit_status`, message |
| Cookies returned by several queries | Deduplicated by domain + path + name + store + partition | — |
| Unsupported pages | `unsupported`, excluded from comparisons | `audit_status` |
| More than 2,000 hostnames on one tab | Further new hosts not stored (guards storage) | `dropped_requests['host-limit']` |

## 3. Sector analysis (`analysis/analyze.py`)

Sector labels are normalized. Duplicate site rows are removed (last attempt kept). Rows outside news/e-commerce are excluded. Numeric columns are coerced. Statistics use **complete audits only**; a second table includes partial audits as a robustness check. Failed audits count only in the completion rate. The run's counts are written to `analysis/output/summary.md`.
