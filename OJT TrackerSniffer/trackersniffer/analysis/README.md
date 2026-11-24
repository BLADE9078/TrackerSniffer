# Optional sector analysis: news vs e-commerce

This answers PRD sub-question 4: *how does observed tracker density differ between news and e-commerce websites?*

It runs the **real extension** (the same audit code as the popup) against the site list, then compares the two sectors with pandas and matplotlib.

## 1. Run the audits (needs internet and Chrome)

```bash
npm install                                     # playwright-core (drives your installed Chrome)
node analysis/sector_audit.mjs --wait 10        # ~20–25 min for 100 sites
# options: --limit 10 (try a few first) · --headless · --chrome "/path/to/chrome" · --sites my_sites.csv
```

On Windows, if Chrome isn't in the default location, add `--chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"`.

Running with a visible window (the default) is recommended. Some sites behave differently in headless mode.

### Audit procedure (keep it the same for every run)

| Setting | Value |
|---|---|
| Sample | `analysis/sites.csv`: 50 news and 50 e-commerce home pages (25 Indian and 25 global per sector), hand-picked popular sites, **not a random sample** |
| Browser | A fresh Chrome profile with only TrackerSniffer installed. Chrome version and tracker-list version are recorded in `run-metadata.json` |
| Cookies | All cookies are cleared before each site |
| Page | Home page only. Load it (DOMContentLoaded), wait half the window, scroll halfway down, wait the other half |
| Window | 10 s (`--wait`) |
| Consent | Banners are **not** clicked, so results reflect the pre-consent state |
| Network | Your own connection and location. Record them in the findings report, because results vary by country |
| Access | Public home pages only, at normal browsing speed (one page at a time). No logins, no paywall bypassing, no crawling |

Each site ends up `complete`, `partial` or `failed` (timeout, blocked or unreachable). Failed audits are kept in `audits.csv` with the error message so the completion rate can be reported.

**Outputs** in `analysis/output/`:
- `audits.csv`: data dictionary A, plus region, density, unknown count, coverage and error
- `domains.csv`: one row per site and observed registrable domain
- `run-metadata.json`

## 2. Analyse

```bash
pip install pandas matplotlib
python analysis/analyze.py
```

This writes the following to `analysis/output/`:

| File | Contents |
|---|---|
| `summary.md` | Completion table, sector statistics for **complete audits only**, the same statistics for complete + partial audits (robustness check), a cleaning log and limitations |
| `sector_summary.csv`, `audit_completion.csv` | The tables |
| `01_trackers_mean_median.png` | Mean and median recognized tracker domains per site |
| `02_tracker_density.png` | Distribution of tracker density per site (box plus points) |
| `03_audit_completion.png` | Complete, partial and failed audits by sector |
| `04_classification_coverage.png` | Third-party domains that were recognized vs unknown |
| `05_top_tracker_owners.png` | Companies whose trackers appear on the most sites |

Copy the numbers into `docs/findings-report.md`.

**Definitions** (same as the extension):
- Tracker density = recognized tracker domains ÷ unique third-party domains × 100, per site. Sites with no third-party domains are excluded as n/a.
- Sector density = Σ trackers ÷ Σ third-party domains across the sector's complete audits.
