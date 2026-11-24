import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCookieMetadata, cookieKey } from '../src/lib/cookies.js';
import { miniIndex } from './helpers.mjs';

const NOW = Date.UTC(2026, 10, 22);

test('cookie values are never copied', () => {
  const m = toCookieMetadata({ domain: '.doubleclick.net', name: 'IDE', value: 'SECRET-VALUE-123', session: false, expirationDate: NOW / 1000 + 3600 }, 'www.ndtv.com', miniIndex, NOW);
  assert.ok(!JSON.stringify(m).includes('SECRET-VALUE-123'));
  assert.ok(!('value' in m));
});

test('party classification and tracker match', () => {
  const site = 'www.ndtv.com';
  assert.equal(toCookieMetadata({ domain: '.ndtv.com', name: 'a' }, site, miniIndex, NOW).party_classification, 'first-party');
  assert.equal(toCookieMetadata({ domain: 'www.ndtv.com', name: 'a', hostOnly: true }, site, miniIndex, NOW).party_classification, 'first-party');
  const tp = toCookieMetadata({ domain: '.doubleclick.net', name: 'IDE' }, site, miniIndex, NOW);
  assert.equal(tp.party_classification, 'third-party');
  assert.equal(tp.tracker_match, true);
  assert.equal(toCookieMetadata({ domain: '', name: 'x' }, site, miniIndex, NOW).party_classification, 'uncertain');
  assert.equal(toCookieMetadata({ domain: 'bad domain', name: 'x' }, site, miniIndex, NOW).party_classification, 'uncertain');
});

test('expiration status', () => {
  const s = 'a.com';
  assert.equal(toCookieMetadata({ domain: 'a.com', session: true }, s, miniIndex, NOW).expiration_status, 'session');
  assert.equal(toCookieMetadata({ domain: 'a.com', expirationDate: NOW / 1000 + 10 }, s, miniIndex, NOW).expiration_status, 'unexpired');
  assert.equal(toCookieMetadata({ domain: 'a.com', expirationDate: NOW / 1000 - 10 }, s, miniIndex, NOW).expiration_status, 'expired');
  assert.equal(toCookieMetadata({ domain: 'a.com' }, s, miniIndex, NOW).expiration_status, 'unknown');
});

test('security flag audit', () => {
  const s = 'a.com';
  assert.deepEqual(toCookieMetadata({ domain: 'a.com', secure: true, httpOnly: true, sameSite: 'lax' }, s, miniIndex, NOW).risk_flags, []);
  assert.deepEqual(toCookieMetadata({ domain: 'a.com', sameSite: 'no_restriction' }, s, miniIndex, NOW).risk_flags,
    ['missing-secure', 'missing-httponly', 'samesite-none-without-secure']);
  assert.ok(toCookieMetadata({ domain: 'a.com', secure: true, httpOnly: true }, s, miniIndex, NOW).risk_flags.includes('samesite-unspecified'));
});

test('partitioned cookies are flagged and keyed separately', () => {
  const a = { domain: '.x.com', path: '/', name: 'id', storeId: '0' };
  const b = { ...a, partitionKey: { topLevelSite: 'https://site.com' } };
  assert.notEqual(cookieKey(a), cookieKey(b));
  assert.equal(toCookieMetadata(b, 'site.com', miniIndex, NOW).partitioned, true);
});
