import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHostname } from '../src/lib/domain.js';
import { CATEGORY_WEIGHTS } from '../src/lib/score.js';
import { catalog } from './helpers.mjs';

test('catalog metadata records source, version, license and size', () => {
  const m = catalog.meta;
  for (const k of ['source', 'source_url', 'source_commit', 'retrieved_at', 'license', 'version', 'domain_count']) assert.ok(m[k], k);
  assert.equal(m.domain_count, Object.keys(catalog.trackers).length);
  assert.ok(m.domain_count > 1000);
});

test('every catalog entry is a normalized hostname with a known category', () => {
  for (const [d, e] of Object.entries(catalog.trackers)) {
    assert.equal(normalizeHostname(d), d, d);
    assert.ok(!d.includes('/'), d);
    assert.ok(e.category in CATEGORY_WEIGHTS, `${d}: ${e.category}`);
    if (e.categories) assert.equal(e.categories[0], e.category);
  }
});
