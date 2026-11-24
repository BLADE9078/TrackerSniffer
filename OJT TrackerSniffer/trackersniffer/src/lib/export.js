// CSV and Markdown export of an audit (metadata only — never cookie values or full request URLs).
import { CATEGORY_LABELS } from './trackers.js';

/** Escape one CSV cell. Cells that start with = + - @ are prefixed with ' to prevent spreadsheet formula injection. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export const AUDIT_COLUMNS = [
  'audit_id', 'site_url', 'site_domain', 'site_sector', 'audit_timestamp', 'audit_duration_seconds',
  'unique_request_domains', 'third_party_domains', 'recognized_tracker_domains', 'accessible_cookie_count',
  'third_party_cookie_count', 'privacy_score', 'privacy_grade', 'audit_status', 'tracker_list_version',
];
export const DOMAIN_COLUMNS = [
  'audit_id', 'request_hostname', 'normalized_domain', 'is_first_party', 'is_known_tracker', 'tracker_category',
  'match_rule', 'matched_entry', 'owner', 'request_count', 'first_seen_ms', 'observation_timestamp',
];
export const COOKIE_COLUMNS = [
  'audit_id', 'cookie_domain', 'cookie_name', 'is_session', 'secure', 'http_only', 'same_site', 'partitioned',
  'expiration_status', 'party_classification', 'tracker_match', 'risk_flags',
];

export function auditToCsv(audit) {
  return {
    audit: toCsv([audit.record], AUDIT_COLUMNS),
    domains: toCsv(audit.domains, DOMAIN_COLUMNS),
    cookies: toCsv(audit.cookies.map((c) => ({ ...c, risk_flags: c.risk_flags.join(' ') })), COOKIE_COLUMNS),
  };
}

const fmt = (v, suffix = '') => (v === null || v === undefined ? 'n/a' : `${v}${suffix}`);

export function auditToMarkdown(audit) {
  const r = audit.record;
  const m = audit.metrics;
  const lines = [
    `# TrackerSniffer privacy report — ${r.site_domain}`,
    '',
    `- **Page:** ${r.site_url}`,
    `- **Scanned:** ${r.audit_timestamp} (observation window ${fmt(r.audit_duration_seconds, ' s')})`,
    `- **Status:** ${r.audit_status}`,
    `- **Privacy grade:** ${fmt(r.privacy_grade)} (score ${fmt(r.privacy_score)}/100) — ${audit.score ? audit.score.label : ''}`,
    `- **Tracker list:** ${r.tracker_list_version}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Unique domains observed | ${fmt(r.unique_request_domains)} |`,
    `| Third-party domains | ${fmt(r.third_party_domains)} |`,
    `| Recognized tracker domains | ${fmt(r.recognized_tracker_domains)} |`,
    `| Tracker density | ${fmt(m && m.tracker_density, '%')} |`,
    `| Accessible cookies | ${fmt(r.accessible_cookie_count)} |`,
    `| Third-party cookies | ${fmt(r.third_party_cookie_count)} |`,
    `| Third-party cookie ratio | ${fmt(m && m.third_party_cookie_ratio, '%')} |`,
  ];
  if (audit.score) {
    const c = audit.score.components;
    lines.push('', '## How the score was calculated', '',
      `100 − ${c.trackerPenalty} (trackers) − ${c.unknownPenalty} (unknown third-party domains, max 20) − ${c.cookiePenalty} (third-party cookies, max 15) = **${audit.score.score}**`);
  }
  const trackers = audit.groups.filter((g) => g.party === 'third-party' && g.is_known_tracker);
  if (trackers.length) {
    lines.push('', '## Recognized trackers', '', '| Domain | Owner | Category | Requests |', '|---|---|---|---|');
    for (const t of trackers) lines.push(`| ${t.domain} | ${t.owner || ''} | ${CATEGORY_LABELS[t.category] || t.category} | ${t.request_count} |`);
  } else {
    lines.push('', '_No observed domain matched the tracker list._');
  }
  const unknown = audit.groups.filter((g) => g.party === 'third-party' && !g.is_known_tracker);
  if (unknown.length) {
    lines.push('', '## Other third-party domains (not on the list — unknown, not necessarily safe)', '');
    for (const u of unknown) lines.push(`- ${u.domain}`);
  }
  lines.push('', '---', 'Results reflect activity observed during the audit window only. The grade is a project heuristic, not a privacy certification. No cookie values or browsing history were collected.', '');
  return lines.join('\n');
}
