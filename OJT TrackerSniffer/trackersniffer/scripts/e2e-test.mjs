// End-to-end test: loads the unpacked extension in Chrome, serves a local fake "news site" whose
// third-party hostnames (doubleclick.net, google-analytics.com, ...) are mapped to 127.0.0.1 with
// --host-resolver-rules, then checks the audit result and screenshots the popup.
//
// Usage: CHROME_PATH=/path/to/chrome npm run e2e     (needs: npm i; Chrome/Chromium 116+)
import http from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
const SITE = 'www.testnews.in';
const SHOTS = path.join(ROOT, 'docs', 'screenshots');

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Test News</title></head><body>${body}</body></html>`;
const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, `http://${host}`);
  if (host === SITE && url.pathname === '/') {
    res.setHeader('Set-Cookie', ['session_id=abc; Path=/; HttpOnly', 'prefs=dark; Path=/; Max-Age=86400']);
    res.setHeader('Content-Type', 'text/html');
    return res.end(page(`
      <h1>Test News</h1><p>Local test page for TrackerSniffer.</p>
      <script src="http://static.testnews.in/app.js"></script>
      <script src="http://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
      <script src="http://www.google-analytics.com/analytics.js"></script>
      <script src="http://connect.facebook.net/en_US/fbevents.js"></script>
      <script src="http://cdn.jsdelivr.net/npm/lib.js"></script>
      <script src="http://fonts.example-cdn.net/font.js"></script>
      <img src="http://notdoubleclick.net/pixel.gif">
      <script>setTimeout(() => { new Image().src = 'http://pixel.quantserve.com/pixel.gif?late=1'; }, 1500);</script>`));
  }
  if (host === SITE && url.pathname === '/clean') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(page('<h1>Clean page</h1><script src="http://static.testnews.in/app.js"></script>'));
  }
  if (url.pathname === '/setcookie') {
    // visited first-party so the cookie exists in the jar for the later third-party audit
    res.setHeader('Set-Cookie', ['IDE=trackingvalue; Path=/; Domain=.doubleclick.net; Max-Age=86400']);
    res.setHeader('Content-Type', 'text/html');
    return res.end(page('cookie set'));
  }
  res.setHeader('Content-Type', url.pathname.endsWith('.gif') ? 'image/gif' : 'application/javascript');
  res.end(url.pathname.endsWith('.gif') ? Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') : '/* ok */');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const userDataDir = await mkdtemp(path.join(tmpdir(), 'ts-e2e-'));
await mkdir(SHOTS, { recursive: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    `--host-resolver-rules=MAP * 127.0.0.1:${PORT}, EXCLUDE localhost`,
    '--no-proxy-server',
    '--no-sandbox',
  ],
  viewport: { width: 1000, height: 800 },
});

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.log(`  ✗ ${name}\n    ${e.message}`); } };

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log(`Extension loaded: ${extId}`);

  context.on('console', (m) => { if (m.type() !== 'log') console.log('  [console]', m.type(), m.text()); });
  // Warm-up: a freshly installed extension's worker may restart once right after install,
  // and requests during that restart are missed (the extension then reports the audit as partial).
  await new Promise((r) => setTimeout(r, 2500));
  [sw] = context.serviceWorkers();
  const tab = await context.newPage();
  await tab.goto('http://static.criteo.com/warmup'); // a previous page on a tracker domain: its late favicon must not leak
  await tab.goto('http://securepubads.g.doubleclick.net/setcookie');
  await tab.goto(`http://${SITE}/`);
  await tab.waitForTimeout(3000);
  const tabId = await sw.evaluate(async (site) => (await chrome.tabs.query({ url: `*://${site}/*` }))[0].id, SITE);
  const audit = await sw.evaluate((id) => globalThis.trackerSniffer.runAudit(id), tabId);
  const r = audit.record;
  const trackers = audit.groups.filter((g) => g.party === 'third-party' && g.is_known_tracker).map((g) => g.domain).sort();
  const unknown = audit.groups.filter((g) => g.party === 'third-party' && !g.is_known_tracker).map((g) => g.domain).sort();
  console.log('Audit:', JSON.stringify({ status: r.audit_status, score: r.privacy_score, grade: r.privacy_grade, trackers, unknown, cookies: audit.cookies.map((c) => `${c.cookie_name}@${c.cookie_domain}:${c.party_classification}`) }));

  console.log('Messages:', JSON.stringify(audit.messages));
  console.log('Main audit');
  await check('status is complete', () => assert.equal(r.audit_status, 'complete'));
  await check('recognized trackers', () => assert.deepEqual(trackers, ['doubleclick.net', 'facebook.net', 'google-analytics.com', 'jsdelivr.net', 'quantserve.com']));
  await check('previous page\u2019s requests not counted (criteo.com)', () => assert.ok(!trackers.includes('criteo.com')));
  await check('late-loading tracker captured', () => assert.ok(trackers.includes('quantserve.com')));
  await check('lookalike notdoubleclick.net is NOT a tracker', () => assert.ok(unknown.includes('notdoubleclick.net')));
  await check('unknown CDN kept as unknown', () => assert.ok(unknown.includes('example-cdn.net')));
  await check('first-party subdomain static.testnews.in is first-party', () => assert.ok(audit.groups.find((g) => g.domain === 'testnews.in').party === 'first-party'));
  await check('third-party domain count = 7', () => assert.equal(r.third_party_domains, 7));
  await check('first-party cookies found', () => assert.equal(audit.metrics.first_party_cookie_count, 2));
  await check('third-party tracker cookie found', () => assert.ok(audit.cookies.some((c) => c.cookie_name === 'IDE' && c.party_classification === 'third-party' && c.tracker_match)));
  await check('no cookie values anywhere in the audit', () => assert.ok(!JSON.stringify(audit).includes('trackingvalue') && !JSON.stringify(audit).includes('abc;')));
  await check('score/grade present', () => assert.ok(Number.isInteger(r.privacy_score) && /^[ABCDF]$/.test(r.privacy_grade)));
  await check('page not broken (title still readable)', async () => assert.equal(await tab.title(), 'Test News'));

  // popup screenshot (popup page opened in a tab, pointed at the audited tab)
  const popup = await context.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(e.message));
  await popup.setViewportSize({ width: 400, height: 1100 });
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('#view-result:not([hidden])', { timeout: 10000 });
  await popup.screenshot({ path: path.join(SHOTS, 'popup-result.png'), fullPage: true });
  await popup.click('#why-toggle');
  await popup.click('#tab-trackers .item button');
  await popup.screenshot({ path: path.join(SHOTS, 'popup-evidence.png'), fullPage: true });
  await popup.click('[data-tab="cookies"]');
  await popup.screenshot({ path: path.join(SHOTS, 'popup-cookies.png'), fullPage: true });
  await check('popup shows grade', async () => assert.equal(await popup.textContent('#grade-badge'), r.privacy_grade));

  // second visit: history comparison
  const audit2 = await sw.evaluate((id) => globalThis.trackerSniffer.runAudit(id), tabId);
  console.log('History');
  await check('comparison against previous scan', () => assert.ok(audit2.comparison && audit2.comparison.previous_grade === r.privacy_grade));

  // clean page: no trackers
  await tab.goto(`http://${SITE}/clean`);
  await tab.waitForTimeout(1000);
  const clean = await sw.evaluate((id) => globalThis.trackerSniffer.runAudit(id), tabId);
  console.log('No-match page');
  await check('no trackers -> clear message', () => assert.ok(clean.record.recognized_tracker_domains === 0 && clean.messages.some((m) => /did not|does not|No observed/.test(m.text))));
  await check('no third-party domains -> density n/a', () => assert.equal(clean.metrics.tracker_density, null));
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('#view-result:not([hidden])');
  await popup.screenshot({ path: path.join(SHOTS, 'popup-no-trackers.png'), fullPage: true });

  // no-data state: wipe observations, then audit
  console.log('No-data / unsupported states');
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${tabId}`);
  await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'resetTab', tabId: id }), tabId);
  const partial = await sw.evaluate((id) => globalThis.trackerSniffer.runAudit(id), tabId);
  await check('no observation -> partial, no zero counts', () => assert.ok(partial.record.audit_status === 'partial' && partial.record.third_party_domains === null && partial.score === null));
  await popup.reload();
  await popup.waitForSelector('#view-message:not([hidden])');
  await popup.screenshot({ path: path.join(SHOTS, 'popup-no-data.png') });

  const blank = await context.newPage();
  await blank.goto('about:blank');
  const blankId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'about:blank' }))[0].id);
  const unsupported = await sw.evaluate((id) => globalThis.trackerSniffer.runAudit(id), blankId);
  await check('about:blank -> unsupported', () => assert.equal(unsupported.record.audit_status, 'unsupported'));
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${blankId}`);
  await popup.waitForSelector('#view-message:not([hidden])');
  await popup.screenshot({ path: path.join(SHOTS, 'popup-unsupported.png') });

  // options page
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extId}/src/options/options.html`);
  await options.waitForTimeout(800);
  await options.screenshot({ path: path.join(SHOTS, 'options.png'), fullPage: true });
  await check('popup had no JS errors', () => assert.deepEqual(errors, []));
  await new Promise((r) => setTimeout(r, 300));
} finally {
  await context.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);
