import { DEFAULT_THRESHOLDS, validateThresholds } from '../lib/score.js';
import { createTrackerIndex } from '../lib/trackers.js';
import { toCsv } from '../lib/export.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_OBSERVATION = 10;

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const thresholds = settings?.thresholds && !validateThresholds(settings.thresholds) ? settings.thresholds : DEFAULT_THRESHOLDS;
  $('thresholds').replaceChildren(...thresholds.map((t) => {
    const label = document.createElement('label');
    label.textContent = t.grade;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min: 0, max: 100, step: 1, value: t.min });
    input.dataset.grade = t.grade;
    if (t.grade === 'F') input.disabled = true;
    label.append(input);
    return label;
  }));
  $('observation').value = settings?.observationSeconds ?? DEFAULT_OBSERVATION;
}

$('save-settings').addEventListener('click', async () => {
  const thresholds = DEFAULT_THRESHOLDS.map((d) => ({ ...d, min: Number(document.querySelector(`input[data-grade="${d.grade}"]`).value) }));
  const err = validateThresholds(thresholds);
  const obs = Number($('observation').value);
  if (err) return void ($('settings-msg').textContent = err);
  if (!(obs >= 3 && obs <= 60)) return void ($('settings-msg').textContent = 'Observation window must be 3–60 seconds.');
  await chrome.storage.local.set({ settings: { thresholds, observationSeconds: obs } });
  $('settings-msg').textContent = 'Saved. New audits use these values.';
});
$('reset-settings').addEventListener('click', async () => {
  await chrome.storage.local.remove('settings');
  await loadSettings();
  $('settings-msg').textContent = 'Defaults restored.';
});

async function loadListInfo() {
  const { customCatalog } = await chrome.storage.local.get('customCatalog');
  let catalog = customCatalog;
  let origin = 'Custom list uploaded in settings';
  if (!catalog) {
    catalog = await (await fetch(chrome.runtime.getURL('data/trackers.json'))).json();
    origin = 'Bundled list';
  }
  const m = catalog.meta || {};
  $('list-info').textContent = `${origin}: ${Object.keys(catalog.trackers).length} domains · version ${m.version || 'n/a'} · retrieved ${m.retrieved_at ? m.retrieved_at.slice(0, 10) : 'n/a'} · source ${m.source || 'n/a'} · license ${m.license || 'n/a'}`;
}
$('list-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const catalog = JSON.parse(await file.text());
    const index = createTrackerIndex(catalog);
    if (!index.size) throw new Error('the list contains no valid domains');
    catalog.meta = { ...(catalog.meta || {}), version: catalog.meta?.version || `custom-${new Date().toISOString().slice(0, 10)}` };
    await chrome.storage.local.set({ customCatalog: catalog });
    $('list-msg').textContent = `Loaded ${index.size} domains.`;
  } catch (err) {
    $('list-msg').textContent = `Not loaded: ${err.message}`;
  }
  loadListInfo();
});
$('list-reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('customCatalog');
  $('list-msg').textContent = 'Using the bundled list.';
  loadListInfo();
});

const HISTORY_COLUMNS = ['audit_timestamp', 'site', 'audit_status', 'privacy_grade', 'privacy_score', 'third_party_domains', 'recognized_tracker_domains', 'tracker_density', 'accessible_cookie_count', 'third_party_cookie_count', 'audit_duration_seconds', 'tracker_list_version'];
const HEADERS = { audit_timestamp: 'Scanned', site: 'Site', audit_status: 'Status', privacy_grade: 'Grade', privacy_score: 'Score', third_party_domains: '3rd-party', recognized_tracker_domains: 'Trackers', tracker_density: 'Density %', accessible_cookie_count: 'Cookies', third_party_cookie_count: '3rd-party cookies', audit_duration_seconds: 'Window s', tracker_list_version: 'List' };
let sortKey = 'audit_timestamp';
let sortDir = -1;

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('history-count').textContent = `(${history.length})`;
  const rows = [...history].sort((a, b) => ((a[sortKey] ?? -1) > (b[sortKey] ?? -1) ? 1 : -1) * sortDir);
  const head = document.createElement('tr');
  for (const c of HISTORY_COLUMNS) {
    const th = document.createElement('th');
    th.textContent = HEADERS[c] + (c === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
    th.addEventListener('click', () => { sortDir = c === sortKey ? -sortDir : -1; sortKey = c; loadHistory(); });
    head.append(th);
  }
  const body = rows.map((r) => {
    const tr = document.createElement('tr');
    for (const c of HISTORY_COLUMNS) {
      const td = document.createElement('td');
      const v = r[c];
      td.textContent = c === 'audit_timestamp' ? new Date(v).toLocaleString() : v ?? 'n/a';
      if (typeof v === 'number') td.className = 'num';
      tr.append(td);
    }
    return tr;
  });
  $('history').replaceChildren(head, ...body);
}
$('history-export').addEventListener('click', async () => {
  const { history = [] } = await chrome.storage.local.get('history');
  const rows = history.map((h) => ({ ...h, trackers: h.trackers.join(' ') }));
  const url = URL.createObjectURL(new Blob([toCsv(rows, [...HISTORY_COLUMNS, 'trackers'])], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `trackersniffer_history_${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$('history-clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('history');
  loadHistory();
});

loadSettings();
loadListInfo();
loadHistory();
