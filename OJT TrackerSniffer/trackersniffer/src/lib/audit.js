// Turns raw observations (hostnames seen by webRequest) + cookie metadata into an audit result.
import { hostnameFromUrl, isSupportedPageUrl, registrableDomain, classifyParty } from './domain.js';
import { matchTracker, displayGroup, DISPLAY_GROUPS } from './trackers.js';
import { toCookieMetadata } from './cookies.js';
import { computeScore, gradeFor, trackerDensity, percentage, DEFAULT_THRESHOLDS } from './score.js';

/** Strip query string and fragment: we keep only what identifies the audited page. */
export function sanitizePageUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/**
 * @param {object} p
 * @param {string} p.pageUrl         URL of the active tab now
 * @param {object|null} p.observation  { pageUrl, startedAt, redirects:[], hosts:{ [host]: {count, firstSeenMs, types:{}} }, dropped:{} }
 * @param {object[]} [p.cookies]     raw chrome.cookies.Cookie objects (values are ignored)
 * @param {number} [p.cookieErrors]  number of cookie queries that failed
 * @param {object} p.index           tracker index from createTrackerIndex()
 * @param {object[]} [p.thresholds]
 * @param {number} [p.nowMs]
 * @param {string} [p.auditId]
 * @param {string} [p.sector]
 */
export function buildAudit({ pageUrl, observation, cookies = [], cookieErrors = 0, index, thresholds = DEFAULT_THRESHOLDS, nowMs = Date.now(), auditId = '', sector = 'other' }) {
  const messages = [];
  const base = {
    audit_id: auditId,
    site_url: sanitizePageUrl(pageUrl),
    site_domain: null,
    site_sector: sector,
    audit_timestamp: new Date(nowMs).toISOString(),
    audit_duration_seconds: null,
    unique_request_domains: null,
    third_party_domains: null,
    recognized_tracker_domains: null,
    accessible_cookie_count: null,
    third_party_cookie_count: null,
    privacy_score: null,
    privacy_grade: null,
    audit_status: 'failed',
    tracker_list_version: index?.meta?.version || 'unknown',
  };

  // 1. Unsupported pages (chrome://, file://, the Web Store, PDFs viewers, ...)
  if (!isSupportedPageUrl(pageUrl)) {
    messages.push({ level: 'info', text: 'This page can’t be audited. TrackerSniffer only audits normal http/https websites.' });
    return { record: { ...base, site_url: '', audit_status: 'unsupported' }, metrics: null, score: null, domains: [], groups: [], cookies: [], messages };
  }

  const siteHost = hostnameFromUrl(pageUrl).hostname;
  const siteDomain = registrableDomain(siteHost);
  base.site_domain = siteHost;

  // 2. No observation for this page: never show misleading zeros.
  const obsSite = observation && observation.pageUrl ? registrableDomain(hostnameFromUrl(observation.pageUrl).hostname) : null;
  if (!observation || !observation.hosts || obsSite !== siteDomain) {
    messages.push({
      level: 'warning',
      text: 'No network activity was recorded for this page yet (it probably loaded before TrackerSniffer started). Click “Rescan” to reload the page and audit it.',
    });
    return { record: { ...base, audit_status: 'partial' }, metrics: null, score: null, domains: [], groups: [], cookies: [], messages, needsRescan: true };
  }

  // 3. Classify every observed hostname.
  const t0 = performance.now();
  const domains = [];
  const groupMap = new Map();
  let requestCount = 0;
  for (const [hostname, info] of Object.entries(observation.hosts)) {
    const party = classifyParty(hostname, siteHost);
    const m = matchTracker(hostname, index);
    const reg = registrableDomain(hostname) || hostname;
    requestCount += info.count || 0;
    const row = {
      audit_id: auditId,
      request_hostname: hostname,
      normalized_domain: reg,
      is_first_party: party === 'first-party',
      party,
      is_known_tracker: m.matched,
      tracker_category: m.matched ? m.category : 'unknown',
      categories: m.categories,
      match_rule: m.rule,
      matched_entry: m.entry,
      owner: m.owner,
      tags: m.tags,
      request_count: info.count || 0,
      resource_types: info.types || {},
      first_seen_ms: info.firstSeenMs ?? null,
      observation_timestamp: new Date((observation.startedAt || nowMs) + (info.firstSeenMs || 0)).toISOString(),
    };
    domains.push(row);

    let g = groupMap.get(reg);
    if (!g) {
      g = { domain: reg, party, hostnames: [], request_count: 0, first_seen_ms: null, is_known_tracker: false, category: 'unknown', categories: [], owner: null, match_rules: [], matched_entries: [], tags: [] };
      groupMap.set(reg, g);
    }
    g.hostnames.push(hostname);
    g.request_count += row.request_count;
    if (row.first_seen_ms != null && (g.first_seen_ms == null || row.first_seen_ms < g.first_seen_ms)) g.first_seen_ms = row.first_seen_ms;
    if (m.matched) {
      g.is_known_tracker = true;
      g.categories = [...new Set([...g.categories, ...m.categories])];
      g.owner = g.owner || m.owner;
      g.match_rules = [...new Set([...g.match_rules, m.rule])];
      g.matched_entries = [...new Set([...g.matched_entries, m.entry])];
      g.tags = [...new Set([...g.tags, ...m.tags])];
    }
  }
  const PRIORITY = ['advertising', 'analytics', 'social', 'fingerprinting', 'cryptomining', 'email', 'content', 'anti-fraud', 'consent'];
  for (const g of groupMap.values()) {
    if (g.is_known_tracker) g.category = PRIORITY.find((c) => g.categories.includes(c)) || g.categories[0];
    g.display_group = g.is_known_tracker ? displayGroup(g.category) : 'unknown';
    g.hostnames.sort();
  }
  const lookupMs = performance.now() - t0;
  domains.sort((a, b) => (a.first_seen_ms ?? 0) - (b.first_seen_ms ?? 0));
  const groups = [...groupMap.values()].sort((a, b) => (a.first_seen_ms ?? 0) - (b.first_seen_ms ?? 0));

  const thirdParty = groups.filter((g) => g.party === 'third-party');
  const trackers = thirdParty.filter((g) => g.is_known_tracker);
  const unknown = thirdParty.filter((g) => !g.is_known_tracker);
  const firstPartyListed = groups.filter((g) => g.party === 'first-party' && g.is_known_tracker);
  const uncertainDomains = groups.filter((g) => g.party === 'uncertain');

  // 4. Cookies (metadata only)
  const cookieRows = cookies.map((c) => ({ audit_id: auditId, ...toCookieMetadata(c, siteHost, index, nowMs) }));
  const fpCookies = cookieRows.filter((c) => c.party_classification === 'first-party').length;
  const tpCookies = cookieRows.filter((c) => c.party_classification === 'third-party').length;
  const uncertainCookies = cookieRows.length - fpCookies - tpCookies;

  // 5. Score
  const s = computeScore({ trackers, unknownThirdPartyDomains: unknown.length, thirdPartyCookies: tpCookies });
  const g = gradeFor(s.score, thresholds);

  const categoryCounts = Object.fromEntries(DISPLAY_GROUPS.map((k) => [k, 0]));
  const detailedCounts = {};
  for (const t of trackers) {
    categoryCounts[t.display_group]++;
    detailedCounts[t.category] = (detailedCounts[t.category] || 0) + 1;
  }

  let status = 'complete';
  if (observation.late) {
    status = 'partial';
    messages.push({ level: 'warning', text: 'Recording started after this page had already loaded, so early requests were missed. Click “Rescan” for a complete audit.' });
  }
  if (cookieErrors > 0) {
    status = 'partial';
    messages.push({ level: 'warning', text: `${cookieErrors} cookie lookup(s) failed, so the cookie summary may be incomplete.` });
  }
  if (trackers.length === 0) {
    messages.push({ level: 'info', text: 'No observed third-party domain matched the tracker list. This does not prove the site doesn’t track you — unlisted trackers and non-network techniques are not detected.' });
  }
  if (thirdParty.length === 0) {
    messages.push({ level: 'info', text: 'No third-party requests were observed during this audit window.' });
  }
  if (firstPartyListed.length) {
    messages.push({ level: 'info', text: `${firstPartyListed.length} first-party domain(s) appear on the tracker list (e.g. auditing the tracker’s own site). They are shown but not counted as third-party trackers.` });
  }

  const durationS = Math.max(0, Math.round((nowMs - (observation.startedAt || nowMs)) / 100) / 10);
  const allGroups = groups.length;
  const record = {
    ...base,
    audit_duration_seconds: durationS,
    unique_request_domains: allGroups,
    third_party_domains: thirdParty.length,
    recognized_tracker_domains: trackers.length,
    accessible_cookie_count: cookieRows.length,
    third_party_cookie_count: tpCookies,
    privacy_score: s.score,
    privacy_grade: g.grade,
    audit_status: status,
  };
  const metrics = {
    request_count: requestCount,
    unique_hostnames: domains.length,
    first_party_domains: groups.filter((x) => x.party === 'first-party').length,
    unknown_third_party_domains: unknown.length,
    uncertain_domains: uncertainDomains.length,
    tracker_density: trackerDensity(trackers.length, thirdParty.length),
    first_party_cookie_count: fpCookies,
    uncertain_cookie_count: uncertainCookies,
    third_party_cookie_ratio: percentage(tpCookies, fpCookies + tpCookies),
    classification_coverage: percentage(allGroups - unknown.length - uncertainDomains.length, allGroups),
    category_counts: categoryCounts,
    detailed_category_counts: detailedCounts,
    risky_cookie_count: cookieRows.filter((c) => c.risk_flags.length > 0).length,
    lookup_ms: Math.round(lookupMs * 100) / 100,
    redirects: observation.redirects || [],
    dropped_requests: observation.dropped || {},
  };
  return {
    record,
    metrics,
    score: { score: s.score, grade: g.grade, label: g.label, components: s.components },
    domains,
    groups,
    cookies: cookieRows,
    messages,
  };
}
