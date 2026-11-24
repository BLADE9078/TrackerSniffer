import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAudit, sanitizePageUrl } from '../src/lib/audit.js';
import { miniIndex } from './helpers.mjs';

const NOW = Date.UTC(2026, 10, 22, 10);
const obs = (hosts, extra = {}) => ({ pageUrl: 'https://www.news.in/story', startedAt: NOW - 10000, redirects: [], hosts, dropped: {}, ...extra });
const h = (count = 1, firstSeenMs = 0) => ({ count, firstSeenMs, types: { script: count } });

test('full audit: counts, density, categories, score', () => {
  const a = buildAudit({
    pageUrl: 'https://www.news.in/story?utm=1#top', index: miniIndex, nowMs: NOW, auditId: 'A1',
    observation: obs({
      'www.news.in': h(3, 0), 'img.news.in': h(5, 50),
      'securepubads.g.doubleclick.net': h(2, 300), 'stats.g.doubleclick.net': h(1, 400),
      'www.google-analytics.com': h(1, 500), 'connect.facebook.net': h(1, 4000),
      'cdn.mysite-cdn.com': h(1, 100), 'notexample.com': h(1, 200),
    }),
    cookies: [
      { domain: '.news.in', name: 'sid', value: 'v1', session: true },
      { domain: '.doubleclick.net', name: 'IDE', value: 'v2', expirationDate: NOW / 1000 + 100 },
    ],
  });
  const r = a.record;
  assert.equal(r.audit_status, 'complete');
  assert.equal(r.site_url, 'https://www.news.in/story', 'query and fragment stripped');
  assert.equal(r.unique_request_domains, 6);
  assert.equal(r.third_party_domains, 5);
  assert.equal(r.recognized_tracker_domains, 3, 'two doubleclick hostnames = one domain');
  assert.equal(a.metrics.unknown_third_party_domains, 2);
  assert.equal(a.metrics.tracker_density, 60);
  assert.deepEqual(a.metrics.category_counts, { advertising: 1, analytics: 1, social: 1, other: 0 });
  assert.equal(r.accessible_cookie_count, 2);
  assert.equal(r.third_party_cookie_count, 1);
  assert.equal(a.metrics.third_party_cookie_ratio, 50);
  // 100 - (8 + 4 + 4) - 2 - 0.5 = 81.5 -> 82 (B)
  assert.equal(r.privacy_score, 82);
  assert.equal(r.privacy_grade, 'B');
  assert.equal(a.domains.length, 8);
  assert.equal(a.domains[0].request_hostname, 'www.news.in', 'domains sorted by first seen');
  assert.ok(!JSON.stringify(a).includes('"v2"'));
  const dc = a.groups.find((g) => g.domain === 'doubleclick.net');
  assert.deepEqual(dc.hostnames, ['securepubads.g.doubleclick.net', 'stats.g.doubleclick.net']);
  assert.deepEqual(dc.match_rules, ['subdomain']);
});

test('unsupported page', () => {
  for (const url of ['chrome://settings', 'about:blank', 'file:///tmp/a.html', '']) {
    const a = buildAudit({ pageUrl: url, observation: null, index: miniIndex, nowMs: NOW });
    assert.equal(a.record.audit_status, 'unsupported', url);
    assert.equal(a.score, null);
  }
});

test('no observation -> partial with null counts (never misleading zeros)', () => {
  const a = buildAudit({ pageUrl: 'https://www.news.in/', observation: null, index: miniIndex, nowMs: NOW });
  assert.equal(a.record.audit_status, 'partial');
  assert.equal(a.record.third_party_domains, null);
  assert.equal(a.record.privacy_score, null);
  assert.equal(a.needsRescan, true);
});

test('stale observation from another site is not reused', () => {
  const a = buildAudit({ pageUrl: 'https://www.shop.com/', observation: obs({ 'www.news.in': h() }), index: miniIndex, nowMs: NOW });
  assert.equal(a.record.audit_status, 'partial');
  assert.equal(a.score, null);
});

test('late start and cookie errors make an audit partial but still scored', () => {
  const late = buildAudit({ pageUrl: 'https://www.news.in/', observation: obs({ 'www.news.in': h() }, { late: true }), index: miniIndex, nowMs: NOW });
  assert.equal(late.record.audit_status, 'partial');
  assert.equal(late.record.privacy_grade, 'A');
  const ce = buildAudit({ pageUrl: 'https://www.news.in/', observation: obs({ 'www.news.in': h() }), cookieErrors: 2, index: miniIndex, nowMs: NOW });
  assert.equal(ce.record.audit_status, 'partial');
  assert.ok(ce.messages.some((m) => /cookie/i.test(m.text)));
});

test('no third-party resources: density n/a and explicit no-match message', () => {
  const a = buildAudit({ pageUrl: 'https://www.news.in/', observation: obs({ 'www.news.in': h(), 'static.news.in': h() }), index: miniIndex, nowMs: NOW });
  assert.equal(a.record.third_party_domains, 0);
  assert.equal(a.metrics.tracker_density, null);
  assert.equal(a.metrics.third_party_cookie_ratio, null);
  assert.equal(a.record.privacy_score, 100);
  assert.ok(a.messages.some((m) => /does not prove/.test(m.text)));
});

test('auditing a tracker’s own site: listed first-party domain is not counted', () => {
  const a = buildAudit({ pageUrl: 'https://www.doubleclick.net/', observation: { ...obs({ 'www.doubleclick.net': h() }), pageUrl: 'https://www.doubleclick.net/' }, index: miniIndex, nowMs: NOW });
  assert.equal(a.record.recognized_tracker_domains, 0);
  assert.ok(a.messages.some((m) => /first-party domain/.test(m.text)));
});

test('sanitizePageUrl', () => {
  assert.equal(sanitizePageUrl('https://a.com/p/q?token=secret#h'), 'https://a.com/p/q');
  assert.equal(sanitizePageUrl('nonsense'), '');
});
