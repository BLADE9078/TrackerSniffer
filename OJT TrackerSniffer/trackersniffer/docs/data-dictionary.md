# Data dictionary

All three record types are produced by `src/lib/audit.js` and exported as CSV from the popup (**Export**) or by `analysis/sector_audit.mjs`. Nothing is sent anywhere. Cookie values are never collected.

## A. Website audit record (`Audit summary .csv`, `analysis/output/audits.csv`)

| Column | Type | Description | Null rule |
|---|---|---|---|
| audit_id | String (UUID) | Unique audit identifier | Not allowed |
| site_url | String | Audited page: origin + path. **Query string and fragment removed** | Empty only for unsupported pages |
| site_domain | String | Normalized hostname of the audited page (after redirects) | Null only for unsupported pages |
| site_sector | String | `news`, `e-commerce` or `other` | `other` by default in the popup; set by `sites.csv` in the analysis |
| audit_timestamp | ISO-8601 datetime (UTC) | When the audit was computed | Not allowed |
| audit_duration_seconds | Number | Observation window: navigation start → audit | Null when there is no observation (partial without data, unsupported) |
| unique_request_domains | Integer | Unique registrable domains observed (first- and third-party) | Zero allowed. **Null, not 0, when nothing was observed** |
| third_party_domains | Integer | Unique registrable domains outside the first-party boundary | Zero allowed / null as above |
| recognized_tracker_domains | Integer | Third-party domains matching the tracker list | Zero allowed / null as above |
| accessible_cookie_count | Integer | Cookies inspected (metadata) | Zero allowed / null as above |
| third_party_cookie_count | Integer | Cookies classified third-party | Zero allowed / null as above |
| privacy_score | Integer 0–100 | Project score | Required for complete and partial audits with data |
| privacy_grade | String A–F | Grade from the thresholds | Required for complete and partial audits with data |
| audit_status | String | `complete`, `partial`, `unsupported`, `failed` | Not allowed |
| tracker_list_version | String | e.g. `disconnect@7a9e2be` | Not allowed |

Additional computed metrics, shown in the popup and in the analysis CSV: `tracker_density` (%, null if there are no third-party domains), `third_party_cookie_ratio` (%, null if there are no classified cookies), `classification_coverage` (%), `unknown_third_party_domains`, `request_count`, `risky_cookie_count`, `lookup_ms`.

**Status rules**
- `unsupported`: not an http(s) page.
- `partial`: nothing was observed for this page (null counts and a Rescan prompt); **or** recording started after the page loaded (`late`); **or** at least one cookie lookup failed.
- `failed`: an exception or a closed tab.
- `complete`: everything else.

## B. Observed domains (`Domains .csv`)

One row per observed **hostname**.

| Column | Type | Description |
|---|---|---|
| audit_id | String | Associated audit |
| request_hostname | String | Hostname from the URL parser (lowercase, no trailing dot). **Full request URLs are not stored** |
| normalized_domain | String | Registrable domain (eTLD+1, PSL-aware), used for counting and the first-party rule |
| is_first_party | Boolean | Same registrable domain as the audited site |
| is_known_tracker | Boolean | Matches the tracker list |
| tracker_category | String | Primary category: `advertising`, `analytics`, `social`, `fingerprinting`, `cryptomining`, `email`, `content`, `anti-fraud`, `consent`, or `unknown` |
| match_rule | String | `exact`, `subdomain`, or `unmatched` |
| matched_entry | String | The list entry that matched (e.g. `doubleclick.net`) |
| owner | String | Company named by the list (e.g. Google, Meta) |
| request_count | Integer | Requests to this hostname during the window |
| first_seen_ms | Integer | Milliseconds after navigation start when the hostname was first requested (load timeline) |
| observation_timestamp | ISO datetime | Navigation start + first_seen_ms |

The popup groups these rows by `normalized_domain` (registrable domain) for counting. The **display group** for the chart is `advertising`, `analytics` or `social`; every other listed category is shown as *other*.

## C. Cookie metadata (`Cookie metadata .csv`)

| Column | Type | Description |
|---|---|---|
| audit_id | String | Associated audit |
| cookie_domain | String | Cookie's domain attribute as reported by Chrome (leading dot = domain cookie) |
| cookie_name | String | Cookie name, for local display/export only |
| is_session | Boolean | Session cookie |
| secure | Boolean | `Secure` attribute |
| http_only | Boolean | `HttpOnly` attribute |
| same_site | String | `no_restriction`, `lax`, `strict`, `unspecified` |
| partitioned | Boolean | Partitioned (CHIPS) cookie |
| expiration_status | String | `session`, `unexpired`, `expired`, `unknown` |
| party_classification | String | `first-party`, `third-party`, `uncertain` (same registrable-domain rule as requests) |
| tracker_match | Boolean | Cookie domain matches the tracker list |
| risk_flags | String (space-separated) | `missing-secure`, `missing-httponly`, `samesite-unspecified`, `samesite-none-without-secure` |

**Not collected:** cookie value, path-level contents, storage ID details.

## D. Local history (`chrome.storage.local`, Settings → Export history)

One row per audit with a score: the columns of record A plus `site` (registrable domain), `tracker_density`, and `trackers` (space-separated tracker domains, used for "new trackers since last visit"). Capped at 300 rows. Can be cleared in Settings.
