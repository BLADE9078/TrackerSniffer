// Optional sector analysis, step 1: audit a list of websites with the real extension.
//
// Repeatable procedure (documented in analysis/README.md):
//   - one Chrome profile with only TrackerSniffer installed; cookies cleared before every site
//   - load the home page, wait --wait seconds (default 10), scrolling once halfway through
//   - no clicks: consent banners are left untouched, so results reflect the pre-consent state
//   - the extension's own audit (same code as the popup) produces the record
//
// Usage:
//   node analysis/sector_audit.mjs [--sites analysis/sites.csv] [--out analysis/output] [--wait 10]
//                                  [--limit N] [--headless] [--chrome /path/to/chrome]
//                                  [--chrome-args="--flag1|--flag2"]
import { readFile, writeFile, mkdir, mkdtemp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { toCsv, AUDIT_COLUMNS } from '../src/lib/export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq > 0) args[a.slice(2, eq)] = a.slice(eq + 1); // --key=value
  else if (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) args[a.slice(2)] = process.argv[++i];
  else args[a.slice(2)] = true;
}
const SITES = path.resolve(args.sites || path.join(ROOT, 'analysis/sites.csv'));
const OUT = path.resolve(args.out || path.join(ROOT, 'analysis/output'));
const WAIT = Number(args.wait || 10);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CHROME = args.chrome || process.env.CHROME_PATH || defaultChrome();
const EXTRA = args['chrome-args'] ? String(args['chrome-args']).split('|') : []; // extra Chrome flags separated by |

function defaultChrome() {
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return '/usr/bin/google-chrome';
}

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
}

const sites = parseCsv(await readFile(SITES, 'utf8')).slice(0, LIMIT);
await mkdir(OUT, { recursive: true });
const auditsFile = path.join(OUT, 'audits.csv');
const domainsFile = path.join(OUT, 'domains.csv');
const AUDIT_OUT_COLUMNS = [...AUDIT_COLUMNS, 'region', 'tracker_density', 'unknown_third_party_domains', 'classification_coverage', 'request_count', 'error'];
const DOMAIN_OUT_COLUMNS = ['audit_id', 'site_url', 'site_sector', 'domain', 'party', 'is_known_tracker', 'category', 'owner', 'request_count', 'first_seen_ms'];
await writeFile(auditsFile, toCsv([], AUDIT_OUT_COLUMNS));
await writeFile(domainsFile, toCsv([], DOMAIN_OUT_COLUMNS));
const meta = { started_at: new Date().toISOString(), wait_seconds: WAIT, chrome: CHROME, headless: !!args.headless, sites_file: SITES, site_count: sites.length };

const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ts-sector-')), {
  executablePath: CHROME,
  headless: !!args.headless,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, ...EXTRA],
  viewport: { width: 1366, height: 850 },
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
await new Promise((r) => setTimeout(r, 2500)); // let the freshly installed worker settle
[sw] = context.serviceWorkers();
meta.chrome_version = context.browser()?.version() || 'unknown';

let n = 0;
for (const site of sites) {
  n++;
  const row = { site_url: site.site_url, site_sector: site.site_sector, region: site.region || '', audit_status: 'failed', audit_timestamp: new Date().toISOString() };
  let page;
  try {
    await context.clearCookies();
    page = await context.newPage();
    await page.goto(site.site_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout((WAIT * 1000) / 2);
    await page.evaluate(() => window.scrollTo(0, document.body ? document.body.scrollHeight / 2 : 0)).catch(() => {});
    await page.waitForTimeout((WAIT * 1000) / 2);
    const finalUrl = page.url();
    const tabId = await sw.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => x.url === url) || tabs.find((x) => x.active);
      return t ? t.id : null;
    }, finalUrl);
    if (tabId === null) throw new Error('tab not found');
    const audit = await sw.evaluate(({ id, sector }) => globalThis.trackerSniffer.runAudit(id, { sector }), { id: tabId, sector: site.site_sector });
    Object.assign(row, audit.record, {
      site_sector: site.site_sector,
      tracker_density: audit.metrics?.tracker_density ?? '',
      unknown_third_party_domains: audit.metrics?.unknown_third_party_domains ?? '',
      classification_coverage: audit.metrics?.classification_coverage ?? '',
      request_count: audit.metrics?.request_count ?? '',
      error: audit.record.audit_status === 'complete' ? '' : audit.messages.map((m) => m.text).join(' | '),
    });
    row.site_url = site.site_url;
    const domainRows = audit.groups.map((g) => ({
      audit_id: audit.record.audit_id, site_url: site.site_url, site_sector: site.site_sector, domain: g.domain, party: g.party,
      is_known_tracker: g.is_known_tracker, category: g.category, owner: g.owner || '', request_count: g.request_count, first_seen_ms: g.first_seen_ms,
    }));
    await appendFile(domainsFile, toCsv(domainRows, DOMAIN_OUT_COLUMNS).split('\r\n').slice(1).join('\r\n'));
  } catch (e) {
    row.error = String(e && e.message ? e.message.split('\n')[0] : e);
  } finally {
    if (page) await page.close().catch(() => {});
  }
  await appendFile(auditsFile, toCsv([row], AUDIT_OUT_COLUMNS).split('\r\n').slice(1).join('\r\n'));
  console.log(`[${n}/${sites.length}] ${row.audit_status.padEnd(8)} ${row.privacy_grade ?? '-'} trackers=${row.recognized_tracker_domains ?? '-'} ${site.site_url}${row.error ? `  (${row.error.slice(0, 80)})` : ''}`);
}

meta.finished_at = new Date().toISOString();
const list = await sw.evaluate(async () => (await globalThis.trackerSniffer.getIndex()).meta);
meta.tracker_list = list;
await writeFile(path.join(OUT, 'run-metadata.json'), JSON.stringify(meta, null, 2) + '\n');
await context.close();
console.log(`\nDone. Wrote ${auditsFile} and ${domainsFile}. Next: python analysis/analyze.py`);
