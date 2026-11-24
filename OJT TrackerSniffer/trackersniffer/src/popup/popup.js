import { CATEGORY_LABELS, CATEGORY_EXPLANATIONS, DISPLAY_GROUPS } from '../lib/trackers.js';
import { CATEGORY_WEIGHTS, trackerWeight, UNKNOWN_DOMAIN_CAP, THIRD_PARTY_COOKIE_CAP } from '../lib/score.js';
import { auditToCsv, auditToMarkdown } from '../lib/export.js';

const $ = (id) => document.getElementById(id);
const GROUP_LABELS = { advertising: 'Advertising', analytics: 'Analytics', social: 'Social media', other: 'Other listed' };
const GROUP_VARS = { advertising: '--series-1', analytics: '--series-2', social: '--series-3', other: '--series-4' };
let tabId = null;
let audit = null;
let chart = null;

/** Tiny DOM helper. Text is always set with textContent (hostnames and cookie names are untrusted). */
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtPct = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);
const fmtMs = (ms) => (ms === null || ms === undefined ? '' : `+${(ms / 1000).toFixed(1)} s`);

function show(view) {
  for (const v of ['loading', 'message', 'result']) $(`view-${v}`).hidden = v !== view;
}

function showMessage({ title, text, icon = 'i', rescan = false }) {
  $('message-title').textContent = title;
  $('message-text').textContent = text;
  $('message-icon').textContent = icon;
  $('message-rescan').hidden = !rescan;
  show('message');
}

function setChip(status) {
  const chip = $('status-chip');
  const labels = { complete: 'Complete', partial: 'Partial', unsupported: 'Unsupported', failed: 'Failed' };
  chip.hidden = !status;
  chip.className = `chip ${status}`;
  chip.textContent = labels[status] || status;
}

async function getTabId() {
  const p = new URLSearchParams(location.search).get('tabId'); // allows opening the popup page in a tab for testing
  if (p) return Number(p);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

async function runAudit() {
  show('loading');
  $('loading-text').textContent = 'Auditing this page…';
  audit = await chrome.runtime.sendMessage({ type: 'runAudit', tabId });
  render();
}

function render() {
  const r = audit.record;
  $('site').textContent = r.site_domain || '';
  setChip(r.audit_status);
  if (r.audit_status === 'unsupported') {
    return showMessage({ title: 'This page can’t be audited', text: audit.messages[0]?.text || 'Only http/https websites are supported.', icon: '–' });
  }
  if (r.audit_status === 'failed') {
    return showMessage({ title: 'Audit failed', text: audit.messages.map((m) => m.text).join(' '), icon: '!', rescan: true });
  }
  if (!audit.score) {
    return showMessage({ title: 'No data for this page yet', text: audit.messages.map((m) => m.text).join(' '), icon: '?', rescan: true });
  }
  show('result');

  // grade
  const badge = $('grade-badge');
  badge.className = `grade ${r.privacy_grade}`;
  badge.textContent = r.privacy_grade;
  badge.setAttribute('aria-label', `Privacy grade ${r.privacy_grade}`);
  $('score').textContent = r.privacy_score;
  $('grade-label').textContent = audit.score.label;
  renderWhy();

  // messages + comparison
  const box = $('messages');
  box.replaceChildren(...audit.messages.map((m) => el('div', { class: `callout ${m.level}`, text: m.text })));
  const cmp = audit.comparison;
  const cbox = $('comparison');
  cbox.hidden = !cmp;
  if (cmp) {
    const when = new Date(cmp.previous_timestamp).toLocaleString();
    const parts = [`Last complete scan (${when}): grade ${cmp.previous_grade}, score ${cmp.previous_score}.`];
    if (cmp.new_trackers.length) parts.push(`⚠️ ${cmp.new_trackers.length} new tracker domain(s) since then: ${cmp.new_trackers.slice(0, 5).join(', ')}${cmp.new_trackers.length > 5 ? '…' : ''}.`);
    if (cmp.removed_trackers.length) parts.push(`${cmp.removed_trackers.length} no longer observed.`);
    if (!cmp.new_trackers.length && !cmp.removed_trackers.length) parts.push('Same tracker domains as before.');
    cbox.className = `callout ${cmp.new_trackers.length ? 'warning' : ''}`;
    cbox.textContent = parts.join(' ');
  }

  // stats
  const m = audit.metrics;
  $('stat-third').textContent = r.third_party_domains;
  $('stat-trackers').textContent = r.recognized_tracker_domains;
  $('stat-density').textContent = fmtPct(m.tracker_density);
  $('stat-cookies').textContent = `${m.first_party_cookie_count} / ${r.third_party_cookie_count}`;

  renderChart();
  renderLists();

  const started = new Date(r.audit_timestamp).toLocaleString();
  $('meta-line').textContent = `Scanned ${started} · window ${r.audit_duration_seconds} s · ${m.request_count} requests · ${m.unique_hostnames} hosts · list ${r.tracker_list_version} (${audit.trackerList?.domains ?? '?'} domains) · lookup ${m.lookup_ms} ms`;
}

function renderWhy() {
  const c = audit.score.components;
  const m = audit.metrics;
  const r = audit.record;
  const rows = [
    ['Start', '100'],
    [`${r.recognized_tracker_domains} tracker domain(s), weighted by category`, `−${c.trackerPenalty}`],
    [`${m.unknown_third_party_domains} unknown third-party domain(s) × 1 (max ${UNKNOWN_DOMAIN_CAP})`, `−${c.unknownPenalty}`],
    [`${r.third_party_cookie_count} third-party cookie(s) × 0.5 (max ${THIRD_PARTY_COOKIE_CAP})`, `−${c.cookiePenalty}`],
  ];
  const weights = Object.entries(CATEGORY_WEIGHTS).map(([k, v]) => `${CATEGORY_LABELS[k]} ${v}`).join(', ');
  $('why').replaceChildren(
    el('table', {}, rows.map(([a, b]) => el('tr', {}, el('td', { text: a }), el('td', { text: b }))),
      el('tr', { class: 'total' }, el('td', { text: `Score (grade ${r.privacy_grade})` }), el('td', { text: String(audit.score.score) }))),
    el('p', { class: 'small muted', text: `Points per tracker domain: ${weights}. A domain listed in several categories counts once, at its highest weight.` })
  );
}

function renderChart() {
  const counts = audit.metrics.category_counts;
  const total = DISPLAY_GROUPS.reduce((s, g) => s + counts[g], 0);
  $('no-trackers').hidden = total > 0;
  document.querySelector('.chart-wrap').hidden = total === 0;
  const colors = DISPLAY_GROUPS.map((g) => cssVar(GROUP_VARS[g]));
  $('legend').replaceChildren(...DISPLAY_GROUPS.map((g, i) => el('li', {},
    el('span', { class: 'sw', style: `background:${colors[i]}` }),
    el('span', { text: GROUP_LABELS[g] }),
    el('span', { class: 'val', text: String(counts[g]) }))));
  if (total === 0 || !window.Chart) return;
  if (chart) chart.destroy();
  chart = new window.Chart($('donut'), {
    type: 'doughnut',
    data: { labels: DISPLAY_GROUPS.map((g) => GROUP_LABELS[g]), datasets: [{ data: DISPLAY_GROUPS.map((g) => counts[g]), backgroundColor: colors, borderColor: cssVar('--surface'), borderWidth: 2, borderRadius: 4 }] },
    options: {
      responsive: false, cutout: '62%', animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw} domain(s)` } } },
    },
  });
}

function evidenceRow(label, value) {
  return [el('dt', { text: label }), el('dd', { text: value })];
}

function trackerItem(g) {
  const color = cssVar(GROUP_VARS[g.display_group] || '--series-4');
  const ev = el('div', { class: 'evidence', hidden: true },
    el('dl', {},
      evidenceRow('Owner', g.owner || 'Unknown'),
      evidenceRow('Hostnames seen', g.hostnames.join(', ')),
      evidenceRow('Match rule', `${g.match_rules.join(', ')} match on list entry ${g.matched_entries.join(', ')}`),
      evidenceRow('Listed categories', g.categories.map((c) => CATEGORY_LABELS[c] || c).join(', ')),
      evidenceRow('Score weight', `−${trackerWeight(g.categories)} points`),
      evidenceRow('Requests', String(g.request_count)),
      evidenceRow('First seen', `${fmtMs(g.first_seen_ms)} after page start${g.first_seen_ms > 3000 ? ' (loaded late)' : ''}`),
      g.tags.length ? evidenceRow('Notes', g.tags.join(', ')) : null),
    el('p', { class: 'explain', text: `Why does this matter? ${CATEGORY_EXPLANATIONS[g.category] || ''}` }));
  const btn = el('button', { 'aria-expanded': 'false', onclick: () => { ev.hidden = !ev.hidden; btn.setAttribute('aria-expanded', String(!ev.hidden)); } },
    el('span', { class: 'name' }, el('strong', { text: g.owner ? `${g.owner}` : g.domain }), el('span', { text: `${g.domain} · ${fmtMs(g.first_seen_ms)}` })),
    el('span', { class: 'tag' }, el('span', { class: 'sw', style: `background:${color}` }), CATEGORY_LABELS[g.category] || g.category),
    el('span', { class: 'qmark', title: CATEGORY_EXPLANATIONS[g.category] || '', text: '?' }));
  return el('div', { class: 'item' }, btn, ev);
}

function plainItem(g, note) {
  const ev = el('div', { class: 'evidence', hidden: true },
    el('dl', {},
      evidenceRow('Hostnames seen', g.hostnames.join(', ')),
      evidenceRow('Classification', note),
      evidenceRow('Requests', String(g.request_count)),
      evidenceRow('First seen', `${fmtMs(g.first_seen_ms)} after page start`),
      g.is_known_tracker ? evidenceRow('Tracker list', `Listed as ${CATEGORY_LABELS[g.category]} (${g.owner || 'unknown owner'}) — not counted because it is first-party here`) : null));
  const btn = el('button', { onclick: () => { ev.hidden = !ev.hidden; } },
    el('span', { class: 'name' }, el('strong', { text: g.domain }), el('span', { text: `${g.hostnames.length} host(s) · ${g.request_count} request(s)` })));
  return el('div', { class: 'item' }, btn, ev);
}

function renderLists() {
  const groups = audit.groups;
  const trackers = groups.filter((g) => g.party === 'third-party' && g.is_known_tracker);
  const unknown = groups.filter((g) => g.party !== 'first-party' && !g.is_known_tracker);
  const first = groups.filter((g) => g.party === 'first-party');
  $('count-trackers').textContent = `(${trackers.length})`;
  $('count-unknown').textContent = `(${unknown.length})`;
  $('count-first').textContent = `(${first.length})`;
  $('count-cookies').textContent = `(${audit.cookies.length})`;

  $('tab-trackers').replaceChildren(trackers.length
    ? el('div', {}, el('p', { class: 'note', text: 'Third-party domains that match the offline tracker list, in the order they loaded. Click one to see the evidence.' }), ...trackers.map(trackerItem))
    : el('p', { class: 'empty', text: 'No tracker-list match was found among the observed third-party domains. That is not proof the site doesn’t track you.' }));

  $('tab-unknown').replaceChildren(unknown.length
    ? el('div', {}, el('p', { class: 'note', text: CATEGORY_EXPLANATIONS.unknown }), ...unknown.map((g) => plainItem(g, g.party === 'uncertain' ? 'Uncertain party (hostname could not be classified)' : 'Third-party, not on the tracker list')))
    : el('p', { class: 'empty', text: 'Every third-party domain observed is on the tracker list.' }));

  $('tab-first').replaceChildren(first.length
    ? el('div', {}, el('p', { class: 'note', text: `Domains sharing the site’s registrable domain (${first[0].domain}).` }), ...first.map((g) => plainItem(g, 'First-party (same registrable domain as the site)')))
    : el('p', { class: 'empty', text: 'No first-party requests recorded.' }));

  const cookies = [...audit.cookies].sort((a, b) => (a.party_classification > b.party_classification ? -1 : 1));
  const flag = (ok, label) => el('span', { class: ok ? 'flag-ok' : 'flag-bad', text: `${ok ? '\u2713' : '\u2717'} ${label}` });
  $('tab-cookies').replaceChildren(cookies.length
    ? el('div', {},
      el('p', { class: 'note', text: `Accessible cookies for the domains seen in this audit (metadata only — values are never read). ${audit.metrics.risky_cookie_count} lack Secure, HttpOnly or an explicit SameSite. Third-party ratio: ${fmtPct(audit.metrics.third_party_cookie_ratio)}.` }),
      el('table', { class: 'cookie-table' },
        el('tr', {}, ...['Name', 'Domain', 'Party', 'Flags'].map((h) => el('th', { text: h }))),
        cookies.map((c) => el('tr', {},
          el('td', { text: c.cookie_name }),
          el('td', { text: c.cookie_domain + (c.tracker_match ? ' • tracker' : '') }),
          el('td', { text: c.party_classification + (c.is_session ? ', session' : '') }),
          el('td', { class: 'flags' }, flag(c.secure, 'Secure'), flag(c.http_only, 'HttpOnly'), flag(c.same_site !== 'unspecified', `SameSite: ${c.same_site}`))))))
    : el('p', { class: 'empty', text: 'No accessible cookies for the observed domains.' }));
}

// ---------- interactions ----------
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', String(x === b));
    for (const t of ['trackers', 'unknown', 'first', 'cookies']) $(`tab-${t}`).hidden = t !== b.dataset.tab;
  });
}
$('why-toggle').addEventListener('click', () => {
  const open = $('why').hidden;
  $('why').hidden = !open;
  $('why-toggle').setAttribute('aria-expanded', String(open));
});
$('export-toggle').addEventListener('click', () => { $('export-menu').hidden = !$('export-menu').hidden; });
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('export-menu').addEventListener('click', (e) => {
  const kind = e.target.dataset.export;
  if (!kind || !audit) return;
  const stamp = audit.record.audit_timestamp.replace(/[:.]/g, '-');
  const base = `trackersniffer_${audit.record.site_domain}_${stamp}`;
  if (kind === 'report') download(`${base}.md`, auditToMarkdown(audit), 'text/markdown');
  else download(`${base}_${kind}.csv`, auditToCsv(audit)[kind], 'text/csv');
  $('export-menu').hidden = true;
});

async function rescan() {
  const { settings } = await chrome.storage.local.get('settings');
  const seconds = Math.max(3, Math.min(60, Number(settings?.observationSeconds) || 10));
  show('loading');
  await chrome.runtime.sendMessage({ type: 'resetTab', tabId });
  await chrome.tabs.reload(tabId, { bypassCache: true });
  for (let s = seconds; s > 0; s--) {
    $('loading-text').textContent = `Reloading and observing the page… ${s} s`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await runAudit();
}
$('rescan').addEventListener('click', rescan);
$('message-rescan').addEventListener('click', rescan);

(async () => {
  tabId = await getTabId();
  if (tabId === null) return showMessage({ title: 'No active tab', text: 'Open a website and try again.' });
  try {
    await runAudit();
  } catch (e) {
    showMessage({ title: 'Audit failed', text: String(e && e.message ? e.message : e), icon: '!', rescan: true });
  }
})();
