import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, gradeFor, validateThresholds, trackerDensity, percentage, trackerWeight, DEFAULT_THRESHOLDS } from '../src/lib/score.js';

test('no activity scores 100 / A', () => {
  const s = computeScore({});
  assert.equal(s.score, 100);
  assert.equal(gradeFor(s.score).grade, 'A');
});

test('formula: weights, caps and rounding', () => {
  const s = computeScore({
    trackers: [{ categories: ['advertising'] }, { categories: ['analytics', 'fingerprinting'] }, { categories: ['social'] }],
    unknownThirdPartyDomains: 3,
    thirdPartyCookies: 5,
  });
  // 100 - (6 + 8 + 4) - 3 - 2.5 = 76.5 -> 77
  assert.deepEqual(s.components, { trackerPenalty: 18, unknownPenalty: 3, cookiePenalty: 2.5 });
  assert.equal(s.score, 77);
  const capped = computeScore({ unknownThirdPartyDomains: 500, thirdPartyCookies: 500 });
  assert.equal(capped.components.unknownPenalty, 20);
  assert.equal(capped.components.cookiePenalty, 15);
  assert.equal(capped.score, 65);
});

test('score is clamped to 0..100', () => {
  const s = computeScore({ trackers: Array.from({ length: 40 }, () => ({ categories: ['advertising'] })) });
  assert.equal(s.score, 0);
  assert.equal(gradeFor(0).grade, 'F');
  assert.equal(computeScore({ unknownThirdPartyDomains: -5 }).score, 100);
});

test('trackerWeight uses the highest listed category; unknown categories weigh 0', () => {
  assert.equal(trackerWeight(['advertising', 'fingerprinting', 'email']), 8);
  assert.equal(trackerWeight('analytics'), 4);
  assert.equal(trackerWeight(['made-up']), 0);
});

test('grade boundaries follow the PRD thresholds', () => {
  const cases = [[100, 'A'], [90, 'A'], [89, 'B'], [80, 'B'], [79, 'C'], [65, 'C'], [64, 'D'], [50, 'D'], [49, 'F'], [0, 'F']];
  for (const [score, grade] of cases) assert.equal(gradeFor(score).grade, grade, String(score));
});

test('custom thresholds validation', () => {
  assert.equal(validateThresholds(DEFAULT_THRESHOLDS), null);
  const t = DEFAULT_THRESHOLDS.map((x) => ({ ...x }));
  t[1].min = 95;
  assert.match(validateThresholds(t), /lower/);
  assert.match(validateThresholds(t.slice(0, 3)), /five/);
  const t2 = DEFAULT_THRESHOLDS.map((x) => ({ ...x }));
  t2[4].min = 10;
  assert.ok(validateThresholds(t2));
  const custom = DEFAULT_THRESHOLDS.map((x, i) => ({ ...x, min: [95, 85, 70, 40, 0][i] }));
  assert.equal(validateThresholds(custom), null);
  assert.equal(gradeFor(92, custom).grade, 'B');
});

test('tracker density and ratios: n/a when the denominator is zero', () => {
  assert.equal(trackerDensity(3, 4), 75);
  assert.equal(trackerDensity(0, 0), null);
  assert.equal(percentage(1, 3), 33.3);
  assert.equal(percentage(5, 0), null);
});
