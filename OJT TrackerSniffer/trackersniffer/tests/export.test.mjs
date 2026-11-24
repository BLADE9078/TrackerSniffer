import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, auditToCsv, auditToMarkdown } from '../src/lib/export.js';
import { buildAudit } from '../src/lib/audit.js';
import { miniIndex } from './helpers.mjs';

test('CSV escaping and formula-injection guard', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(true), 'true');
  assert.equal(toCsv([{ a: 1, b: 'x' }], ['a', 'b']), 'a,b\r\n1,x\r\n');
});

test('audit exports contain metadata only', () => {
  const now = Date.now();
  const a = buildAudit({
    pageUrl: 'https://www.news.in/?q=private', index: miniIndex, nowMs: now,
    observation: { pageUrl: 'https://www.news.in/', startedAt: now - 5000, hosts: { 'www.news.in': { count: 1, firstSeenMs: 0 }, 'ad.doubleclick.net': { count: 1, firstSeenMs: 10 } } },
    cookies: [{ domain: '.doubleclick.net', name: 'IDE', value: 'TOPSECRET' }],
  });
  const csv = auditToCsv(a);
  for (const text of [csv.audit, csv.domains, csv.cookies, auditToMarkdown(a)]) {
    assert.ok(!text.includes('TOPSECRET'));
    assert.ok(!text.includes('q=private'));
  }
  assert.match(csv.domains, /ad\.doubleclick\.net,doubleclick\.net,false,true,advertising,subdomain/);
  assert.match(auditToMarkdown(a), /Recognized trackers/);
});
