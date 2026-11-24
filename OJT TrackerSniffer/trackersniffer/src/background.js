// TrackerSniffer service worker (Manifest V3).
// Read-only: observes request metadata with non-blocking webRequest listeners and reads cookie
// metadata on demand. It never blocks or modifies requests and never sends data anywhere.
import { createTrackerIndex, matchTracker } from './lib/trackers.js';
import { buildAudit, sanitizePageUrl } from './lib/audit.js';
import { hostnameFromUrl, registrableDomain, classifyParty, isSupportedPageUrl } from './lib/domain.js';
import { DEFAULT_THRESHOLDS, validateThresholds } from './lib/score.js';
import { cookieKey } from './lib/cookies.js';

const MAX_HOSTS_PER_TAB = 2000;
const MAX_COOKIE_DOMAINS = 200;
const MAX_HISTORY = 300;
const DEFAULT_SETTINGS = { thresholds: DEFAULT_THRESHOLDS, observationSeconds: 10 };

// ---------- tracker index ----------
let indexPromise = null;
function getIndex() {
  if (!indexPromise) indexPromise = loadIndex().catch((e) => { indexPromise = null; throw e; });
  return indexPromise;
}
async function loadIndex() {
  const { customCatalog } = await chrome.storage.local.get('customCatalog');
  if (customCatalog) {
    try { return createTrackerIndex(customCatalog); } catch (e) { console.warn('Custom tracker list invalid, using bundled list', e); }
  }
  const res = await fetch(chrome.runtime.getURL('data/trackers.json'));
  return createTrackerIndex(await res.json());
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.customCatalog) indexPromise = null;
});

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (validateThresholds(s.thresholds)) s.thresholds = DEFAULT_THRESHOLDS;
  return s;
}

// ---------- per-tab observation state ----------
// Kept in memory and mirrored to chrome.storage.session, because MV3 service workers are
// stopped when idle and in-memory state would otherwise be lost.
const cache = new Map();
const queues = new Map();
const dirty = new Set();
let flushTimer = null;
const key = (tabId) => `tab:${tabId}`;

async function getState(tabId) {
  if (cache.has(tabId)) return cache.get(tabId);
  const stored = (await chrome.storage.session.get(key(tabId)))[key(tabId)] || null;
  if (stored) cache.set(tabId, stored);
  return stored;
}
function setState(tabId, state) {
  cache.set(tabId, state);
  dirty.add(tabId);
  if (!flushTimer) flushTimer = setTimeout(flush, 150);
}
async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!dirty.size) return;
  const items = {};
  for (const id of dirty) if (cache.has(id)) items[key(id)] = cache.get(id);
  dirty.clear();
  try { await chrome.storage.session.set(items); } catch (e) { console.warn('session storage write failed', e); }
}
/** Serialize work per tab so a navigation reset is never overtaken by its sub-resources. */
function enqueue(tabId, fn) {
  const prev = queues.get(tabId) || Promise.resolve();
  const next = prev.then(fn).catch((e) => console.warn('TrackerSniffer event error', e));
  queues.set(tabId, next);
  return next;
}

function newState(details, url) {
  return {
    pageUrl: sanitizePageUrl(url), mainRequestId: details.requestId, startedAt: details.timeStamp,
    pending: true,      // true between the navigation request and its commit
    documentId: null,   // documentId of the committed top-level document
    redirects: [], hosts: {}, dropped: {}, trackerDomains: [], late: false, buffer: [],
  };
}

const pick = (d) => ({ url: d.url, type: d.type, timeStamp: d.timeStamp, frameId: d.frameId, documentId: d.documentId, parentDocumentId: d.parentDocumentId, initiator: d.initiator });

/** Does a request seen before commit belong to the newly committed document? */
function belongsToCommitted(req, documentId, pageUrl) {
  if (req.documentId) return req.documentId === documentId || req.parentDocumentId === documentId;
  if (req.parentDocumentId) return req.parentDocumentId === documentId;
  if (!req.initiator || req.initiator === 'null') return false;
  const a = registrableDomain(hostnameFromUrl(req.initiator).hostname || '');
  return !!a && a === registrableDomain(hostnameFromUrl(pageUrl).hostname || '');
}

async function recordHost(state, tabId, details) {
  const { hostname, error } = hostnameFromUrl(details.url);
  if (!hostname) {
    state.dropped[error] = (state.dropped[error] || 0) + 1;
    return;
  }
  let h = state.hosts[hostname];
  if (!h) {
    if (Object.keys(state.hosts).length >= MAX_HOSTS_PER_TAB) { state.dropped['host-limit'] = (state.dropped['host-limit'] || 0) + 1; return; }
    h = state.hosts[hostname] = { count: 0, firstSeenMs: Math.max(0, Math.round(details.timeStamp - state.startedAt)), types: {} };
    // live toolbar badge: number of third-party tracker domains seen so far
    const siteHost = state.pageUrl ? hostnameFromUrl(state.pageUrl).hostname : null;
    if (siteHost && classifyParty(hostname, siteHost) === 'third-party') {
      const index = await getIndex();
      if (matchTracker(hostname, index).matched) {
        const reg = registrableDomain(hostname);
        if (!state.trackerDomains.includes(reg)) {
          state.trackerDomains.push(reg);
          setBadge(tabId, String(state.trackerDomains.length), '#52514e');
        }
      }
    }
  }
  h.count++;
  h.types[details.type] = (h.types[details.type] || 0) + 1;
}

async function onRequest(details) {
  const { tabId } = details;
  if (details.type === 'main_frame') {
    let state = await getState(tabId);
    if (state && state.mainRequestId === details.requestId) {
      // same request id = server redirect: keep observations, record the hop
      const prevHost = hostnameFromUrl(state.pageUrl).hostname;
      if (prevHost) state.redirects.push(prevHost);
      state.pageUrl = sanitizePageUrl(details.url);
    } else {
      if (!isSupportedPageUrl(details.url)) { cache.delete(tabId); await chrome.storage.session.remove(key(tabId)); return; }
      state = newState(details, details.url);
      setBadge(tabId, '', null);
    }
    await recordHost(state, tabId, details);
    setState(tabId, state);
    await flush(); // write navigation resets through immediately
    return;
  }
  let state = await getState(tabId);
  if (!state) {
    // Service worker started after the page loaded: record what we can, flag the audit as partial.
    state = await lateState(tabId, details.timeStamp);
    if (!state) return;
  }
  // Requests that belong to the previous page (e.g. its favicon) can arrive after the new
  // navigation request but before the new document commits. They are not counted.
  // Until the commit arrives we can't tell which document they belong to, so they are buffered
  // and replayed (or discarded) in onCommitted().
  if (state.pending) {
    if (state.buffer.length < 500) state.buffer.push(pick(details));
    setState(tabId, state);
    return;
  }
  if (details.frameId === 0 && details.documentId && state.documentId && details.documentId !== state.documentId && details.type !== 'main_frame') {
    state.dropped['previous-page'] = (state.dropped['previous-page'] || 0) + 1; setState(tabId, state); return;
  }
  await recordHost(state, tabId, details);
  setState(tabId, state);
}

async function lateState(tabId, timeStamp, url) {
  let pageUrl = url;
  if (!pageUrl) {
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch { return null; }
    pageUrl = tab && tab.url;
  }
  if (!pageUrl || !isSupportedPageUrl(pageUrl)) return null;
  const state = newState({ requestId: null, timeStamp }, pageUrl);
  state.pending = false;
  state.late = true;
  return state;
}

/** Top-level document committed: from now on, only its requests are counted. */
async function onCommitted(details) {
  const { tabId } = details;
  let state = await getState(tabId);
  if (!isSupportedPageUrl(details.url)) return;
  if (!state || (!state.pending && state.documentId && state.documentId !== details.documentId)) {
    // A page shown without a network navigation (back/forward cache, prerender activation):
    // its earlier requests were never observed in this state, so the audit will be partial.
    state = await lateState(tabId, details.timeStamp, details.url);
    if (!state) return;
    setBadge(tabId, '', null);
  }
  state.pending = false;
  state.documentId = details.documentId || null;
  state.pageUrl = sanitizePageUrl(details.url);
  const buffered = state.buffer || [];
  state.buffer = [];
  for (const req of buffered) {
    if (belongsToCommitted(req, state.documentId, state.pageUrl)) await recordHost(state, tabId, req);
    else state.dropped['previous-page'] = (state.dropped['previous-page'] || 0) + 1;
  }
  setState(tabId, state);
  await flush();
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  enqueue(details.tabId, () => onCommitted(details));
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return; // not attributable to a tab (e.g. extension or service-worker requests)
    enqueue(details.tabId, () => onRequest(details));
  },
  { urls: ['<all_urls>'] } // no 'blocking' option: observation only
);

chrome.tabs.onRemoved.addListener((tabId) => {
  cache.delete(tabId);
  queues.delete(tabId);
  dirty.delete(tabId);
  chrome.storage.session.remove(key(tabId));
});

function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}
const GRADE_BADGE = { A: '#0ca30c', B: '#0ca30c', C: '#b07a00', D: '#d0612f', F: '#d03b3b' };

// ---------- cookies ----------
async function collectCookies(state, siteUrl) {
  const site = hostnameFromUrl(siteUrl).hostname;
  const domains = new Set([registrableDomain(site)]);
  for (const h of Object.keys(state.hosts)) { const r = registrableDomain(h); if (r) domains.add(r); }
  const list = [...domains].slice(0, MAX_COOKIE_DOMAINS);
  const seen = new Map();
  let errors = 0;
  const topLevelSite = `${new URL(siteUrl).protocol}//${registrableDomain(site)}`;
  await Promise.all(list.map(async (domain) => {
    try {
      for (const c of await chrome.cookies.getAll({ domain })) seen.set(cookieKey(c), c);
    } catch { errors++; }
    try {
      // Partitioned (CHIPS) cookies set by third parties under this top-level site, where supported.
      for (const c of await chrome.cookies.getAll({ domain, partitionKey: { topLevelSite } })) seen.set(cookieKey(c), c);
    } catch { /* partitionKey not supported in this Chrome version: unpartitioned cookies only */ }
  }));
  // Only metadata leaves this function's caller: buildAudit() copies an allow-list of fields.
  return { cookies: [...seen.values()], errors, truncated: domains.size > MAX_COOKIE_DOMAINS };
}

// ---------- audit ----------
async function runAudit(tabId, { sector } = {}) {
  const auditId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return failed(auditId, 'The tab is no longer available.'); }
  try {
    await (queues.get(tabId) || Promise.resolve());
    await flush();
    const [index, settings, state] = await Promise.all([getIndex(), getSettings(), getState(tabId)]);
    let cookies = [];
    let cookieErrors = 0;
    if (state && isSupportedPageUrl(tab.url || '')) {
      const r = await collectCookies(state, tab.url);
      cookies = r.cookies;
      cookieErrors = r.errors;
    }
    const audit = buildAudit({ pageUrl: tab.url || '', observation: state, cookies, cookieErrors, index, thresholds: settings.thresholds, auditId, sector });
    cookies = null; // drop raw cookie objects immediately
    audit.trackerList = { version: index.meta.version || 'custom', domains: index.size, retrieved_at: index.meta.retrieved_at || null };
    if (audit.record.privacy_grade) {
      audit.comparison = await compareAndSaveHistory(audit);
      setBadge(tabId, audit.record.privacy_grade, GRADE_BADGE[audit.record.privacy_grade]);
    }
    return audit;
  } catch (e) {
    console.error(e);
    return failed(auditId, `The audit failed: ${e && e.message ? e.message : e}`, tab.url);
  }
}

function failed(auditId, text, url = '') {
  return {
    record: { audit_id: auditId, site_url: sanitizePageUrl(url), site_domain: url ? hostnameFromUrl(url).hostname : null, audit_timestamp: new Date().toISOString(), audit_status: 'failed' },
    metrics: null, score: null, domains: [], groups: [], cookies: [], messages: [{ level: 'error', text }],
  };
}

/** Local-only history (chrome.storage.local): one summary row per audit, used for "new trackers since last visit". */
async function compareAndSaveHistory(audit) {
  const { history = [] } = await chrome.storage.local.get('history');
  const site = registrableDomain(audit.record.site_domain);
  const trackers = audit.groups.filter((g) => g.party === 'third-party' && g.is_known_tracker).map((g) => g.domain);
  const prev = [...history].reverse().find((h) => h.site === site && h.audit_status === 'complete');
  let comparison = null;
  if (prev) {
    comparison = {
      previous_timestamp: prev.audit_timestamp,
      previous_score: prev.privacy_score,
      previous_grade: prev.privacy_grade,
      new_trackers: trackers.filter((t) => !prev.trackers.includes(t)),
      removed_trackers: prev.trackers.filter((t) => !trackers.includes(t)),
    };
  }
  const r = audit.record;
  history.push({
    site, site_domain: r.site_domain, audit_id: r.audit_id, audit_timestamp: r.audit_timestamp, audit_status: r.audit_status,
    audit_duration_seconds: r.audit_duration_seconds, unique_request_domains: r.unique_request_domains,
    third_party_domains: r.third_party_domains, recognized_tracker_domains: r.recognized_tracker_domains,
    accessible_cookie_count: r.accessible_cookie_count, third_party_cookie_count: r.third_party_cookie_count,
    tracker_density: audit.metrics.tracker_density, privacy_score: r.privacy_score, privacy_grade: r.privacy_grade,
    tracker_list_version: r.tracker_list_version, trackers,
  });
  await chrome.storage.local.set({ history: history.slice(-MAX_HISTORY) });
  return comparison;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg && msg.type === 'runAudit') {
    runAudit(msg.tabId, msg).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'resetTab') {
    cache.delete(msg.tabId);
    chrome.storage.session.remove(key(msg.tabId)).then(() => sendResponse(true));
    return true;
  }
  return false;
});

// Exposed for the optional automated sector audit (analysis/sector_audit.mjs drives it via Playwright).
globalThis.trackerSniffer = { runAudit, getIndex };
