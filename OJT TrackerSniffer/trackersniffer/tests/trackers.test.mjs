import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTracker, createTrackerIndex, displayGroup } from '../src/lib/trackers.js';
import { hostnameFromUrl } from '../src/lib/domain.js';
import { index, miniIndex, labeled } from './helpers.mjs';

test('exact and subdomain matches', () => {
  assert.deepEqual(
    { ...matchTracker('doubleclick.net', miniIndex), categories: undefined },
    { matched: true, rule: 'exact', entry: 'doubleclick.net', category: 'advertising', categories: undefined, owner: 'Google', tags: [] });
  const m = matchTracker('securepubads.g.doubleclick.net', miniIndex);
  assert.equal(m.rule, 'subdomain');
  assert.equal(m.entry, 'doubleclick.net');
  assert.deepEqual(m.categories, ['advertising', 'fingerprinting']);
});

test('domain-boundary-aware: lookalikes never match', () => {
  for (const h of ['notexample.com', 'example.com.evil.net', 'myexample.com', 'example.co', 'xdoubleclick.net', 'doubleclick.network']) {
    assert.equal(matchTracker(h, miniIndex).matched, false, h);
  }
  assert.equal(matchTracker('sub.example.com', miniIndex).matched, true);
});

test('host-specific entries do not match their parent or siblings', () => {
  assert.equal(matchTracker('cdn.jsdelivr.net', miniIndex).matched, true);
  assert.equal(matchTracker('a.cdn.jsdelivr.net', miniIndex).matched, true);
  assert.equal(matchTracker('jsdelivr.net', miniIndex).matched, false);
  assert.equal(matchTracker('fastly.jsdelivr.net', miniIndex).matched, false);
});

test('unmatched and invalid input are "unknown", never "safe"', () => {
  const m = matchTracker('cdn.mysite.in', miniIndex);
  assert.equal(m.matched, false);
  assert.equal(m.category, 'unknown');
  assert.equal(m.rule, 'unmatched');
  assert.equal(matchTracker(null, miniIndex).category, 'unknown');
  assert.equal(matchTracker('bad host', miniIndex).matched, false);
});

test('display groups', () => {
  assert.equal(displayGroup('advertising'), 'advertising');
  assert.equal(displayGroup('fingerprinting'), 'other');
  assert.equal(displayGroup('content'), 'other');
});

test('createTrackerIndex rejects bad catalogs and normalizes keys', () => {
  assert.throws(() => createTrackerIndex(null));
  assert.throws(() => createTrackerIndex({ meta: {} }));
  const i = createTrackerIndex({ trackers: { 'ADS.Example.ORG.': { category: 'advertising' }, 'bad host': { category: 'x' }, 'noCat.com': {} } });
  assert.equal(i.size, 1);
  assert.ok(i.map.has('ads.example.org'));
});

test('labeled domain set: every case behaves as specified (real tracker list)', () => {
  for (const row of labeled) {
    const { hostname } = hostnameFromUrl(row.url);
    const m = matchTracker(hostname, index);
    assert.equal(m.matched, row.expected_match, `${row.url} (${row.kind})`);
    assert.equal(m.category, row.expected_category, `${row.url} category`);
    if (row.kind === 'malformed') assert.equal(hostname, null, `${row.url} should not yield a hostname`);
  }
});

test('performance: 10,000 lookups well under 100 ms', () => {
  const hosts = [];
  for (let i = 0; i < 5000; i++) hosts.push(`a${i}.b${i % 7}.securepubads.g.doubleclick.net`, `cdn${i}.unknown-site-${i}.co.in`);
  const t0 = performance.now();
  for (const h of hosts) matchTracker(h, index);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
});
